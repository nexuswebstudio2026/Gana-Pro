import type { APIContext, APIRoute } from 'astro';
import { randomInt } from 'node:crypto';
import { getGoogleSheetUsers, updateSheetUserPassword } from '../../lib/sheets';
import { hashPassword } from '../../lib/crypto';
import { sendPasswordResetCode } from '../../lib/email';
import {
	consumePasswordResetChallenge,
	createPasswordResetChallenge,
	getPasswordResetChallenge,
	invalidatePasswordResetChallenge,
	markPasswordResetChallengeFailed,
	verifyPasswordResetCode,
} from '../../lib/password-reset-codes';
import type { User } from '../../lib/types';

export const prerender = false;
const CODE_LIFETIME_MS = 10 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 45 * 1000;
const REQUESTS_PER_HOUR = 4;
const recentRequests = new Map<string, number[]>();
const resetCookieName = 'password_reset_challenge';

function redirect(path: string, status = 303): Response { return new Response(null, { status, headers: { Location: path, 'Cache-Control': 'no-store' } }); }
function fail(message: string): Response { return redirect(`/forgot-password?error=${encodeURIComponent(message)}`); }
function genericSent(): Response { return redirect('/forgot-password?sent=1'); }

export const POST: APIRoute = async (Astro) => {
	try {
		const params = new URLSearchParams(await Astro.request.text());
		if (params.has('code')) return await resetPassword(Astro, params);

		const email = (params.get('email') || '').trim().toLowerCase();
		if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Escribe un correo válido.');
		const now = Date.now();
		const recent = (recentRequests.get(email) || []).filter((timestamp) => now - timestamp < 60 * 60 * 1000);
		if (recent.length >= REQUESTS_PER_HOUR || (recent.length && now - recent[recent.length - 1] < REQUEST_COOLDOWN_MS)) return genericSent();
		recent.push(now);
		recentRequests.set(email, recent);

		let user: User | null = null;
		try {
			const users = await getGoogleSheetUsers();
			user = users.find((item) => (item.email || '').trim().toLowerCase() === email) || null;
		} catch (error) {
			console.error('[password-reset] No se pudo consultar Google Sheets:', error);
			return genericSent();
		}
		if (!user) return genericSent();

		const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
		const challenge = await createPasswordResetChallenge(email, user.username, code, CODE_LIFETIME_MS);
		try {
			await sendPasswordResetCode(email, code);
		} catch (error) {
			await invalidatePasswordResetChallenge(challenge).catch(() => undefined);
			console.error('[password-reset] No se pudo enviar el correo de recuperación:', error);
			return genericSent();
		}
		Astro.cookies.set(resetCookieName, challenge.id, {
			path: '/', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax',
			maxAge: Math.floor(CODE_LIFETIME_MS / 1000),
		});
		return genericSent();
	} catch (error) {
		console.error('[password-reset] Error al solicitar recuperación:', error);
		return genericSent();
	}
};

async function resetPassword(Astro: APIContext, params: URLSearchParams): Promise<Response> {
	const challengeId = Astro.cookies.get(resetCookieName)?.value || '';
	const code = (params.get('code') || '').trim();
	const newPassword = params.get('newPassword') || '';
	const confirmPassword = params.get('confirmPassword') || '';
	if (!challengeId) return fail('Solicita un nuevo código para continuar.');
	if (!/^\d{6}$/.test(code)) return fail('Escribe el código de 6 dígitos enviado a tu correo.');
	if (newPassword.length < 6) return fail('La nueva contraseña debe tener al menos 6 caracteres.');
	if (newPassword !== confirmPassword) return fail('Las contraseñas no coinciden.');

	try {
		const challenge = await getPasswordResetChallenge(challengeId);
		if (!challenge) return fail('El código no es válido. Solicita uno nuevo.');
		const result = await verifyPasswordResetCode(challenge, code);
		if (result !== 'valid') {
			const message = result === 'expired' ? 'El código venció. Solicita uno nuevo.' : result === 'locked' || result === 'used' ? 'El código ya no se puede usar. Solicita uno nuevo.' : 'El código no coincide. Verifica el mensaje y vuelve a intentar.';
			return fail(message);
		}

		const users = await getGoogleSheetUsers();
		const user = users.find((item) => item.username.trim().toLowerCase() === challenge.username.trim().toLowerCase() && item.email.trim().toLowerCase() === challenge.email);
		if (!user) {
			await markPasswordResetChallengeFailed(challenge);
			return fail('No se pudo validar la cuenta. Solicita un código nuevo.');
		}
		const updated = await updateSheetUserPassword(user.username, hashPassword(newPassword));
		if (!updated) {
			await markPasswordResetChallengeFailed(challenge);
			return fail('No se pudo actualizar la contraseña. Inténtalo de nuevo.');
		}
		await consumePasswordResetChallenge(challenge);
		Astro.cookies.delete(resetCookieName, { path: '/' });
		return redirect('/login?reset=1');
	} catch (error) {
		console.error('[password-reset] No se pudo completar el cambio:', error);
		return fail('No se pudo completar el cambio. Inténtalo de nuevo.');
	}
}
