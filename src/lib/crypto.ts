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
 * Verify a plain-text password against a stored `salt:hash` string.
 */
export function verifyPassword(password: string, stored: string): boolean {
	const [salt, hash] = stored.split(':');
	if (!salt || !hash) return false;
	const verifyHash = pbkdf2Sync(password, salt, ITERATIONS, 64, 'sha256').toString('hex');
	return hash === verifyHash;
}