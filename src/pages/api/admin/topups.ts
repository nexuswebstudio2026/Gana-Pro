import type { APIRoute } from 'astro';
import { isAdminRole } from '../../../lib/auth';
import {
	listTopups,
	setTopupStatus,
	TOPUP_STATUS,
	type TopupStatus,
} from '../../../lib/topups';
import { setSheetUserBalance, parseSheetBalance } from '../../../lib/sheets';
import { getUserBalance } from '../../../lib/users';

export const prerender = false;

function json(payload: { ok: boolean; message: string; [k: string]: unknown }, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

const fmt = (v: number) => `$${Math.round(v).toLocaleString('es-CO')}`;

/** Lista las solicitudes de recarga. */
export const GET: APIRoute = async (Astro) => {
	const session = Astro.locals.user;
	if (!session) return json({ ok: false, message: 'Sesión no válida.' }, 401);
	if (!isAdminRole(session.role)) return json({ ok: false, message: 'Sin permisos.' }, 403);

	try {
		const status = Astro.url.searchParams.get('estado') || undefined;
		const list = await listTopups(status);
		return json({ ok: true, message: '', list });
	} catch (err) {
		console.error('Error al listar recargas:', err);
		return json({ ok: false, message: 'No se pudieron cargar las solicitudes.' }, 500);
	}
};

/**
 * Aprueba o rechaza una recarga.
 *
 * El administrador es quien compara el monto solicitado con la imagen del
 * comprobante: aquí solo se ejecuta la decisión que ya tomó.
 */
export const POST: APIRoute = async (Astro) => {
	try {
		const session = Astro.locals.user;
		if (!session) return json({ ok: false, message: 'Sesión no válida.' }, 401);
		if (!isAdminRole(session.role)) return json({ ok: false, message: 'Sin permisos.' }, 403);

		const body = await Astro.request.json().catch(() => null);
		if (!body) return json({ ok: false, message: 'Datos inválidos.' }, 400);

		const { id, action, notes } = body as { id?: unknown; action?: unknown; notes?: unknown };
		const requestId = String(id ?? '').trim();
		if (!requestId) return json({ ok: false, message: 'Falta el identificador.' }, 400);

		const decision = String(action ?? '');
		const adminNotes = String(notes ?? '').slice(0, 300);
		if (decision !== 'aprobar' && decision !== 'rechazar') {
			return json({ ok: false, message: 'Acción no reconocida.' }, 400);
		}

		const all = await listTopups();
		const request = all.find((r) => r.id === requestId);
		if (!request) return json({ ok: false, message: 'La solicitud no existe.' }, 404);

		// No se reprocesa una solicitud ya resuelta: evita acreditar dos veces.
		if (request.status !== TOPUP_STATUS.pendiente) {
			return json(
				{ ok: false, message: `Esa recarga ya fue ${request.status.toLowerCase()}.` },
				409
			);
		}

		if (decision === 'aprobar') {
			// Aquí sí se acredita el saldo, ya que el admin validó el comprobante.
			const current = parseSheetBalance(
				await getUserBalance(request.username, request.email)
			);
			const credited = await setSheetUserBalance(request.username, current + request.amount);
			if (!credited) {
				return json(
					{
						ok: false,
						message:
							'No se encontró la fila del usuario en Google Sheets. ' +
							'La solicitud sigue pendiente.',
					},
					404
				);
			}
		}

		const status: TopupStatus =
			decision === 'aprobar' ? TOPUP_STATUS.aprobado : TOPUP_STATUS.rechazado;
		const updated = await setTopupStatus(requestId, status, adminNotes);
		if (!updated) return json({ ok: false, message: 'No se pudo guardar el estado.' }, 500);

		return json({
			ok: true,
			message:
				decision === 'aprobar'
					? `Recarga #${requestId} aprobada: se acreditaron ${fmt(request.amount)} a ${request.username}.`
					: `Recarga #${requestId} rechazada.`,
		});
	} catch (err) {
		console.error('Error al resolver la recarga:', err);
		return json({ ok: false, message: 'Error del servidor.' }, 500);
	}
};
