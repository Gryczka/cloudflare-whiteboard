/** Authoritative per-board coordinator backed by embedded SQLite. */
import { DurableObject } from 'cloudflare:workers';
import { hashToken, safeEqual } from '../shared/crypto';
import { type BoardElement, type BoardMetadata, type BoardOperation } from '../shared/board';
import {
	CHAT_HISTORY_LIMIT,
	clientMessageSchema,
	MAX_CONNECTIONS,
	MAX_ELEMENTS,
	MAX_MESSAGE_BYTES,
	OPLOG_LIMIT,
	type ChatMessage,
	type Presence,
	type ServerMessage,
} from '../shared/protocol';

interface ConnectionAttachment {
	authenticated: boolean;
	connectedAt?: number;
	sessionId?: string;
	participantId?: string;
	displayName?: string;
	color?: string;
	capability?: 'edit' | 'view';
	x?: number;
	y?: number;
	selectedIds?: string[];
	tool?: string;
	rateWindow?: number;
	rateCount?: number;
}

type ElementRow = Record<string, SqlStorageValue> & { data: string };
type OperationRow = Record<string, SqlStorageValue> & { server_seq: number; payload: string };
type MetaRow = Record<string, SqlStorageValue> & { value: string };
type ChatRow = Record<string, SqlStorageValue> & {
	message_id: string;
	participant_id: string;
	display_name: string;
	color: string;
	body: string;
	created_at: number;
};

const AUTH_TIMEOUT_MS = 5_000;
const DAY_MS = 86_400_000;

function boundedTtlDays(value: number): number {
	return Number.isFinite(value) ? Math.max(1, Math.min(Math.trunc(value), 90)) : 30;
}

/** Orders durable operations, enforces capabilities, and relays transient presence. */
export class BoardDurableObject extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
	}

	async initialize(editHash: string, viewHash: string, ttlDays: number): Promise<{ expiresAt: number }> {
		this.ensureSchema();
		const existing = this.getMeta('created_at');
		if (existing) return { expiresAt: Number(this.getMeta('expires_at')) };

		const now = Date.now();
		const expiresAt = now + boundedTtlDays(ttlDays) * DAY_MS;
		this.ctx.storage.transactionSync(() => {
			this.setMeta('edit_hash', editHash);
			this.setMeta('view_hash', viewHash);
			this.setMeta('title', 'Untitled whiteboard');
			this.setMeta('server_seq', '0');
			this.setMeta('created_at', String(now));
			this.setMeta('updated_at', String(now));
			this.setMeta('expires_at', String(expiresAt));
		});
		await this.ctx.storage.setAlarm(expiresAt);
		return { expiresAt };
	}

	private ensureSchema(): void {
		this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS elements (
        element_id TEXT PRIMARY KEY,
        element_type TEXT NOT NULL,
        data TEXT NOT NULL,
        z_index REAL NOT NULL,
        updated_seq INTEGER NOT NULL,
        deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS operations (
        server_seq INTEGER PRIMARY KEY,
        op_id TEXT NOT NULL UNIQUE,
        participant_id TEXT,
        operation_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS operations_created_at ON operations(created_at);
      CREATE TABLE IF NOT EXISTS chat (
        rowid_seq INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT NOT NULL UNIQUE,
        participant_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        color TEXT NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
    `);
	}

	private hasSchema(): boolean {
		return Boolean(
			this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray()[0],
		);
	}

	async fetch(request: Request): Promise<Response> {
		if (!this.hasSchema() || !this.getMeta('created_at')) return new Response('Board expired or not found', { status: 410 });
		// Idempotent: brings boards created before a table was introduced up to the current schema.
		this.ensureSchema();
		if (request.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
		if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) return new Response('Board is at capacity', { status: 429 });

		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.ctx.acceptWebSocket(server);
		server.serializeAttachment({ authenticated: false, connectedAt: Date.now() } satisfies ConnectionAttachment);
		await this.scheduleNextAlarm();
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(webSocket: WebSocket, raw: string | ArrayBuffer): Promise<void> {
		if (typeof raw !== 'string' || new TextEncoder().encode(raw).byteLength > MAX_MESSAGE_BYTES) {
			this.send(webSocket, { type: 'error', reason: 'Message is too large or not valid text.' });
			webSocket.close(1009, 'Invalid message');
			return;
		}

		let decoded: unknown;
		try {
			decoded = JSON.parse(raw);
		} catch {
			decoded = null;
		}
		const parsed = clientMessageSchema.safeParse(decoded);
		if (!parsed.success) {
			this.send(webSocket, { type: 'error', reason: 'Invalid protocol message.' });
			return;
		}

		const attachment = (webSocket.deserializeAttachment() ?? { authenticated: false }) as ConnectionAttachment;
		if (!attachment.authenticated) {
			if (parsed.data.type !== 'hello') {
				webSocket.close(1008, 'Authenticate first');
				return;
			}
			await this.authenticate(webSocket, parsed.data);
			return;
		}

		if (!this.withinRateLimit(webSocket, attachment)) return;
		const message = parsed.data;
		if (message.type === 'operation') {
			if (attachment.capability !== 'edit') {
				this.send(webSocket, { type: 'operation-rejected', opId: message.opId, reason: 'This link is view-only.' });
				return;
			}
			await this.applyAndBroadcast(webSocket, message.opId, message.operation, attachment.participantId ?? '');
		} else if (message.type === 'presence') {
			const nextAttachment = { ...attachment, ...message };
			webSocket.serializeAttachment(nextAttachment);
			this.broadcast(
				{
					type: 'presence',
					participantId: attachment.participantId ?? '',
					displayName: attachment.displayName ?? 'Anonymous',
					color: attachment.color ?? '#0A95FF',
					x: message.x,
					y: message.y,
					selectedIds: message.selectedIds,
					tool: message.tool,
				},
				webSocket,
			);
		} else if (message.type === 'chat') {
			if (attachment.capability !== 'edit') {
				this.send(webSocket, { type: 'error', reason: 'This link is view-only, so it cannot post chat messages.' });
				return;
			}
			this.appendChat(attachment, message.body);
		} else if (message.type === 'ping') {
			this.send(webSocket, { type: 'pong' });
		}
	}

	/** Persists a chat message before relaying it, then prunes older history. */
	private appendChat(attachment: ConnectionAttachment, body: string): void {
		const message: ChatMessage = {
			id: crypto.randomUUID(),
			participantId: attachment.participantId ?? '',
			displayName: attachment.displayName ?? 'Anonymous',
			color: attachment.color ?? '#0A95FF',
			body,
			createdAt: Date.now(),
		};
		this.ctx.storage.transactionSync(() => {
			this.ctx.storage.sql.exec(
				'INSERT INTO chat (message_id, participant_id, display_name, color, body, created_at) VALUES (?, ?, ?, ?, ?, ?)',
				message.id,
				message.participantId,
				message.displayName,
				message.color,
				message.body,
				message.createdAt,
			);
			this.ctx.storage.sql.exec('DELETE FROM chat WHERE rowid_seq <= (SELECT MAX(rowid_seq) - ? FROM chat)', CHAT_HISTORY_LIMIT);
		});
		this.broadcast({ type: 'chat', message });
	}

	private chatHistory(): ChatMessage[] {
		return this.ctx.storage.sql
			.exec<ChatRow>('SELECT message_id, participant_id, display_name, color, body, created_at FROM chat ORDER BY rowid_seq')
			.toArray()
			.map((row) => ({
				id: row.message_id,
				participantId: row.participant_id,
				displayName: row.display_name,
				color: row.color,
				body: row.body,
				createdAt: row.created_at,
			}));
	}

	async webSocketClose(webSocket: WebSocket, code: number, reason: string): Promise<void> {
		const attachment = webSocket.deserializeAttachment() as ConnectionAttachment | null;
		if (attachment?.participantId) this.broadcast({ type: 'participant-left', participantId: attachment.participantId }, webSocket);
		webSocket.close(code, reason);
	}

	webSocketError(webSocket: WebSocket): void {
		const attachment = webSocket.deserializeAttachment() as ConnectionAttachment | null;
		if (attachment?.participantId) this.broadcast({ type: 'participant-left', participantId: attachment.participantId }, webSocket);
	}

	async alarm(): Promise<void> {
		if (!this.hasSchema()) return;
		const now = Date.now();
		const expiresAt = Number(this.getMeta('expires_at') ?? 0);
		if (expiresAt <= now) {
			for (const socket of this.ctx.getWebSockets()) {
				this.send(socket, { type: 'board-expired' });
				socket.close(1000, 'Board expired');
			}
			await this.ctx.storage.deleteAll();
			return;
		}
		for (const socket of this.ctx.getWebSockets()) {
			const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
			if (!attachment?.authenticated && (attachment?.connectedAt ?? 0) + AUTH_TIMEOUT_MS <= now) {
				socket.close(1008, 'Authentication timed out');
			}
		}
		await this.scheduleNextAlarm();
	}

	private async authenticate(
		webSocket: WebSocket,
		message: Extract<ReturnType<typeof clientMessageSchema.parse>, { type: 'hello' }>,
	): Promise<void> {
		const suppliedHash = await hashToken(message.token);
		const editHash = this.getMeta('edit_hash') ?? '';
		const viewHash = this.getMeta('view_hash') ?? '';
		const capability: 'edit' | 'view' | null = safeEqual(suppliedHash, editHash)
			? 'edit'
			: safeEqual(suppliedHash, viewHash)
				? 'view'
				: null;
		if (!capability) {
			webSocket.close(1008, 'Invalid capability');
			return;
		}

		const sessionId = crypto.randomUUID();
		const attachment: ConnectionAttachment = {
			authenticated: true,
			sessionId,
			participantId: message.participantId,
			displayName: message.displayName,
			color: message.color,
			capability,
			x: 0,
			y: 0,
			selectedIds: [],
			tool: 'select',
			rateWindow: Date.now(),
			rateCount: 0,
		};
		webSocket.serializeAttachment(attachment);

		const serverSeq = Number(this.getMeta('server_seq') ?? 0);
		const oldest =
			this.ctx.storage.sql.exec<{ value: number }>('SELECT MIN(server_seq) AS value FROM operations').one()?.value ?? serverSeq;
		const canResume = message.sinceSeq > 0 && message.sinceSeq >= oldest - 1;
		const common = {
			type: 'welcome' as const,
			permission: capability,
			sessionId,
			serverSeq,
			metadata: this.metadata(),
			participants: this.participants(webSocket),
			chat: this.chatHistory(),
		};
		if (canResume) {
			const operations = this.ctx.storage.sql
				.exec<OperationRow>('SELECT server_seq, payload FROM operations WHERE server_seq > ? ORDER BY server_seq', message.sinceSeq)
				.toArray()
				.map((row) => ({ serverSeq: row.server_seq, operation: JSON.parse(row.payload) as BoardOperation }));
			this.send(webSocket, { ...common, operations });
		} else {
			const elements = this.ctx.storage.sql
				.exec<ElementRow>('SELECT data FROM elements WHERE deleted = 0 ORDER BY z_index')
				.toArray()
				.map((row) => JSON.parse(row.data) as BoardElement);
			this.send(webSocket, { ...common, elements });
		}
		this.broadcast(
			{
				type: 'presence',
				participantId: message.participantId,
				displayName: message.displayName,
				color: message.color,
				x: 0,
				y: 0,
				selectedIds: [],
				tool: 'select',
			},
			webSocket,
		);
	}

	private async applyAndBroadcast(source: WebSocket, opId: string, operation: BoardOperation, participantId: string): Promise<void> {
		const duplicate = this.ctx.storage.sql
			.exec<OperationRow>('SELECT server_seq, payload FROM operations WHERE op_id = ?', opId)
			.toArray()[0];
		if (duplicate) {
			this.send(source, {
				type: 'operation-applied',
				opId,
				serverSeq: duplicate.server_seq,
				operation: JSON.parse(duplicate.payload) as BoardOperation,
			});
			return;
		}
		if (operation.action === 'put') {
			const exists =
				this.ctx.storage.sql
					.exec<{ value: number }>('SELECT COUNT(*) AS value FROM elements WHERE element_id = ? AND deleted = 0', operation.element.id)
					.one()?.value ?? 0;
			const count =
				this.ctx.storage.sql.exec<{ value: number }>('SELECT COUNT(*) AS value FROM elements WHERE deleted = 0').one()?.value ?? 0;
			if (!exists && count >= MAX_ELEMENTS) {
				this.send(source, { type: 'operation-rejected', opId, reason: `Boards support up to ${MAX_ELEMENTS.toLocaleString()} elements.` });
				return;
			}
		}

		const nextSeq = Number(this.getMeta('server_seq') ?? 0) + 1;
		const now = Date.now();
		const expiresAt = now + boundedTtlDays(Number.parseInt(this.env.BOARD_TTL_DAYS, 10)) * DAY_MS;
		this.ctx.storage.transactionSync(() => {
			if (operation.action === 'put') {
				const element = operation.element;
				this.ctx.storage.sql.exec(
					`INSERT INTO elements (element_id, element_type, data, z_index, updated_seq, deleted)
           VALUES (?, ?, ?, ?, ?, 0)
           ON CONFLICT(element_id) DO UPDATE SET element_type=excluded.element_type, data=excluded.data,
             z_index=excluded.z_index, updated_seq=excluded.updated_seq, deleted=0`,
					element.id,
					element.type,
					JSON.stringify(element),
					element.zIndex,
					nextSeq,
				);
			} else if (operation.action === 'delete') {
				this.ctx.storage.sql.exec('UPDATE elements SET deleted = 1, updated_seq = ? WHERE element_id = ?', nextSeq, operation.elementId);
			} else if (operation.action === 'clear') {
				this.ctx.storage.sql.exec('UPDATE elements SET deleted = 1, updated_seq = ? WHERE deleted = 0', nextSeq);
			} else if (operation.action === 'title') {
				this.setMeta('title', operation.title);
			}
			this.ctx.storage.sql.exec(
				'INSERT INTO operations (server_seq, op_id, participant_id, operation_type, payload, created_at) VALUES (?, ?, ?, ?, ?, ?)',
				nextSeq,
				opId,
				participantId,
				operation.action,
				JSON.stringify(operation),
				now,
			);
			this.setMeta('server_seq', String(nextSeq));
			this.setMeta('updated_at', String(now));
			this.setMeta('expires_at', String(expiresAt));
			this.ctx.storage.sql.exec('DELETE FROM operations WHERE server_seq <= ?', Math.max(0, nextSeq - OPLOG_LIMIT));
		});
		await this.ctx.storage.setAlarm(expiresAt);
		this.broadcast({ type: 'operation-applied', opId, serverSeq: nextSeq, operation });
	}

	private metadata(): BoardMetadata {
		return {
			title: this.getMeta('title') ?? 'Untitled whiteboard',
			createdAt: Number(this.getMeta('created_at') ?? 0),
			updatedAt: Number(this.getMeta('updated_at') ?? 0),
			expiresAt: Number(this.getMeta('expires_at') ?? 0),
		};
	}

	private participants(exclude?: WebSocket): Presence[] {
		return this.ctx
			.getWebSockets()
			.filter((socket) => socket !== exclude)
			.flatMap((socket) => {
				const state = socket.deserializeAttachment() as ConnectionAttachment | null;
				if (!state?.authenticated || !state.participantId) return [];
				return [
					{
						participantId: state.participantId,
						displayName: state.displayName ?? 'Anonymous',
						color: state.color ?? '#0A95FF',
						x: state.x ?? 0,
						y: state.y ?? 0,
						selectedIds: state.selectedIds ?? [],
						tool: state.tool ?? 'select',
					},
				];
			});
	}

	private withinRateLimit(webSocket: WebSocket, attachment: ConnectionAttachment): boolean {
		const now = Date.now();
		const windowStart = attachment.rateWindow ?? now;
		const reset = now - windowStart >= 1_000;
		const rateCount = reset ? 1 : (attachment.rateCount ?? 0) + 1;
		webSocket.serializeAttachment({ ...attachment, rateWindow: reset ? now : windowStart, rateCount });
		if (rateCount <= 40) return true;
		this.send(webSocket, { type: 'error', reason: 'Message rate exceeded.' });
		return false;
	}

	private async scheduleNextAlarm(): Promise<void> {
		const expiresAt = Number(this.getMeta('expires_at') ?? 0);
		const authDeadlines = this.ctx
			.getWebSockets()
			.map((socket) => socket.deserializeAttachment() as ConnectionAttachment | null)
			.filter((attachment) => attachment && !attachment.authenticated && attachment.connectedAt)
			.map((attachment) => attachment!.connectedAt! + AUTH_TIMEOUT_MS);
		await this.ctx.storage.setAlarm(Math.min(expiresAt, ...authDeadlines));
	}

	private getMeta(key: string): string | undefined {
		return this.ctx.storage.sql.exec<MetaRow>('SELECT value FROM meta WHERE key = ?', key).toArray()[0]?.value;
	}

	private setMeta(key: string, value: string): void {
		this.ctx.storage.sql.exec(
			'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
			key,
			value,
		);
	}

	private send(webSocket: WebSocket, message: ServerMessage): void {
		if (webSocket.readyState === WebSocket.OPEN) webSocket.send(JSON.stringify(message));
	}

	private broadcast(message: ServerMessage, exclude?: WebSocket): void {
		const encoded = JSON.stringify(message);
		for (const socket of this.ctx.getWebSockets()) {
			if (socket !== exclude && socket.readyState === WebSocket.OPEN) socket.send(encoded);
		}
	}
}
