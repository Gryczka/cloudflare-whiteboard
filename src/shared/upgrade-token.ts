/** Capability stays out of request URLs and is checked before socket acceptance. */
export function upgradeToken(request: Request): string | null {
	return request.headers.get('Sec-WebSocket-Protocol')?.match(/^whiteboard,[ \t]*cap\.([A-Za-z0-9_-]{16,256})$/)?.[1] ?? null;
}
