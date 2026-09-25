import { pbkdf2Sync, randomBytes } from 'node:crypto';

/**
 * Number of PBKDF2 iterations for password hashing.
 * 100,000 provides a good balance between security and performance.
 */
const ITERATIONS = 100_000;

/**
 * Hash a plain-text password using PBKDF2 with a random salt.
 * Returns a string in the format `salt:hash`.
 */
export function hashPassword(password: string): string {
	const salt = randomBytes(16).toString('hex');
	const hash = pbkdf2Sync(password, salt, ITERATIONS, 64, 'sha256').toString('hex');
	return `${salt}:${hash}`;
}

/**
 * Verify a plain-text password against a stored string.
 * Supports standard `salt:hash` (PBKDF2) format and fallback for plain text if applicable.
 */
export function verifyPassword(password: string, stored: string): boolean {
	if (!stored) return false;

	// Check if it's salt:hash format
	if (stored.includes(':')) {
		const [salt, hash] = stored.split(':');
		if (salt && hash) {
			const verifyHash = pbkdf2Sync(password, salt, ITERATIONS, 64, 'sha256').toString('hex');
			if (hash === verifyHash) return true;
		}
	}

	// Fallback to direct comparison (in case stored as plain text)
	return password === stored;
}
