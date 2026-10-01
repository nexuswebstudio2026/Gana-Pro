import type { APIRoute } from 'astro';
import { isAdminRole } from '../../../lib/auth';
import { clearSheetUserProfile } from '../../../lib/sheets';
import { isProfileEmpty, parseProfileForm } from '../../../lib/account-profile';
import { saveUserProfile, type ProfileAction } from '../../../lib/account-crud';

export const prerender = false;

/** Sección del panel a la que se vuelve tras cada operación. */
const ADMIN_USERS_URL = '/dashboard/usuarios-registrados';

/**
 * CRUD de los datos de información de la cuenta de cualquier usuario, para el
 * administrador. Mismas operaciones que hace cada usuario en su propia cuenta,
 * pero sobre la fila que indica `username`:
 *
 * - `save`   crea o actualiza el contacto de ese usuario.
 * - `delete` borra el contacto de ese usuario.
 */
export const POST: APIRoute = async (Astro) => {
	const fail = (msg: string) =>
		Astro.redirect(`${ADMIN_USERS_URL}?contact=error&msg=` + encodeURIComponent(msg), 303);
	const done = (msg: string) =>
		Astro.redirect(`${ADMIN_USERS_URL}?contact=ok&msg=` + encodeURIComponent(msg), 303);

	try {
		const session = Astro.locals.user;
		if (!session) return Astro.redirect('/login', 303);

		// Solo un administrador puede tocar los datos de contacto de terceros.
		if (!isAdminRole(session.role)) {
			return new Response('Sin permisos', { status: 403 });
		}

		const formData = await Astro.request.formData();
		const username = String(formData.get('username') || '').trim();
		if (!username) {
			return fail('No se indicó el usuario al que aplicar el cambio.');
		}

		const action = (formData.get('action') || 'save') as ProfileAction;

		// --- DELETE: borrar el contacto del usuario ---
		if (action === 'delete') {
			const cleared = await clearSheetUserProfile(username);
			if (!cleared) {
				return fail(`No se encontraron los datos de contacto de ${username}.`);
			}
			return done(`Datos de contacto de ${username} eliminados.`);
		}

		// --- CREATE / UPDATE: registrar o modificar el contacto ---
		const { profile, error } = parseProfileForm(formData);
		if (error || !profile) {
			return fail(error || 'No se pudieron leer los datos del formulario.');
		}
		if (isProfileEmpty(profile)) {
			return fail(
				'Escribe al menos un dato de contacto o de residencia. Para vaciarlo, usa "Eliminar contacto".'
			);
		}

		const result = await saveUserProfile(username, profile);
		if (result === 'not-found') {
			return fail(`No se encontró la fila de ${username} en la hoja de usuarios.`);
		}
		if (result === 'invalid') {
			return fail('Los datos de contacto están vacíos.');
		}

		const verb = result === 'created' ? 'registrados' : 'actualizados';
		return done(`Datos de contacto de ${username} ${verb}.`);
	} catch (err) {
		console.error('Error en el CRUD administrativo de contactos:', err);
		return fail('No se pudo completar la operación. Inténtalo de nuevo.');
	}
};