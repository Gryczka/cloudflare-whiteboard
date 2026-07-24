/** Worker entrypoint for board creation, WebSocket routing, and static assets. */
import { hashToken, randomToken } from './shared/crypto';
import { BoardDurableObject } from './server/board-do';

export { BoardDurableObject };

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
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);

		try {
			if (request.method === 'POST' && url.pathname === '/api/boards') {
				const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
				const rate = await env.BOARD_CREATION_LIMIT.limit({ key: ip });
				if (!rate.success) return json({ error: 'Too many boards created. Try again in a minute.' }, { status: 429 });

				const boardId = randomToken(16);
				const editToken = randomToken(24);
				const viewToken = randomToken(24);
				const board = env.BOARDS.getByName(boardId);
				const result = await board.initialize(
					await hashToken(editToken),
					await hashToken(viewToken),
					Number.parseInt(env.BOARD_TTL_DAYS, 10),
				);

				console.log(JSON.stringify({ event: 'board_created', board: boardId.slice(0, 8) }));
				return json({ boardId, editToken, viewToken, expiresAt: result.expiresAt }, { status: 201 });
			}

			const websocketMatch = url.pathname.match(/^\/api\/boards\/([A-Za-z0-9_-]{20,30})\/ws$/);
			if (websocketMatch) {
				if (request.headers.get('Upgrade') !== 'websocket') {
					return json({ error: 'Expected a WebSocket upgrade.' }, { status: 426 });
				}
				return env.BOARDS.getByName(websocketMatch[1]).fetch(request);
			}

			if (url.pathname.startsWith('/api/')) return json({ error: 'Not found' }, { status: 404 });
			return withSecurityHeaders(await env.ASSETS.fetch(request));
		} catch (error) {
			console.error(
				JSON.stringify({ event: 'request_failed', path: url.pathname, error: error instanceof Error ? error.message : String(error) }),
			);
			return json({ error: 'Internal server error' }, { status: 500 });
		}
	},
} satisfies ExportedHandler<Env>;
