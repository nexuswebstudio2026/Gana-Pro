import type { APIContext, APIRoute } from 'astro';
import { readJSON, writeJSON } from '../../lib/store';
import { getGoogleSheetUsers, updateSheetUserPassword } from '../../lib/sheets';
import { hashPassword } from '../../lib/crypto';
import type { User } from '../../lib/types';

// API routes must be server-rendered, not prerendered as static
export const prerender = false;

/** Un mismo correo no puede repetir el paso 1 tan seguido. */
const LOOKUP_COOLDOWN = 30 * 1000; // 30 segundos
const lastLookup = new Map<string, number>();

/**
 * PASO 1 — El usuario escribe su correo. Si existe, se le devuelve su nombre
 * de usuario para poder escribir la nueva clave.
 */
export const POST: APIRoute = async (Astro) => {
	try {
		const body = await Astro.request.text();
		const params = new URLSearchParams(body);
		const email = params.get('email')?.trim().toLowerCase() ?? '';

		// Un formulario HTML solo puede enviar POST: si trae los campos de la
		// nueva contraseña, es que ya viene del paso 2.
		if (params.get('newPassword') !== null || params.get('username')) {
			return resetPassword(Astro, params);
		}

		if (!email) {
			return Astro.redirect(
				'/forgot-password?error=' + encodeURIComponent('Debes ingresar tu correo electrónico.'),
				303
			);
		}

		// Freno simple para no poder enumerar correos a velocidad.
		const previo = lastLookup.get(email);
		if (previo && Date.now() - previo < LOOKUP_COOLDOWN) {
			return Astro.redirect(
				'/forgot-password?error=' +
					encodeURIComponent('Espere unos segundos antes de volver a intentarlo.'),
				303
			);
		}
		lastLookup.set(email, Date.now());

		const user = await buscarPorEmail(email);
		if (!user) {
			return Astro.redirect(
				'/forgot-password?error=' +
					encodeURIComponent('No encontramos una cuenta con ese correo electrónico.'),
				303
			);
		}

		return Astro.redirect(
			'/forgot-password?user=' +
				encodeURIComponent(user.username) +
				'&email=' +
				encodeURIComponent(user.email),
			303
		);
	} catch (err) {
		console.error('Error en forgot-password (paso 1):', err);
		return new Response('ERROR', { status: 500 });
	}
};

/**
 * PASO 2 — Se escribe la nueva contraseña. Se hashea y reemplaza tanto en
 * Google Sheets como en la copia local, y se cierran las sesiones abiertas.
 */
async function resetPassword(
	Astro: APIContext,
	params: URLSearchParams
): Promise<Response> {
	try {
		const username = params.get('username')?.trim() ?? '';
		const email = params.get('email')?.trim().toLowerCase() ?? '';
		const newPassword = params.get('newPassword') ?? '';
		const confirmPassword = params.get('confirmPassword') ?? '';

		const volver = '&user=' + encodeURIComponent(username) + '&email=' + encodeURIComponent(email);
		const fallo = (m: string) =>
			Astro.redirect('/forgot-password?error=' + encodeURIComponent(m) + volver, 303);

		if (!username || !newPassword) {
			return fallo('Debes completar todos los datos.');
		}
		if (newPassword.length < 6) {
			return fallo('La nueva contraseña debe tener al menos 6 caracteres.');
		}
		if (newPassword !== confirmPassword) {
			return fallo('Las contraseñas no coinciden.');
		}

		// El correo debe seguir perteneciendo a ese usuario: impide cambiar la
		// clave de otra cuenta solo escribiendo su nombre en la URL.
		const user = await buscarPorUsuario(username);
		if (!user || (email && (user.email ?? '').toLowerCase() !== email)) {
			return fallo('Los datos no coinciden con ninguna cuenta.');
		}

		const hashed = hashPassword(newPassword);

		// 1. Google Sheets, que es la fuente de verdad del proyecto
		let okHoja = false;
		try {
			okHoja = await updateSheetUserPassword(user.username, hashed);
		} catch (e) {
			console.error('No se pudo actualizar la contraseña en Google Sheets:', e);
		}

		// 2. Copia local, para que el cambio aplique de inmediato
		try {
			const localUsers = readJSON<User[]>('users.json', []);
			const idx = localUsers.findIndex(
				(u) => (u.username ?? '').toLowerCase() === user.username.toLowerCase()
			);
			if (idx >= 0) {
				localUsers[idx] = { ...localUsers[idx], password: hashed };
				writeJSON('users.json', localUsers);
			}
		} catch (e) {
			console.error('No se pudo actualizar la copia local:', e);
		}

		if (!okHoja) {
			console.warn(
				'El usuario ' + user.username + ' no está en Google Sheets: solo se actualizó localmente.'
			);
		}

		// 3. Se invalidan las sesiones abiertas: la clave anterior deja de servir.
		try {
			const sessions = readJSON<{ username: string }[]>('sessions.json', []);
			writeJSON(
				'sessions.json',
				sessions.filter((s) => (s.username ?? '').toLowerCase() !== user.username.toLowerCase())
			);
		} catch {
			// si no hay sesiones guardadas, no hay nada que invalidar
		}

		return Astro.redirect('/login?reset=1', 303);
	} catch (err) {
		console.error('Error en forgot-password (paso 2):', err);
		return new Response('ERROR', { status: 500 });
	}
}

/** Carga Google Sheets y la copia local en un solo arreglo. */
async function todosLosUsuarios(): Promise<User[]> {
	let sheetUsers: User[] = [];
	try {
		sheetUsers = await getGoogleSheetUsers();
	} catch (e) {
		console.error('Error consultando Google Sheets:', e);
	}
	let localUsers: User[] = [];
	try {
		localUsers = readJSON<User[]>('users.json', []);
	} catch {
		localUsers = [];
	}
	return [...sheetUsers, ...localUsers];
}

async function buscarPorEmail(email: string): Promise<User | null> {
	const target = email.trim().toLowerCase();
	const todas = await todosLosUsuarios();
	return todas.find((u) => (u.email ?? '').trim().toLowerCase() === target) ?? null;
}

async function buscarPorUsuario(username: string): Promise<User | null> {
	const target = username.trim().toLowerCase();
	const todas = await todosLosUsuarios();
	return todas.find((u) => (u.username ?? '').trim().toLowerCase() === target) ?? null;
}

