import type { APIRoute } from 'astro';
import { verifyPassword } from '../../lib/crypto';
import { readJSON } from '../../lib/store';
import { createSession, setSessionCookie } from '../../lib/session';
import type { User } from '../../lib/types';

// API routes must be server-rendered, not prerendered as static
export const prerender = false;

export const POST: APIRoute = async (Astro) => {
	try {
		// Parse form data from the request body
		const body = await Astro.request.text();
		const params = new URLSearchParams(body);
		const identifier = params.get('identifier')?.trim() ?? '';
		const password = params.get('password') ?? '';

		// --- Validation ---
		if (!identifier || !password) {
			return Astro.redirect('/login?error=' + encodeURIComponent('Debes ingresar tu nombre de usuario y contraseña.'), 303);
		}

		const users = readJSON<User[]>('users.json', []);
		const user = users.find((u) => u.username === identifier || u.email === identifier);

		if (!user || !verifyPassword(password, user.password)) {
			return Astro.redirect('/login?error=' + encodeURIComponent('Credenciales incorrectas. Inténtalo de nuevo.'), 303);
		}

		// --- Create session ---
		const token = createSession(user.username, user.email);
		setSessionCookie(Astro, token);

		// Redirect to dashboard
		return Astro.redirect('/dashboard', 303);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return new Response('ERROR: ' + msg, { status: 500 });
	}
};