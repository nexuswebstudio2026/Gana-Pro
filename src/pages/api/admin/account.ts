import type { APIRoute } from 'astro';
import { isAdminRole } from '../../../lib/auth';

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
	const session = Astro.locals.user;
	if (!session) return Astro.redirect('/login', 303);

	if (!isAdminRole(session.role)) {
		return new Response('Sin permisos', { status: 403 });
	}

	return Astro.redirect(
		`${ADMIN_USERS_URL}?contact=error&msg=` + encodeURIComponent('Los administradores solo pueden ver los datos de contacto; no pueden editarlos.'),
		303
	);
};
