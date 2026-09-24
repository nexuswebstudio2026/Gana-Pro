import type { APIRoute } from 'astro';
import { hashPassword } from '../../lib/crypto';
import { readJSON, writeJSON } from '../../lib/store';
import type { User } from '../../lib/types';

// API routes must be server-rendered, not prerendered as static
export const prerender = false;

export const POST: APIRoute = async (Astro) => {
	try {
		// Parse form data from the request body
		const body = await Astro.request.text();
		const params = new URLSearchParams(body);
		const username = params.get('username')?.trim() ?? '';
		const email = params.get('email')?.trim().toLowerCase() ?? '';
		const password = params.get('password') ?? '';
		const passwordConfirm = params.get('passwordConfirm') ?? '';

		// --- Validation ---
		if (!username || !email || !password) {
			return Astro.redirect('/register?error=' + encodeURIComponent('Todos los campos son obligatorios.'), 303);
		}
		if (password !== passwordConfirm) {
			return Astro.redirect('/register?error=' + encodeURIComponent('Las contraseñas no coinciden.'), 303);
		}
		if (password.length < 6) {
			return Astro.redirect('/register?error=' + encodeURIComponent('La contraseña debe tener al menos 6 caracteres.'), 303);
		}

		const users = readJSON<User[]>('users.json', []);

		// Check for duplicates
		if (users.some((u) => u.username === username)) {
			return Astro.redirect('/register?error=' + encodeURIComponent('El nombre de usuario ya está en uso.'), 303);
		}
		if (users.some((u) => u.email === email)) {
			return Astro.redirect('/register?error=' + encodeURIComponent('El correo electrónico ya está registrado.'), 303);
		}

		// --- Create user ---
		const newUser: User = {
			username,
			email,
			password: hashPassword(password),
		};
		users.push(newUser);
		writeJSON('users.json', users);

		// Redirect to login on success
		return Astro.redirect('/login?registered=1', 303);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return new Response('ERROR: ' + msg, { status: 500 });
	}
};