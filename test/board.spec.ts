import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import { applyOperation, boardElementSchema, DEFAULT_STYLE, type BoardElement } from '../src/shared/board';
import { hashToken, randomToken, safeEqual } from '../src/shared/crypto';
import { chatMessageSchema, type ServerMessage } from '../src/shared/protocol';
import { centerPlacement, createObjectAt, DEFAULT_SIZES } from '../src/client/editor/shape-defaults';
import worker from '../src/index';
import { textBoxHeight, wrapTextLines } from '../src/client/editor/text-layout';

const rectangle: BoardElement = {
	id: 'd1fa9f10-a4b5-44c6-8ef8-873428b47301',
	type: 'rectangle',
	x: 10,
	y: 20,
	width: 100,
	height: 80,
	rotation: 0,
	style: DEFAULT_STYLE,
	zIndex: 1,
};

describe('board state', () => {
	it('applies puts and deletes without mutating the previous map', () => {
		const initial = new Map<string, BoardElement>();
		const created = applyOperation(initial, { action: 'put', element: rectangle });
		const removed = applyOperation(created, { action: 'delete', elementId: rectangle.id });
		expect(initial.size).toBe(0);
		expect(created.get(rectangle.id)).toEqual(rectangle);
		expect(removed.size).toBe(0);
	});

	it('creates high-entropy tokens and stable hashes', async () => {
		const first = randomToken();
		const second = randomToken();
		expect(first).not.toBe(second);
		expect(first.length).toBeGreaterThanOrEqual(32);
		expect(safeEqual(await hashToken(first), await hashToken(first))).toBe(true);
		expect(safeEqual(await hashToken(first), await hashToken(second))).toBe(false);
	});

	it('accepts timestamp-based layer ordering', () => {
		expect(boardElementSchema.safeParse({ ...rectangle, zIndex: Date.now() }).success).toBe(true);
	});

	it('wraps text and grows a text box to contain it', () => {
		const text = 'A collaborative idea that should wrap across several lines inside the box';
		expect(wrapTextLines(text, 180, 24).length).toBeGreaterThan(2);
		expect(textBoxHeight(text, 180, 24)).toBeGreaterThan(64);
	});

	it('accepts freehand elements produced by the pencil tool', () => {
		expect(
			boardElementSchema.safeParse({
				...rectangle,
				type: 'freehand',
				width: 0,
				height: 0,
				points: [
					{ x: 0, y: 0 },
					{ x: 20, y: 10 },
				],
			}).success,
		).toBe(true);
	});

	it('accepts configurable arrowheads on connector lines', () => {
		expect(
			boardElementSchema.safeParse({
				...rectangle,
				type: 'line',
				style: { ...rectangle.style, startArrow: 'dot', endArrow: 'diamond' },
			}).success,
		).toBe(true);
	});

	it('places palette objects centered on the drop point at a consistent size', () => {
		const placed = createObjectAt('rectangle', { x: 400, y: 300 }, DEFAULT_STYLE);
		expect(placed.width).toBe(DEFAULT_SIZES.rectangle.width);
		expect(placed.height).toBe(DEFAULT_SIZES.rectangle.height);
		expect(placed.x + placed.width / 2).toBe(400);
		expect(placed.y + placed.height / 2).toBe(300);
		expect(boardElementSchema.safeParse(placed).success).toBe(true);
	});

	it('gives sticky notes their own fill without altering other objects', () => {
		expect(createObjectAt('sticky', { x: 0, y: 0 }, DEFAULT_STYLE).style.fill).toBe('#FFF3AE');
		expect(createObjectAt('ellipse', { x: 0, y: 0 }, DEFAULT_STYLE).style.fill).toBe(DEFAULT_STYLE.fill);
	});

	it('centers placement in the viewport and cascades away from occupied space', () => {
		const viewport = { x: 0, y: 0, zoom: 1 };
		const canvas = { width: 800, height: 600 };
		const first = centerPlacement(viewport, canvas, []);
		expect(first).toEqual({ x: 400, y: 300 });

		const occupied = createObjectAt('rectangle', first, DEFAULT_STYLE);
		const second = centerPlacement(viewport, canvas, [occupied]);
		expect(second).not.toEqual(first);
	});

	it('accounts for pan and zoom when centering placement', () => {
		expect(centerPlacement({ x: -200, y: -100, zoom: 2 }, { width: 800, height: 600 }, [])).toEqual({ x: 300, y: 200 });
	});

	it('accepts connectors bound to source and target shapes', () => {
		expect(
			boardElementSchema.safeParse({
				...rectangle,
				id: crypto.randomUUID(),
				type: 'arrow',
				sourceId: crypto.randomUUID(),
				targetId: crypto.randomUUID(),
			}).success,
		).toBe(true);
	});
});

describe('Worker and Durable Object integration', () => {
	it('creates a board with distinct capability tokens', async () => {
		const response = await exports.default.fetch(
			new Request('https://example.com/api/boards', {
				method: 'POST',
				headers: { 'CF-Connecting-IP': '192.0.2.10' },
			}),
		);
		expect(response.status).toBe(201);
		const body = (await response.json()) as { boardId: string; editToken: string; viewToken: string; expiresAt: number };
		expect(body.boardId.length).toBeGreaterThan(20);
		expect(body.editToken).not.toBe(body.viewToken);
		expect(body.expiresAt).toBeGreaterThan(Date.now());
	});

	it('initializes each Durable Object only once', async () => {
		const board = env.BOARDS.getByName(`test-${crypto.randomUUID()}`);
		const first = await board.initialize(
			await hashToken('edit-token-that-is-long-enough'),
			await hashToken('view-token-that-is-long-enough'),
			30,
		);
		const second = await board.initialize(await hashToken('different-edit-token-long'), await hashToken('different-view-token-long'), 7);
		expect(second.expiresAt).toBe(first.expiresAt);
	});

	it('does not initialize storage for arbitrary board paths', async () => {
		const board = env.BOARDS.getByName(`missing-${crypto.randomUUID()}`);
		const response = await board.fetch(new Request('https://example.com/api/boards/missing/ws'));
		expect(response.status).toBe(410);
	});

	it('caps board retention at 90 days', async () => {
		const board = env.BOARDS.getByName(`ttl-${crypto.randomUUID()}`);
		const result = await board.initialize(
			await hashToken('edit-token-that-is-long-enough'),
			await hashToken('view-token-that-is-long-enough'),
			1_000,
		);
		expect(result.expiresAt).toBeLessThanOrEqual(Date.now() + 90 * 86_400_000);
	});
});

const EDIT_TOKEN = 'edit-token-that-is-long-enough';
const VIEW_TOKEN = 'view-token-that-is-long-enough';

type Board = ReturnType<typeof env.BOARDS.getByName>;

async function newBoard(): Promise<Board> {
	const board = env.BOARDS.getByName(`chat-${crypto.randomUUID()}`);
	await board.initialize(await hashToken(EDIT_TOKEN), await hashToken(VIEW_TOKEN), 30);
	return board;
}

async function waitForMessage<T extends ServerMessage['type']>(inbox: ServerMessage[], type: T, timeout = 2_000) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const found = inbox.find((message) => message.type === type);
		if (found) return found as Extract<ServerMessage, { type: T }>;
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	throw new Error(`Timed out waiting for a ${type} message`);
}

async function join(board: Board, token: string, sinceSeq = 0) {
	const response = await board.fetch(
		new Request('https://example.com/api/boards/board/ws', {
			headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `whiteboard, cap.${token}` },
		}),
	);
	const socket = response.webSocket;
	if (!socket) throw new Error('The Durable Object did not return a WebSocket');
	socket.accept();
	const inbox: ServerMessage[] = [];
	socket.addEventListener('message', (event) => {
		inbox.push(JSON.parse(String(event.data)) as ServerMessage);
	});
	socket.send(
		JSON.stringify({
			type: 'hello',
			token,
			participantId: crypto.randomUUID(),
			displayName: 'Tester',
			color: '#0A95FF',
			sinceSeq,
		}),
	);
	const welcome = await waitForMessage(inbox, 'welcome');
	return { socket, inbox, welcome };
}

describe('board chat', () => {
	it('rejects empty and oversized message bodies', () => {
		expect(chatMessageSchema.safeParse({ type: 'chat', body: '   ' }).success).toBe(false);
		expect(chatMessageSchema.safeParse({ type: 'chat', body: 'x'.repeat(501) }).success).toBe(false);
		expect(chatMessageSchema.safeParse({ type: 'chat', body: '  hello  ' }).data?.body).toBe('hello');
	});

	it('broadcasts a message to other participants and persists it for later joiners', async () => {
		const board = await newBoard();
		const author = await join(board, EDIT_TOKEN);
		const listener = await join(board, EDIT_TOKEN);
		expect(author.welcome.chat).toEqual([]);

		author.socket.send(JSON.stringify({ type: 'chat', body: 'Ship it' }));
		const relayed = await waitForMessage(listener.inbox, 'chat');
		expect(relayed.message.body).toBe('Ship it');
		expect(relayed.message.displayName).toBe('Tester');

		// A participant joining afterwards receives the stored history.
		const latecomer = await join(board, EDIT_TOKEN);
		expect(latecomer.welcome.chat.map((message) => message.body)).toEqual(['Ship it']);
	});

	it('refuses chat from view-only capabilities', async () => {
		const board = await newBoard();
		const viewer = await join(board, VIEW_TOKEN);
		expect(viewer.welcome.permission).toBe('view');

		viewer.socket.send(JSON.stringify({ type: 'chat', body: 'Can I post?' }));
		const error = await waitForMessage(viewer.inbox, 'error');
		expect(error.reason).toContain('view-only');

		const observer = await join(board, EDIT_TOKEN);
		expect(observer.welcome.chat).toEqual([]);
	});

	it('does not extend board expiry when chatting', async () => {
		const board = await newBoard();
		const author = await join(board, EDIT_TOKEN);
		const before = author.welcome.metadata.expiresAt;

		author.socket.send(JSON.stringify({ type: 'chat', body: 'Just talking' }));
		await waitForMessage(author.inbox, 'chat');

		const rejoined = await join(board, EDIT_TOKEN);
		expect(rejoined.welcome.metadata.expiresAt).toBe(before);
	});
});

describe('deployed guardrail regressions', () => {
	it('preserves inventory-verified legacy capabilities without initializing unknown actors', async () => {
		const id = randomToken(16);
		const board = env.BOARDS.getByName(id);
		await board.initialize(await hashToken(EDIT_TOKEN), await hashToken(VIEW_TOKEN), 30);
		const legacyEnv = { ...env, LEGACY_BOARD_OBJECT_IDS: JSON.stringify([env.BOARDS.idFromName(id).toString()]) };
		const url = `https://example.com/api/boards/${id}/ws`;
		expect(
			(
				await worker.fetch(
					new Request(url, { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `whiteboard, cap.${randomToken(24)}` } }),
					legacyEnv,
				)
			).status,
		).toBe(403);
		const response = await worker.fetch(
			new Request(url, { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `whiteboard, cap.${VIEW_TOKEN}` } }),
			legacyEnv,
		);
		expect(response.status).toBe(101);
		response.webSocket!.accept();
		response.webSocket!.close(1000);
	});
	it('rejects arbitrary IDs before actor dispatch and invalid known-board upgrades before accepting slots', async () => {
		const dispatch = vi.fn(() => {
			throw new Error('Untrusted actor dispatch');
		});
		const boards = new Proxy(env.BOARDS, {
			get(target, property) {
				if (property === 'getByName') return dispatch;
				const value: unknown = Reflect.get(target, property);
				return typeof value === 'function' ? value.bind(target) : value;
			},
		});
		for (let n = 0; n < 35; n++) {
			const response = await worker.fetch(
				new Request(`https://example.com/api/boards/${randomToken(16)}/ws`, {
					headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `whiteboard, cap.${randomToken(24)}` },
				}),
				{ ...env, BOARDS: boards },
			);
			expect(response.status).toBe(404);
		}
		expect(dispatch).not.toHaveBeenCalled();
		const board = await newBoard();
		for (let n = 0; n < 35; n++)
			expect(
				(
					await board.fetch(
						new Request('https://example.com/ws', {
							headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `whiteboard, cap.${randomToken(24)}` },
						}),
					)
				).status,
			).toBe(403);
		await runInDurableObject(board, (_instance, state) => expect(state.getWebSockets()).toHaveLength(0));
		const valid = await join(board, EDIT_TOKEN);
		valid.socket.close(1000);
	});

	it('bounds directory admission before allocating per-board actors', async () => {
		const directory = env.BOARD_DIRECTORY.getByName(`limit-${crypto.randomUUID()}`);
		for (let n = 0; n < 20; n++) expect(await directory.reserve(`board-${n}`, 'edit', 'view', Date.now() + 86_400_000)).toBe(true);
		expect(await directory.reserve('twenty-first', 'edit', 'view', Date.now() + 86_400_000)).toBe(false);
		expect(await directory.authorize('unknown', 'edit')).toBe(false);
	});

	it('prunes delete/clear payloads under UUID churn while preserving bounded replay and absolute expiry', async () => {
		const board = await newBoard();
		const author = await join(board, EDIT_TOKEN);
		await runInDurableObject(board, async (instance, state) => {
			const ws = state.getWebSockets()[0];
			const expiry = state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'expires_at'").one().value;
			for (let n = 0; n < 1100; n++) {
				const id = crypto.randomUUID();
				for (const operation of [
					{ action: 'put', element: { ...rectangle, id } },
					n % 2 ? { action: 'delete', elementId: id } : { action: 'clear' },
				]) {
					ws.serializeAttachment({ ...ws.deserializeAttachment(), rateWindow: 0, rateCount: 0 });
					await instance.webSocketMessage(ws, JSON.stringify({ type: 'operation', opId: crypto.randomUUID(), operation }));
				}
			}
			expect(state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM elements').one().n).toBe(0);
			expect(state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM operations').one().n).toBe(2000);
			expect(state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'expires_at'").one().value).toBe(expiry);
		});
		const resumed = await join(board, EDIT_TOKEN, 1);
		expect(resumed.welcome.elements).toEqual([]);
		expect(resumed.welcome.operations).toBeUndefined();
		resumed.socket.close(1000);
		author.socket.close(1000);
	}, 30_000);

	it('rolls back an over-byte-limit put including its operation and sequence', async () => {
		const board = await newBoard();
		const author = await join(board, EDIT_TOKEN);
		await runInDurableObject(board, async (instance, state) => {
			for (let n = 0; n < 128; n++)
				state.storage.sql.exec('INSERT INTO elements VALUES (?, ?, ?, 0, 0, 0)', crypto.randomUUID(), 'rectangle', 'x'.repeat(64 * 1024));
			await instance.webSocketMessage(
				state.getWebSockets()[0],
				JSON.stringify({
					type: 'operation',
					opId: crypto.randomUUID(),
					operation: { action: 'put', element: { ...rectangle, id: crypto.randomUUID() } },
				}),
			);
			expect(state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM elements').one().n).toBe(128);
			expect(state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM operations').one().n).toBe(0);
		});
		await waitForMessage(author.inbox, 'operation-rejected');
		author.socket.close(1000);
	});

	it('rejects late operations without relying on alarm delivery or renewing expired metadata', async () => {
		const board = await newBoard();
		const author = await join(board, EDIT_TOKEN);
		await runInDurableObject(board, async (instance, state) => {
			const deadline = Date.now() - 1;
			state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'expires_at'", String(deadline));
			await instance.webSocketMessage(
				state.getWebSockets()[0],
				JSON.stringify({ type: 'operation', opId: crypto.randomUUID(), operation: { action: 'put', element: rectangle } }),
			);
			expect(state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM operations').one().n).toBe(0);
			expect(state.storage.sql.exec<{ value: string }>("SELECT value FROM meta WHERE key = 'expires_at'").one().value).toBe(
				String(deadline),
			);
			expect(
				(
					await instance.fetch(
						new Request('https://example.com/ws', {
							headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `whiteboard, cap.${EDIT_TOKEN}` },
						}),
					)
				).status,
			).toBe(410);
			await instance.alarm();
			expect(state.storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").toArray()).toEqual([]);
			expect(await state.storage.getAlarm()).toBeNull();
		});
		await waitForMessage(author.inbox, 'board-expired');
	});

	it('rechecks expiry after asynchronous upgrade and hello hashing', async () => {
		for (const phase of ['upgrade', 'hello']) {
			const board = await newBoard();
			const pending =
				phase === 'hello'
					? await board.fetch(
							new Request('https://example.com/ws', {
								headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `whiteboard, cap.${EDIT_TOKEN}` },
							}),
						)
					: null;
			pending?.webSocket?.accept();
			await runInDurableObject(board, async (instance, state) => {
				const base = Date.now();
				state.storage.sql.exec("UPDATE meta SET value = ? WHERE key = 'expires_at'", String(base + 100));
				let now = base;
				const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
				const original = crypto.subtle.digest.bind(crypto.subtle);
				const digest = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
					const result = await original(algorithm, data);
					now = base + 200;
					return result;
				});
				try {
					if (phase === 'upgrade')
						expect(
							(
								await instance.fetch(
									new Request('https://example.com/ws', {
										headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `whiteboard, cap.${EDIT_TOKEN}` },
									}),
								)
							).status,
						).toBe(410);
					else {
						const ws = state.getWebSockets()[0];
						await instance.webSocketMessage(
							ws,
							JSON.stringify({
								type: 'hello',
								token: EDIT_TOKEN,
								participantId: crypto.randomUUID(),
								displayName: 'Tester',
								color: '#0A95FF',
								sinceSeq: 0,
							}),
						);
						expect(ws.deserializeAttachment().authenticated).toBe(false);
						expect(ws.readyState).not.toBe(WebSocket.OPEN);
					}
				} finally {
					digest.mockRestore();
					clock.mockRestore();
				}
			});
		}
	});
	it('never relays private board broadcasts to pending-authentication sockets', async () => {
		const board = await newBoard();
		const author = await join(board, EDIT_TOKEN);
		const pending = await board.fetch(
			new Request('https://example.com/api/boards/board/ws', {
				headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `whiteboard, cap.${VIEW_TOKEN}` },
			}),
		);
		const socket = pending.webSocket!;
		socket.accept();
		const inbox: string[] = [];
		socket.addEventListener('message', (event) => inbox.push(String(event.data)));
		author.socket.send(JSON.stringify({ type: 'chat', body: 'Authenticated participants only' }));
		await waitForMessage(author.inbox, 'chat');
		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(inbox).toEqual([]);
		socket.close(1000, 'test complete');
		author.socket.close(1000, 'test complete');
	});

	it('counts successive presence frames instead of restoring stale rate counters', async () => {
		const board = await newBoard();
		const author = await join(board, EDIT_TOKEN);
		await runInDurableObject(board, async (instance, state) => {
			const socket = state.getWebSockets()[0];
			for (let index = 0; index < 41; index++) {
				await instance.webSocketMessage(socket, JSON.stringify({ type: 'presence', x: index, y: 0, selectedIds: [], tool: 'select' }));
			}
			expect(socket.deserializeAttachment().rateCount).toBe(41);
		});
		const error = await waitForMessage(author.inbox, 'error');
		expect(error.reason).toBe('Message rate exceeded.');
		author.socket.close(1000, 'test complete');
	});

	it('keeps the pending auth deadline and absolute retention during an operation', async () => {
		const board = await newBoard();
		const author = await join(board, EDIT_TOKEN);
		const pending = await board.fetch(
			new Request('https://example.com/api/boards/board/ws', {
				headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `whiteboard, cap.${VIEW_TOKEN}` },
			}),
		);
		pending.webSocket!.accept();
		author.socket.send(
			JSON.stringify({ type: 'operation', opId: crypto.randomUUID(), operation: { action: 'title', title: 'A new title' } }),
		);
		await waitForMessage(author.inbox, 'operation-applied');
		await runInDurableObject(board, async (_instance, state) => {
			const attachment = state
				.getWebSockets()
				.map((socket) => socket.deserializeAttachment())
				.find((value) => !value.authenticated);
			expect(await state.storage.getAlarm()).toBe(attachment.connectedAt + 5_000);
		});
		pending.webSocket!.close(1000, 'test complete');
		author.socket.close(1000, 'test complete');
	});
});
