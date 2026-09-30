import type { APIRoute } from 'astro';
import { validateSession } from '../../lib/session';
import {
	clearSheetUserProfile,
	ensureUserProfileColumns,
	updateSheetUserProfile,
} from '../../lib/sheets';
import { isProfileEmpty, parseProfileForm } from '../../lib/account-profile';
import type { AccountProfile } from '../../lib/account-profile';
import { saveUserProfile, type ProfileAction } from '../../lib/account-crud';

export const prerender = false;

/** Página a la que se vuelve tras cada operación. */
const ACCOUNT_URL = '/dashboard/informacion-cuenta';

/**
 * CRUD de los datos de información de la cuenta del usuario conectado
 * (dirección, barrio, ciudad, teléfono y WhatsApp), guardado en Google Sheets.
 *
 * - `save`   crea o actualiza el contacto (si no había datos, los crea).
 * - `delete` borra el contacto completo.
 *
 * Los datos de acceso (usuario, correo, rol, documento y fecha de registro) no
 * se editan aquí: los gestiona el administrador.
 */
export const POST: APIRoute = async (Astro) => {
	const fail = (msg: string, field?: string) =>
		Astro.redirect(
			`${ACCOUNT_URL}?profile=error&msg=` +
				encodeURIComponent(msg) +
				(field ? `&field=${field}` : ''),
			303
		);

	try {
		const session = validateSession(Astro.cookies.get('auth_session')?.value);
		if (!session) {
			return Astro.redirect('/login', 303);
		}

		const formData = await Astro.request.formData();
		const action = (formData.get('action') || 'save') as ProfileAction;

		// --- DELETE: borrar los datos de contacto ---
		if (action === 'delete') {
			const cleared = await clearSheetUserProfile(session.username);
			if (!cleared) {
				return fail('No se encontraron tus datos de contacto para borrar.');
			}
			return Astro.redirect(`${ACCOUNT_URL}?profile=deleted`, 303);
		}

		// --- CREATE / UPDATE: registrar o modificar el contacto ---
		const { profile, error, field } = parseProfileForm(formData);
		if (error || !profile) {
			return fail(error || 'No se pudieron leer los datos del formulario.', field);
		}

		// Guardarlo todo vacío sería lo mismo que borrarlo: se pide un dato real.
		if (isProfileEmpty(profile)) {
			return fail(
				'Escribe al menos un dato de contacto o de residencia. Si quieres borrarlos, usa el botón de eliminar.'
			);
		}

		const wasEmpty = (await saveUserProfile(session.username, profile)) === 'created';
		return Astro.redirect(
			`${ACCOUNT_URL}?profile=${wasEmpty ? 'created' : 'updated'}` +
				`&filled=${countFilled(profile)}`,
			303
		);
	} catch (err) {
		console.error('Error en el CRUD de la información de la cuenta:', err);
		return fail('No se pudo completar la operación. Inténtalo de nuevo.');
	}
};

/** Cuántos campos del perfil quedaron con valor (para el resumen tras guardar). */
function countFilled(profile: AccountProfile): number {
	return Object.values(profile).filter(Boolean).length;
}