import type { Session } from './session';

/**
 * Única fuente de verdad sobre quién es administrador.
 *
 * Antes cada endpoint repetía la comparación `role === 'admin' ||
 * role === 'administrator'` por su cuenta. Centralizarla aquí evita que una
 * variante nueva (por ejemplo "root" o "superadmin") se aplique en un sitio y
 * se olvide en otro, que es como un endpoint de admin acaba accesible a
 * cualquier usuario.
 */

/** Roles que conceden acceso al panel de administración. */
export const ADMIN_ROLES: readonly string[] = ['admin', 'administrator'];

/** Normaliza un rol para compararlo sin depender de mayúsculas ni espacios. */
export function normalizeRole(role: string | undefined | null): string {
	return (role || '').trim().toLowerCase();
}

/** ¿El rol puede ver las secciones de administración? */
export function isAdminRole(role: string | undefined | null): boolean {
	return ADMIN_ROLES.includes(normalizeRole(role));
}

/** ¿La sesión corresponde a un administrador? */
export function isAdminSession(session: Session | null | undefined): boolean {
	return !!session && isAdminRole(session.role);
}

// --- Rutas protegidas -------------------------------------------------------

/** Prefijo de los endpoints de administración. */
export const ADMIN_API_PREFIX = '/api/admin';

/** Prefijo de todo el panel (raíz y secciones). */
export const DASHBOARD_PREFIX = '/dashboard';

/**
 * Secciones del panel reservadas al administrador.
 *
 * No aparecen las páginas personales (`/dashboard/rut`, `/dashboard/ubicacion`,
 * `/dashboard/informacion-cuenta`, `/dashboard/mi-organigrama`): las ve
 * cualquier miembro conectado, y `AdminPageLayout` usa `isAdmin` solo para
 * ocultar enlaces del menú.
 */
const ADMIN_DASHBOARD_SECTIONS: readonly string[] = [
	'organigrama-global',
	'usuarios-registrados',
	'niveles-ascenso',
	'ingresos',
	'gastos',
	'negocio',
	'usuario',
	'comisiones',
	'pagos-p2p',
];

/** ¿Esta ruta es un endpoint de administración? (`/api/admin...`) */
export function isAdminApiPath(pathname: string): boolean {
	const normalized = pathname.replace(/\/+$/, '');
	return normalized === ADMIN_API_PREFIX || normalized.startsWith(`${ADMIN_API_PREFIX}/`);
}

/** ¿Esta sección concreta del panel es solo para administradores? */
export function isAdminDashboardSection(section: string): boolean {
	return ADMIN_DASHBOARD_SECTIONS.includes(section);
}

// --- Respuestas de rechazo --------------------------------------------------

/** Respuesta JSON estándar para un endpoint sin sesión válida. */
export function unauthorized(message = 'Sesión no válida.'): Response {
	return new Response(JSON.stringify({ ok: false, message }), {
		status: 401,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** Respuesta JSON estándar para un endpoint con sesión sin permisos. */
export function forbidden(message = 'Sin permisos.'): Response {
	return new Response(JSON.stringify({ ok: false, message }), {
		status: 403,
		headers: { 'Content-Type': 'application/json' },
	});
}
