import { defineMiddleware, sequence } from 'astro:middleware';
import { getSessionToken, validateSession } from './lib/session';
import {
	DASHBOARD_PREFIX,
	forbidden,
	isAdminApiPath,
	isAdminDashboardSection,
	isAdminRole,
	unauthorized,
} from './lib/auth';

/** Rutas públicas: se accede sin sesión iniciada. */
const PUBLIC_PATHS: readonly string[] = [
	'/',
	'/login',
	'/register',
	'/forgot-password',
	'/gana-dinero',
	'/valoraciones',
	'/sobre-nosotros',
	'/api/login',
	'/api/logout',
	'/api/register',
	'/api/forgot-password',
];

/** Normaliza la ruta: sin barra final, para comparar contra la lista pública. */
function normalizePath(pathname: string): string {
	return pathname.replace(/\/+$/, '') || '/';
}

/** ¿La ruta es pública y se deja pasar sin sesión? */
function isPublicPath(pathname: string): boolean {
	return PUBLIC_PATHS.includes(normalizePath(pathname));
}

/** ¿La ruta es del panel o de la API? (todo lo demás es público por defecto) */
function isProtectedArea(pathname: string): boolean {
	const normalized = normalizePath(pathname);
	return (
		normalized === DASHBOARD_PREFIX ||
		normalized.startsWith(`${DASHBOARD_PREFIX}/`) ||
		normalized.startsWith('/api/')
	);
}

/** Mensaje de error que las páginas del panel ya usan al saltar al login. */
const LOGIN_REQUIRED = 'Debes iniciar sesión para acceder a esta página.';

const auth: ReturnType<typeof defineMiddleware> = defineMiddleware(
	async (context, next) => {
		const { pathname } = context.url;

		// Las rutas públicas se consultan primero: algunas (`/api/login`,
		// `/api/register`) viven bajo `/api/`, así que el orden importa.
		if (isPublicPath(pathname) || !isProtectedArea(pathname)) {
			context.locals.user = validateSession(getSessionToken(context));
			return next();
		}

		// La sesión se resuelve una sola vez por petición y se expone en
		// `Astro.locals.user`. Antes cada página y cada endpoint repetía este
		// bloque, y era fácil que uno se quedara sin comprobar.
		const session = validateSession(getSessionToken(context));
		context.locals.user = session;

		// --- Sin sesión ---
		if (!session) {
			// Los endpoints de administración responden JSON; el resto de
			// endpoints y páginas conservan la respuesta que ya devolvían.
			if (isAdminApiPath(pathname)) return unauthorized();
			return context.redirect(
				'/login?error=' + encodeURIComponent(LOGIN_REQUIRED),
				303
			);
		}

		// --- Con sesión: permisos de administración ---
		const needsAdmin = isAdminApiPath(pathname) || isAdminDashboardRoute(pathname);
		if (needsAdmin && !isAdminRole(session.role)) {
			if (isAdminApiPath(pathname)) return forbidden();
			return context.redirect(
				'/dashboard?error=' +
					encodeURIComponent('No tienes permisos para ver esta sección.'),
				303
			);
		}

		return next();
	}
);

/** ¿La ruta es una sección del panel reservada al administrador? */
function isAdminDashboardRoute(pathname: string): boolean {
	const normalized = normalizePath(pathname);
	if (!normalized.startsWith(`${DASHBOARD_PREFIX}/`)) return false;
	const section = normalized.slice(DASHBOARD_PREFIX.length + 1);
	// Las subrutas de una sección admin siguen siendo admin.
	return isAdminDashboardSection(section.split('/')[0]);
}

export const onRequest = sequence(auth);
