/** Worker entrypoint for board creation, WebSocket routing, and static assets. */
import { hashToken, randomToken } from './shared/crypto';
import { BoardDurableObject } from './server/board-do';
import { BoardDirectory } from './server/board-directory';
import { upgradeToken } from './shared/upgrade-token';

export { BoardDurableObject, BoardDirectory };
type Bindings = Omit<Env, 'LEGACY_BOARD_OBJECT_IDS'> & { LEGACY_BOARD_OBJECT_IDS: string };

function json(data: unknown, init?: ResponseInit): Response {
	return Response.json(data, {
		...init,
		headers: { 'cache-control': 'no-store', ...init?.headers },
	});
}

function withSecurityHeaders(response: Response): Response {
	const secured = new Response(response.body, response);
	secured.headers.set('Referrer-Policy', 'no-referrer');
	secured.headers.set('X-Content-Type-Options', 'nosniff');
	secured.headers.set('X-Frame-Options', 'DENY');
	secured.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	secured.headers.set(
		'Content-Security-Policy',
		"default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
	);
	return secured;
}

export default {
	async fetch(request: Request, env: Bindings): Promise<Response> {
		const url = new URL(request.url);

		try {
			if (request.method === 'POST' && url.pathname === '/api/boards') {
				const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
				const rate = await env.BOARD_CREATION_LIMIT.limit({ key: ip });
				if (!rate.success) return json({ error: 'Too many boards created. Try again in a minute.' }, { status: 429 });

				const boardId = randomToken(16);
				const editToken = randomToken(24);
				const viewToken = randomToken(24);
				const [editHash, viewHash] = await Promise.all([hashToken(editToken), hashToken(viewToken)]);
				const ttl = Number.parseInt(env.BOARD_TTL_DAYS, 10);
				const days = Number.isFinite(ttl) ? Math.max(1, Math.min(ttl, 90)) : 30;
				const expiresAt = Date.now() + days * 86_400_000;
				if (!(await env.BOARD_DIRECTORY.getByName('global').reserve(boardId, editHash, viewHash, expiresAt))) {
					return json({ error: 'Board admission allowance exhausted.' }, { status: 429 });
				}
				const board = env.BOARDS.getByName(boardId);
				const result = await board.initialize(editHash, viewHash, days, expiresAt);

				console.log(JSON.stringify({ event: 'board_created', board: boardId.slice(0, 8) }));
				return json({ boardId, editToken, viewToken, expiresAt: result.expiresAt }, { status: 201 });
			}

			const websocketMatch = url.pathname.match(/^\/api\/boards\/([A-Za-z0-9_-]{20,30})\/ws$/);
			if (websocketMatch) {
				if (request.headers.get('Upgrade') !== 'websocket') {
					return json({ error: 'Expected a WebSocket upgrade.' }, { status: 426 });
				}
				const token = upgradeToken(request);
				if (!token) return json({ error: 'Capability required.' }, { status: 403 });
				const boardId = websocketMatch[1];
				const authorized = await env.BOARD_DIRECTORY.getByName('global').authorize(boardId, await hashToken(token));
				if (!authorized) {
					const ids: unknown = JSON.parse(env.LEGACY_BOARD_OBJECT_IDS);
					if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))) {
						throw new Error('Invalid legacy board manifest');
					}
					// Hashing a name is local; only inventory-verified legacy actors may be dispatched.
					if (!ids.includes(env.BOARDS.idFromName(boardId).toString()))
						return json({ error: 'Board not found or capability invalid.' }, { status: 404 });
				}
				return env.BOARDS.getByName(boardId).fetch(request);
			}

			if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, { status: 404 });
			const response = withSecurityHeaders(await env.ASSETS.fetch(request));
			if (url.pathname.startsWith('/board/')) response.headers.set('X-Robots-Tag', 'noindex, nofollow');
			return response;
		} catch (error) {
			console.error(
				JSON.stringify({ event: 'request_failed', path: url.pathname, error: error instanceof Error ? error.message : String(error) }),
			);
			return json({ error: 'Internal server error' }, { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
