import type { APIRoute } from 'astro';
import { isAdminRole } from '../../../lib/auth';
import {
	listWithdrawals,
	setWithdrawalStatus,
	WITHDRAWAL_STATUS,
	type WithdrawalStatus,
} from '../../../lib/withdrawals';
import { moveBalance } from '../../../lib/sheets';

export const prerender = false;

const RETURNS_URL = '/dashboard/retiros';

function json(payload: { ok: boolean; message: string }, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

/** Lista las solicitudes de retiro. */
export const GET: APIRoute = async (Astro) => {
	const session = Astro.locals.user;
	if (!session) return json({ ok: false, message: 'Sesión no válida.' }, 401);
	if (!isAdminRole(session.role)) return json({ ok: false, message: 'Sin permisos.' }, 403);

	try {
		const status = Astro.url.searchParams.get('estado') || undefined;
		const list = await listWithdrawals(status);
		return new Response(JSON.stringify({ ok: true, list }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	} catch (err) {
		console.error('Error al listar retiros:', err);
		return json({ ok: false, message: 'No se pudieron cargar las solicitudes.' }, 500);
	}
};

/** Aprueba o rechaza una solicitud. */
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

		// Se localiza la solicitud para conocer usuario y monto antes de tocar nada.
		const all = await listWithdrawals();
		const request = all.find((r) => r.id === requestId);
		if (!request) return json({ ok: false, message: 'La solicitud no existe.' }, 404);

		// No se reprocesa una solicitud ya resuelta: evita descontar dos veces.
		if (request.status !== WITHDRAWAL_STATUS.pendiente) {
			return json(
				{ ok: false, message: `Esa solicitud ya fue ${request.status.toLowerCase()}.` },
				409
			);
		}

		if (decision === 'aprobar') {
			// Aquí sí se mueve el dinero: el saldo se descuenta al aprobar.
			const moved = await moveBalance(request.username, request.amount);
			if (!moved) {
				return json(
					{
						ok: false,
						message:
							'No se pudo descontar el saldo (saldo insuficiente o usuario no encontrado). ' +
							'La solicitud sigue pendiente.',
					},
					400
				);
			}
		}

		const status: WithdrawalStatus =
			decision === 'aprobar' ? WITHDRAWAL_STATUS.aprobado : WITHDRAWAL_STATUS.rechazado;
		const updated = await setWithdrawalStatus(requestId, status, adminNotes);
		if (!updated) return json({ ok: false, message: 'No se pudo guardar el estado.' }, 500);

		return json({
			ok: true,
			message:
				decision === 'aprobar'
					? `Retiro #${requestId} aprobado y descontado del saldo.`
					: `Retiro #${requestId} rechazado.`,
		});
	} catch (err) {
		console.error('Error al resolver la solicitud de retiro:', err);
		return json({ ok: false, message: 'Error del servidor.' }, 500);
	}
};

export { RETURNS_URL };
