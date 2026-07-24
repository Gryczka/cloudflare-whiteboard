import { env, exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { applyOperation, boardElementSchema, DEFAULT_STYLE, type BoardElement } from '../src/shared/board';
import { hashToken, randomToken, safeEqual } from '../src/shared/crypto';
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
