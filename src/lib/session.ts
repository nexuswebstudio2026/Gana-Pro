import { randomBytes, createHmac } from 'node:crypto';
import type { APIContext } from 'astro';
import { readJSON, writeJSON } from './store';

export interface Session {
	token: string;
	username: string;
	email: string;
	role?: string;
	expiresAt: number; // Unix timestamp in ms
}

/** Number of milliseconds a session token remains valid. */
const SESSION_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

/** Name of the cookie used to store the session token. */
export const SESSION_COOKIE = 'auth_session';

/**
 * Secreto con el que se firman las sesiones.
 *
 * Se usa `SESSION_SECRET` y ya no la clave privada de Google: rotar la clave de
 * Google no debe invalidar las sesiones, y un secreto que cambia por accident
 * con cada despliegue deja a todos los usuarios fuera del panel.
 *
 * En desarrollo se genera uno aleatorio por proceso si no se define, de modo
 * que las sesiones de la copia local nunca son firmadas con un valor público
 * conocido.
 *
 * En producción, si falta la variable NO se inventa ningún valor: se deja en
 * `null` y el sitio sigue funcionando (las páginas públicas se ven), pero
 * ninguna sesión puede validarse ni emitirse. Antes este caso lanzaba un error
 * al importar el módulo, y como `src/middleware.ts` importa este archivo, el
 * fallo se reproducia en TODA petición y devolvía un 500 incluso en la portada.
 * Fallar hacia abajo es lo correcto: preferimos que el panel no entre a que
 * cualquiera pueda firmar su propio cookie de administrador con un secreto
 * predecible.
 */
const SECRET = ((): string | null => {
	const configured = process.env.SESSION_SECRET?.trim();
	if (configured) return configured;

	if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
		console.error(
			'[session] FALTA SESSION_SECRET: el sitio arrancará, pero no se podrá ' +
				'iniciar sesión ni entrar al panel. Defina la variable en el servidor.'
		);
		return null;
	}

	console.warn(
		'[session] SESSION_SECRET no esta definido: se genera uno aleatorio para ' +
			'este proceso. Las sesiones se invalidaran al reiniciar el servidor.'
	);
	return randomBytes(32).toString('hex');
})();

function sign(payload: string): string {
	// Sin secreto no se firma nada. `validateSession` ya trata `null` como
	// "sin sesión", así que el fallo queda contenido aquí.
	if (!SECRET) return '';
	return createHmac('sha256', SECRET).update(payload).digest('hex');
}

/** In-memory fallback if filesystem is read-only (like Vercel Lambda) */
const memorySessions = new Map<string, Session>();

/**
 * Read all sessions from the data store.
 */
function getSessions(): Session[] {
	try {
		return readJSON<Session[]>('sessions.json', []);
	} catch {
		return Array.from(memorySessions.values());
	}
}

/**
 * Persist sessions to the data store.
 */
function saveSessions(sessions: Session[]): void {
	try {
		writeJSON('sessions.json', sessions);
	} catch {
		// Ignore write errors in read-only serverless filesystems
	}
	memorySessions.clear();
	for (const s of sessions) {
		memorySessions.set(s.token, s);
	}
}

/**
 * Create a new signed session token that works stateless in serverless environments.
 */
export function createSession(username: string, email: string, role = 'User'): string {
	// Sin secreto no se puede firmar nada. Se lanza aquí (y no al importar el
	// módulo) para que el fallo aparezca en el endpoint de login, en lugar de
	// tumbar todas las rutas del sitio.
	if (!SECRET) {
		throw new Error(
			'No se puede iniciar sesión: falta SESSION_SECRET en el servidor.'
		);
	}

	const expiresAt = Date.now() + SESSION_DURATION;
	const payload = Buffer.from(JSON.stringify({ username, email, role, expiresAt })).toString('base64url');
	const signature = sign(payload);
	const signedToken = `${payload}.${signature}`;

	try {
		const sessions = getSessions();
		const filtered = sessions.filter((s) => s.username !== username);
		filtered.push({
			token: signedToken,
			username,
			email,
			role,
			expiresAt,
		});
		saveSessions(filtered);
	} catch {
		// Fallback ok
	}

	return signedToken;
}

/**
 * Validate a session token. Returns the session if valid, otherwise `null`.
 */
export function validateSession(token: string | undefined): Session | null {
	if (!token) return null;

	// Sin secreto no se puede comprobar ninguna firma: se trata como "sin
	// sesión". Evita además que una firma vacía llegue a coincidir por accidente.
	if (!SECRET) return null;

	// 1. Try stateless validation first (works across Vercel serverless instances)
	if (token.includes('.')) {
		const [payloadStr, signature] = token.split('.');
		if (payloadStr && signature) {
			const expectedSig = sign(payloadStr);
			if (expectedSig === signature) {
				try {
					const data = JSON.parse(Buffer.from(payloadStr, 'base64url').toString('utf-8'));
					if (data.expiresAt > Date.now()) {
						return {
							token,
							username: data.username,
							email: data.email,
							role: data.role,
							expiresAt: data.expiresAt,
						};
					}
				} catch {
					// invalid payload
				}
			}
		}
	}

	// 2. Fallback to stateful check
	try {
		const sessions = getSessions();
		const now = Date.now();
		const valid = sessions.filter((s) => s.expiresAt > now);
		const session = valid.find((s) => s.token === token);
		return session ?? null;
	} catch {
		return null;
	}
}

/**
 * Delete a session token (logout).
 */
export function destroySession(token: string | undefined): void {
	if (!token) return;
	try {
		const sessions = getSessions();
		const filtered = sessions.filter((s) => s.token !== token);
		saveSessions(filtered);
	} catch {
		// ignore
	}
}

/**
 * Helper: set the session cookie on an Astro API response.
 */
export function setSessionCookie(Astro: APIContext, token: string): void {
	const expires = new Date(Date.now() + SESSION_DURATION);
	Astro.cookies.set(SESSION_COOKIE, token, {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production',
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
