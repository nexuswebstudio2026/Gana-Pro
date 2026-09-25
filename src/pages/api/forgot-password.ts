import type { APIRoute } from 'astro';
import { readJSON, writeJSON } from '../../lib/store';
import { randomBytes } from 'node:crypto';
import type { User } from '../../lib/types';

interface ResetToken {
	email: string;
	token: string;
	expiresAt: number;
}

const TOKEN_DURATION = 60 * 60 * 1000; // 1 hour

// API routes must be server-rendered, not prerendered as static
export const prerender = false;

export const POST: APIRoute = async (Astro) => {
	try {
		const body = await Astro.request.text();
		const params = new URLSearchParams(body);
		const email = params.get('email')?.trim().toLowerCase() ?? '';

		if (!email) {
			return Astro.redirect('/forgot-password?error=' + encodeURIComponent('Debes ingresar tu correo electrónico.'), 303);
		}

		const users = readJSON<User[]>('users.json', []);
		const user = users.find((u) => u.email === email);

		// Always return success to avoid revealing whether the email exists
		if (user) {
			const token = randomBytes(32).toString('hex');
			const existing = readJSON<ResetToken[]>('reset-tokens.json', []);
			const filtered = existing.filter((r) => r.email !== email);
			filtered.push({ email, token, expiresAt: Date.now() + TOKEN_DURATION });
			writeJSON('reset-tokens.json', filtered);

			console.log('[Password Reset] Token for ' + email + ': ' + token);
		}

		return Astro.redirect('/forgot-password?sent=1', 303);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return new Response('ERROR: ' + msg, { status: 500 });
	}
};
