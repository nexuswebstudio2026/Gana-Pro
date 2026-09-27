import type { APIRoute } from 'astro';
import { validateSession } from '../../../lib/session';
import { updateSheetUserDocument } from '../../../lib/sheets';
import { DOCUMENT_STATUS } from '../../../lib/testimonials';

export const prerender = false;

const VALID_STATUS = [
	DOCUMENT_STATUS.aprobado,
	DOCUMENT_STATUS.rechazado,
	DOCUMENT_STATUS.pendiente,
] as const;

export const POST: APIRoute = async (Astro) => {
	try {
		const token = Astro.cookies.get('auth_session')?.value;
		const session = validateSession(token);
		if (!session) return Astro.redirect('/login', 303);

		// Solo un administrador puede aprobar o rechazar documentos
		const role = (session.role || '').trim().toLowerCase();
		if (role !== 'admin' && role !== 'administrator') {
			return new Response('Sin permisos', { status: 403 });
		}

		const formData = await Astro.request.formData();
		const username = String(formData.get('username') || '').trim();
		const status = String(formData.get('status') || '').trim();

		if (!username) {
			return Astro.redirect('/dashboard/usuarios-registrados?review=error', 303);
		}
		if (!VALID_STATUS.includes(status as (typeof VALID_STATUS)[number])) {
			return Astro.redirect(
				'/dashboard/usuarios-registrados?review=error&msg=' +
					encodeURIComponent('El estado indicado no es válido.'),
				303
			);
		}

		const ok = await updateSheetUserDocument(username, { documentStatus: status });
		return Astro.redirect(
			`/dashboard/usuarios-registrados?review=${ok ? 'ok' : 'error'}&msg=` +
				encodeURIComponent(
					ok
						? `Documento de ${username} marcado como ${status}.`
						: `No se encontró el registro de ${username}.`
				),
			303
		);
	} catch (err) {
		console.error('Error al revisar el documento:', err);
		return Astro.redirect(
			'/dashboard/usuarios-registrados?review=error&msg=' +
				encodeURIComponent('No se pudo actualizar el estado del documento.'),
			303
		);
	}
};
