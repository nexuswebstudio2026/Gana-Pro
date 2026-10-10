import type { APIRoute } from 'astro';
import { verifyPassword } from '../../lib/crypto';
import { readJSON } from '../../lib/store';
import { getGoogleSheetUsers } from '../../lib/sheets';
import { createSession, setSessionCookie } from '../../lib/session';
import type { User } from '../../lib/types';

// API routes must be server-rendered, not prerendered as static
export const prerender = false;

export const POST: APIRoute = async (Astro) => {
	try {
		// Parse form data from the request body
		const body = await Astro.request.text();
		const params = new URLSearchParams(body);
		const username = params.get('username')?.trim() ?? '';
		const password = params.get('password') ?? '';

		// --- Validation ---
		if (!username || !password) {
			return Astro.redirect('/login?error=' + encodeURIComponent('Debes ingresar tu usuario y contraseña.'), 303);
		}

		// 1. Consultar usuarios en Google Sheets
		let sheetUsers: User[] = [];
		try {
			sheetUsers = await getGoogleSheetUsers();
		} catch (sheetErr) {
			console.error('Error fetching users from Google Sheet during login:', sheetErr);
		}

		// 2. Consultar usuarios locales
		let localUsers: User[] = [];
		try {
			localUsers = readJSON<User[]>('users.json', []);
		} catch {
			localUsers = [];
		}

		const allUsers = [...sheetUsers, ...localUsers];

		// El acceso es exclusivamente por nombre de usuario: el correo no sirve
		// para iniciar sesión. La comparación no distingue mayúsculas.
		const target = username.toLowerCase();
		const user = allUsers.find((u) => (u.username ?? '').trim().toLowerCase() === target);

		if (!user || !verifyPassword(password, user.password)) {
			return Astro.redirect('/login?error=' + encodeURIComponent('Credenciales incorrectas. Inténtalo de nuevo.'), 303);
		}

		// --- Create session ---
		const token = createSession(user.username, user.email, user.role || 'User');
		setSessionCookie(Astro, token);

		// Redirect to dashboard
		return Astro.redirect('/dashboard?solicitarUbicacion=1', 303);
	} catch (err) {
		// El detalle va al log del servidor; al usuario solo se le muestra un
		// mensaje generico. Volcar `err.message` en el cuerpo filtraba nombres de
		// variables de entorno y la estructura interna del servidor.
		console.error('[login] Error al iniciar sesion:', err);

		// Un fallo de configuracion (p. ej. sin SESSION_SECRET) no es culpa del
		// usuario: se le devuelve al formulario en vez de un 500 en crudo.
		const misconfigured =
			err instanceof Error && /SESSION_SECRET/i.test(err.message);
		if (misconfigured) {
			return Astro.redirect(
				'/login?error=' +
					encodeURIComponent(
						'El servicio no esta disponible temporalmente. Intenta de nuevo en unos minutos.'
					),
				303
			);
		}

		return new Response('ERROR: No se pudo iniciar sesion.', { status: 500 });
	}
};
