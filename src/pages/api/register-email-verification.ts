import type { APIContext, APIRoute } from 'astro';
import { randomInt } from 'node:crypto';
import { readJSON } from '../../lib/store';
import { getGoogleSheetUsers } from '../../lib/sheets';
import { sendRegistrationVerificationCode } from '../../lib/email';
import {
	createRegistrationEmailChallenge,
	getRegistrationEmailChallenge,
	REGISTRATION_EMAIL_CODE_LIFETIME_MS,
	verifyRegistrationEmailCode,
} from '../../lib/registration-email-verification';

export const prerender = false;
const COOKIE_NAME = 'registration_email_challenge';
const requests = new Map<string, number[]>();

function json(message: string, status = 200): Response {
	return Response.json({ message, ok: status >= 200 && status < 300 }, {
		status,
		headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
	});
}

export const POST: APIRoute = async (Astro) => {
	try {
		const params = new URLSearchParams(await Astro.request.text());
		const action = params.get('action');
		if (action === 'send') return await sendCode(Astro, params);
		if (action === 'verify') return await verifyCode(Astro, params);
		return json('Solicitud no válida.', 400);
	} catch (error) {
		console.error('[register-email-verification] Error:', error);
		return json('No se pudo completar la verificación. Intenta de nuevo.', 500);
	}
};

async function sendCode(Astro: APIContext, params: URLSearchParams): Promise<Response> {
	const email = (params.get('email') || '').trim().toLowerCase();
	if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
		return json('Escribe un correo electrónico válido.', 400);
	}

	const now = Date.now();
	const history = (requests.get(email) || []).filter((time) => now - time < 60 * 60 * 1000);
	if (history.length >= 4 || (history.length > 0 && now - history[history.length - 1] < 45_000)) {
		return json('Espera un momento antes de solicitar otro código.', 429);
	}
	requests.set(email, [...history, now]);

	let sheetUsers;
	try {
		sheetUsers = await getGoogleSheetUsers();
	} catch (error) {
		console.error('[register-email-verification] No se pudieron consultar los usuarios:', error);
		return json('No se pudo validar el correo ahora. Intenta más tarde.', 503);
	}
	const localUsers = readJSON<Array<{ email?: string }>>('users.json', []);
	if (sheetUsers.some((user) => (user.email || '').trim().toLowerCase() === email) ||
		localUsers.some((user) => (user.email || '').trim().toLowerCase() === email)) {
		return json('Este correo ya está registrado. Inicia sesión o usa otro correo.', 409);
	}

	const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
	const challenge = await createRegistrationEmailChallenge(email, code, REGISTRATION_EMAIL_CODE_LIFETIME_MS);
	try {
		await sendRegistrationVerificationCode(email, code);
	} catch (error) {
		console.error('[register-email-verification] No se pudo enviar el correo:', error);
		return json('No se pudo enviar el correo. Revisa la configuración e intenta más tarde.', 503);
	}

	Astro.cookies.set(COOKIE_NAME, challenge.id, {
		path: '/',
		httpOnly: true,
		secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL),
		sameSite: 'lax',
		maxAge: Math.floor(REGISTRATION_EMAIL_CODE_LIFETIME_MS / 1000),
	});
	return json('Te enviamos un código de verificación. Revisa tu correo y la carpeta de spam.');
}

async function verifyCode(Astro: APIContext, params: URLSearchParams): Promise<Response> {
	const challengeId = Astro.cookies.get(COOKIE_NAME)?.value || '';
	const code = (params.get('code') || '').trim();
	if (!challengeId) return json('Solicita un nuevo código para continuar.', 400);
	if (!/^\d{6}$/.test(code)) return json('Escribe el código de 6 dígitos.', 400);
	const challenge = await getRegistrationEmailChallenge(challengeId);
	if (!challenge) return json('El código no es válido. Solicita uno nuevo.', 400);
	const result = await verifyRegistrationEmailCode(challenge, code);
	if (result === 'valid') return json('Correo verificado. Completa tus datos para crear la cuenta.');
	if (result === 'expired') return json('El código venció. Solicita uno nuevo.', 400);
	if (result === 'locked' || result === 'used') return json('El código ya no se puede usar. Solicita uno nuevo.', 400);
	return json('El código no coincide. Verifícalo e intenta de nuevo.', 400);
}

export async function getVerifiedRegistrationEmail(Astro: APIContext, email: string) {
	const challengeId = Astro.cookies.get(COOKIE_NAME)?.value || '';
	if (!challengeId) return null;
	const challenge = await getRegistrationEmailChallenge(challengeId);
	if (!challenge || challenge.status !== 'Verificado' || challenge.expiresAt < Date.now() || challenge.email !== email.trim().toLowerCase()) return null;
	return challenge;
}

export function clearRegistrationEmailCookie(Astro: APIContext): void {
	Astro.cookies.delete(COOKIE_NAME, { path: '/' });
}
