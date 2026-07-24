/** Cryptographic capability generation, hashing, and constant-work comparison. */

/** Generates a URL-safe capability token from cryptographically secure random bytes. */
export function randomToken(byteLength = 24): string {
	const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Hashes a capability before persistence so plaintext tokens never enter SQLite. */
export async function hashToken(token: string): Promise<string> {
	const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
	const bytes = new Uint8Array(hash);
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** Compares equal-length hashes without returning early on a mismatched byte. */
export function safeEqual(left: string, right: string): boolean {
	const encoder = new TextEncoder();
	const leftBytes = encoder.encode(left);
	const rightBytes = encoder.encode(right);
	if (leftBytes.byteLength !== rightBytes.byteLength) return false;
	let difference = 0;
	for (let index = 0; index < leftBytes.byteLength; index += 1) {
		difference |= leftBytes[index] ^ rightBytes[index];
	}
	return difference === 0;
}
