import { randomBytes } from 'node:crypto';
import type { APIContext } from 'astro';
import { readJSON, writeJSON } from './store';

export interface Session {
	token: string;
	username: string;
	email: string;
	expiresAt: number; // Unix timestamp in ms
}

/** Number of seconds a session token remains valid. */
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Name of the cookie used to store the session token. */
export const SESSION_COOKIE = 'auth_session';

/**
 * Generate a cryptographically random session token.
 */
function generateToken(): string {
	return randomBytes(32).toString('hex');
}

/**
 * Read all sessions from the data store.
 */
function getSessions(): Session[] {
	return readJSON<Session[]>('sessions.json', []);
}

/**
 * Persist sessions to the data store.
 */
function saveSessions(sessions: Session[]): void {
	writeJSON('sessions.json', sessions);
}

/**
 * Create a new session for the given user and return the token.
 */
export function createSession(username: string, email: string): string {
	const token = generateToken();
	const sessions = getSessions();
	// Remove any existing sessions for this user
	const filtered = sessions.filter((s) => s.username !== username);
	filtered.push({
		token,
		username,
		email,
		expiresAt: Date.now() + SESSION_DURATION,
	});
	saveSessions(filtered);
	return token;
}

/**
 * Validate a session token. Returns the session if valid, otherwise `null`.
 */
export function validateSession(token: string | undefined): Session | null {
	if (!token) return null;

	const sessions = getSessions();
	const now = Date.now();

	// Clean up expired sessions
	const valid = sessions.filter((s) => s.expiresAt > now);
	if (valid.length !== sessions.length) {
		saveSessions(valid);
	}

	const session = valid.find((s) => s.token === token);
	return session ?? null;
}

/**
 * Delete a session token (logout).
 */
export function destroySession(token: string | undefined): void {
	if (!token) return;
	const sessions = getSessions();
	const filtered = sessions.filter((s) => s.token !== token);
	saveSessions(filtered);
}

/**
 * Helper: set the session cookie on an Astro API response.
 */
export function setSessionCookie(Astro: APIContext, token: string): void {
	const expires = new Date(Date.now() + SESSION_DURATION);
	Astro.cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		secure: false, // Set to true in production with HTTPS
		sameSite: 'lax',
		expires,
	});
}

/**
 * Helper: clear the session cookie from the response.
 */
export function clearSessionCookie(Astro: APIContext): void {
	Astro.cookies.delete(SESSION_COOKIE, { path: '/' });
}

/**
 * Helper: read the session token from the request cookies.
 */
export function getSessionToken(Astro: APIContext): string | undefined {
	return Astro.cookies.get(SESSION_COOKIE)?.value;
}

/**
 * Get the current authenticated user from the request cookies.
 * Returns `null` if not authenticated.
 */
export function getCurrentUser(Astro: APIContext): Session | null {
	const token = getSessionToken(Astro);
	return validateSession(token);
}