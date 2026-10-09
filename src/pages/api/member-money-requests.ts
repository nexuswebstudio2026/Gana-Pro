import type { APIRoute } from 'astro';
import { buildPersonalHierarchy } from '../../lib/user-hierarchy';
import { getGoogleSheetUsers, moveBalance } from '../../lib/sheets';
import { createMemberMoneyRequest, listMemberMoneyRequests, updateMemberMoneyRequestStatus } from '../../lib/member-money-requests';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
	if (!locals.user) return json({ ok: false, message: 'Sesión no válida.' }, 401);
	try { return json({ ok: true, requests: await listMemberMoneyRequests(locals.user.username) }); }
	catch (error) { console.error('No se pudieron consultar las solicitudes de dinero:', error); return json({ ok: false, message: 'No se pudieron cargar las solicitudes.' }, 500); }
};

export const POST: APIRoute = async ({ request, locals }) => {
	const session = locals.user;
	if (!session) return json({ ok: false, message: 'Sesión no válida.' }, 401);
	try {
		const body = await request.json().catch(() => null) as { action?: string; to?: string; amount?: number; id?: string } | null;
		if (!body) return json({ ok: false, message: 'Datos inválidos.' }, 400);
		const users = await getGoogleSheetUsers();
		const personal = buildPersonalHierarchy(users, { username: session.username, email: session.email });
		if (body.action === 'request') {
			const recipient = String(body.to ?? '').trim();
			const amount = Number(body.amount);
			if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) return json({ ok: false, message: 'Ingresa un monto válido.' }, 400);
			if (!personal.team.some((member) => member.name.toLowerCase() === recipient.toLowerCase())) return json({ ok: false, message: 'Solo puedes solicitar dinero a uno de tus cinco usuarios directos.' }, 403);
			const item = await createMemberMoneyRequest(session.username, recipient, amount);
			return json({ ok: true, message: `Solicitud enviada a ${recipient}.`, request: item });
		}
		if (body.action === 'pay') {
			const item = (await listMemberMoneyRequests(session.username)).find((entry) => entry.id === String(body.id ?? '') && entry.recipient.toLowerCase() === session.username.toLowerCase() && entry.status === 'Pendiente');
			if (!item || personal.upline?.name.toLowerCase() !== item.requester.toLowerCase()) return json({ ok: false, message: 'La solicitud no está disponible para tu cuenta.' }, 403);
			if (!(await updateMemberMoneyRequestStatus(item.id, 'Pendiente', 'Procesando'))) return json({ ok: false, message: 'Esta solicitud ya está siendo procesada.' }, 409);
			const moved = await moveBalance(session.username, item.amount, item.requester);
			if (!moved) { await updateMemberMoneyRequestStatus(item.id, 'Procesando', 'Pendiente'); return json({ ok: false, message: 'Saldo insuficiente o transferencia no disponible.' }, 400); }
			await updateMemberMoneyRequestStatus(item.id, 'Procesando', 'Pagado');
			return json({ ok: true, message: `Enviaste $${Math.round(item.amount).toLocaleString('es-CO')} a ${item.requester}.` });
		}
		return json({ ok: false, message: 'Acción no reconocida.' }, 400);
	} catch (error) { console.error('Error al procesar una solicitud de dinero:', error); return json({ ok: false, message: 'No se pudo procesar la solicitud.' }, 500); }
};

function json(payload: Record<string, unknown>, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }); }
