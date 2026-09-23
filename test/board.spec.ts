import { env, exports } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/index';
import { applyOperation, boardElementSchema, DEFAULT_STYLE, type BoardElement } from '../src/shared/board';
import { hashToken, randomToken, safeEqual } from '../src/shared/crypto';
import { chatMessageSchema, type ServerMessage } from '../src/shared/protocol';
import { centerPlacement, createObjectAt, DEFAULT_SIZES } from '../src/client/editor/shape-defaults';
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

const LIMITER_WINDOW_START = 1_800_000_000_000;

describe('board creation rate limiting', () => {
	it('allows reservations one through five and rejects the sixth', async () => {
		const limiter = env.BOARD_CREATION_RATE_LIMITER.getByName('five-reservations');
		const reservations: boolean[] = [];
		for (let request = 0; request < 6; request += 1) {
			reservations.push(await limiter.reserve(LIMITER_WINDOW_START));
		}
		expect(reservations).toEqual([true, true, true, true, true, false]);
	});

	it('resets reservations at a Unix-aligned window boundary', async () => {
		const limiter = env.BOARD_CREATION_RATE_LIMITER.getByName('fixed-window-reset');
		for (let reservation = 0; reservation < 5; reservation += 1) {
			expect(await limiter.reserve(LIMITER_WINDOW_START + 59_999)).toBe(true);
		}
		expect(await limiter.reserve(LIMITER_WINDOW_START + 59_999)).toBe(false);
		expect(await limiter.reserve(LIMITER_WINDOW_START + 60_000)).toBe(true);
	});

	it('atomically caps concurrent reservations', async () => {
		const limiter = env.BOARD_CREATION_RATE_LIMITER.getByName('concurrent-reservations');
		const reservations = await Promise.all(Array.from({ length: 6 }, () => limiter.reserve(LIMITER_WINDOW_START)));
		expect(reservations.filter(Boolean)).toHaveLength(5);
		expect(reservations.filter((accepted) => !accepted)).toHaveLength(1);
	});

	it('keeps distinct client addresses independent', async () => {
		const firstName = await hashToken('192.0.2.60');
		const secondName = await hashToken('192.0.2.61');
		expect(firstName).not.toBe(secondName);
		const first = env.BOARD_CREATION_RATE_LIMITER.getByName(firstName);
		const second = env.BOARD_CREATION_RATE_LIMITER.getByName(secondName);

		for (let reservation = 0; reservation < 5; reservation += 1) {
			expect(await first.reserve(LIMITER_WINDOW_START)).toBe(true);
		}
		expect(await first.reserve(LIMITER_WINDOW_START)).toBe(false);
		expect(await second.reserve(LIMITER_WINDOW_START)).toBe(true);
	});

	it('deletes inactive storage and recreates its schema on the next reservation', async () => {
		const limiter = env.BOARD_CREATION_RATE_LIMITER.getByName('alarm-cleanup');
		for (let reservation = 0; reservation < 5; reservation += 1) {
			expect(await limiter.reserve(LIMITER_WINDOW_START)).toBe(true);
		}
		expect(await limiter.reserve(LIMITER_WINDOW_START)).toBe(false);

		await runInDurableObject(limiter, async (_instance, state) => {
			state.storage.sql.exec('UPDATE reservation_window SET cleanup_at = 0 WHERE singleton = 1');
			await state.storage.setAlarm(Date.now() + 60_000);
		});
		expect(await runDurableObjectAlarm(limiter)).toBe(true);
		expect(await limiter.reserve(LIMITER_WINDOW_START)).toBe(true);
	});
});

describe('Worker and Durable Object integration', () => {
	function boardRequest(ip?: string, forwardedFor?: string): Request {
		const headers = new Headers();
		if (ip) headers.set('CF-Connecting-IP', ip);
		if (forwardedFor) headers.set('X-Forwarded-For', forwardedFor);
		return new Request('https://example.com/api/boards', { method: 'POST', headers });
	}

	function withLimiter(reserve: () => Promise<boolean>, objectNames?: string[]): Env {
		return new Proxy(env, {
			get(target, property, receiver) {
				if (property === 'BOARD_CREATION_RATE_LIMITER') {
					return {
						getByName(name: string) {
							objectNames?.push(name);
							return { reserve };
						},
					};
				}
				return Reflect.get(target, property, receiver);
			},
		});
	}

	it('creates a board with distinct capability tokens', async () => {
		const response = await exports.default.fetch(boardRequest('192.0.2.10'));
		expect(response.status).toBe(201);
		const body = (await response.json()) as { boardId: string; editToken: string; viewToken: string; expiresAt: number };
		expect(body.boardId.length).toBeGreaterThan(20);
		expect(body.editToken).not.toBe(body.viewToken);
		expect(body.expiresAt).toBeGreaterThan(Date.now());
	});

	it('returns 429 when the limiter denies a reservation', async () => {
		const response = await worker.fetch(
			boardRequest('192.0.2.20'),
			withLimiter(() => Promise.resolve(false)),
		);
		expect(response.status).toBe(429);
	});

	it('fails closed when the platform client address is missing', async () => {
		const response = await exports.default.fetch(boardRequest(undefined, '198.51.100.1'));
		expect(response.status).toBe(500);
	});

	it('ignores spoofable forwarding headers', async () => {
		const objectNames: string[] = [];
		const recordingEnv = withLimiter(() => Promise.resolve(true), objectNames);
		const first = await worker.fetch(boardRequest('192.0.2.30', '198.51.100.1'), recordingEnv);
		const second = await worker.fetch(boardRequest('192.0.2.30', '198.51.100.2'), recordingEnv);
		expect([first.status, second.status]).toEqual([201, 201]);
		const expectedName = await hashToken('192.0.2.30');
		expect(objectNames).toEqual([expectedName, expectedName]);
	});

	it('fails closed when the limiter RPC or storage operation rejects', async () => {
		const response = await worker.fetch(
			boardRequest('192.0.2.40'),
			withLimiter(() => Promise.reject(new Error('Limiter reservation failed'))),
		);
		expect(response.status).toBe(500);
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

async function join(board: Board, token: string) {
	const response = await board.fetch(new Request('https://example.com/api/boards/board/ws', { headers: { Upgrade: 'websocket' } }));
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
			sinceSeq: 0,
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
