import type { APIRoute } from 'astro';
import { hashPassword } from '../../lib/crypto';
import { readJSON, writeJSON } from '../../lib/store';
import { getGoogleSheetUsers, appendGoogleSheetUser } from '../../lib/sheets';
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

		// Check for duplicates in Google Sheets
		let sheetUsers: User[] = [];
		try {
			sheetUsers = await getGoogleSheetUsers();
		} catch (sheetErr) {
			console.error('Error fetching users from Google Sheet:', sheetErr);
		}

		// Also check local json users if any
		let localUsers: User[] = [];
		try {
			localUsers = readJSON<User[]>('users.json', []);
		} catch {
			localUsers = [];
		}

		const allUsers = [...sheetUsers, ...localUsers];

		if (allUsers.some((u) => u.username?.toLowerCase() === username.toLowerCase())) {
			return Astro.redirect('/register?error=' + encodeURIComponent('El nombre de usuario ya está en uso.'), 303);
		}
		if (allUsers.some((u) => u.email?.toLowerCase() === email)) {
			return Astro.redirect('/register?error=' + encodeURIComponent('El correo electrónico ya está registrado.'), 303);
		}

		// --- Hash password and save ---
		const passwordHash = hashPassword(password);

		// 1. Guardar en Google Sheets
		try {
			await appendGoogleSheetUser({
				username,
				email,
				passwordHash,
			});
		} catch (sheetSaveErr) {
			console.error('Error al guardar usuario en Google Sheet:', sheetSaveErr);
			return Astro.redirect('/register?error=' + encodeURIComponent('No se pudo guardar el registro en Google Sheets. Intente de nuevo más tarde.'), 303);
		}

		// 2. Backup opcional en JSON local
		try {
			const newUser: User = {
				username,
				email,
				password: passwordHash,
			};
			localUsers.push(newUser);
			writeJSON('users.json', localUsers);
		} catch {
			// Ignore local store error on serverless environments
		}

		// Redirect to login on success
		return Astro.redirect('/login?registered=1', 303);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		return new Response('ERROR: ' + msg, { status: 500 });
	}
};
