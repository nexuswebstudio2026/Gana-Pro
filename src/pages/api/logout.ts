import type { APIRoute } from 'astro';
import { destroySession, clearSessionCookie } from '../../lib/session';

// API routes must be server-rendered, not prerendered as static
export const prerender = false;

export const GET: APIRoute = async (Astro) => {
	const token = Astro.cookies.get('auth_session')?.value;
	destroySession(token);
	clearSessionCookie(Astro);

	return Astro.redirect('/login?loggedout=1', 303);
};

export const POST: APIRoute = async (Astro) => {
	const token = Astro.cookies.get('auth_session')?.value;
	destroySession(token);
	clearSessionCookie(Astro);

	return Astro.redirect('/login?loggedout=1', 303);
};