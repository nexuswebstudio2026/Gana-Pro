import type { APIRoute } from 'astro';
import { validateSession } from '../../lib/session';
import { getGoogleSheetUsers } from '../../lib/sheets';
import { buildReferralQrSvg, getReferralStats, ownCodeOf } from '../../lib/referrals';
import type { User } from '../../lib/types';

export const prerender = false;

/**
 * QR de referido del usuario conectado.
 *
 * Solo responde a una sesión válida y devuelve el QR del propio usuario: no
 * acepta un código por parámetro, así que nadie puede generar el QR de otra
 * persona conociendo solo su nombre de usuario.
 */
export const GET: APIRoute = async (Astro) => {
	const session = validateSession(Astro.cookies.get('auth_session')?.value);
	if (!session) return new Response('Sesión no válida.', { status: 401 });

	try {
		const users: User[] = await getGoogleSheetUsers();
		const me = users.find(
			(user) =>
				user.username?.toLowerCase() === session.username.toLowerCase() ||
				user.email?.toLowerCase() === session.email.toLowerCase()
		);
		if (!me) {
			return new Response('No se encontró tu usuario en Google Sheets.', { status: 404 });
		}

		const stats = await getReferralStats(me, Astro.url.origin);
		const svg = await buildReferralQrSvg(stats.shareUrl);

		return new Response(svg, {
			status: 200,
			headers: {
				'Content-Type': 'image/svg+xml; charset=utf-8',
				// El QR solo cambia si cambia el código propio, así que se cachea
				// un poco y se vuelve a pedir al pasar ese tiempo.
				'Cache-Control': 'private, max-age=300',
				'X-Referral-Code': ownCodeOf(me),
			},
		});
	} catch (err) {
		console.error('Error al generar el QR de referido:', err);
		return new Response('No se pudo generar el código QR.', { status: 500 });
	}
};