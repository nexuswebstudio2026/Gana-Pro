import type { APIRoute } from 'astro';
import { isAdminRole } from '../../lib/auth';
import { listMemberMoneyRequests } from '../../lib/member-money-requests';
import { listTopups } from '../../lib/topups';
import { listWithdrawals } from '../../lib/withdrawals';

export const prerender = false;

interface DashboardNotification {
	id: string;
	title: string;
	detail: string;
	href: string;
	createdAt?: string;
	kind: 'update' | 'money' | 'account';
}

// In dev, module reloads generate a new ID so a changed page can notify the user.
const localReleaseId = `local-${Date.now()}`;

/** Feed compartido por el panel de miembros y el de administración. */
export const GET: APIRoute = async ({ locals }) => {
	const session = locals.user;
	if (!session) return json({ ok: false, notifications: [], releaseId: '' }, 401);

	const notifications: DashboardNotification[] = [];
	const username = session.username.trim().toLowerCase();
	const admin = isAdminRole(session.role);
	const releaseId =
		process.env.VERCEL_GIT_COMMIT_SHA ||
		process.env.VERCEL_DEPLOYMENT_ID ||
		(process.env.NODE_ENV === 'development' ? localReleaseId : process.env.npm_package_version || 'unknown');

	try {
		const requests = await listMemberMoneyRequests(session.username);
		for (const request of requests) {
			const isRecipient = request.recipient.trim().toLowerCase() === username;
			const isRequester = request.requester.trim().toLowerCase() === username;

			if (isRecipient && request.status === 'Pendiente') {
				notifications.push({
					id: `money-request-${request.id}-pending`,
					title: 'Solicitud de dinero',
					detail: `${request.requester} solicita $${Math.round(request.amount).toLocaleString('es-CO')}.`,
					href: '/dashboard/billetera#solicitudes-dinero',
					createdAt: request.createdAt,
					kind: 'money',
				});
			} else if (isRequester && request.status !== 'Pendiente') {
				notifications.push({
					id: `money-request-${request.id}-${request.status.toLowerCase()}`,
					title: 'Actualización de solicitud',
					detail: `Tu solicitud a ${request.recipient} está ${request.status.toLowerCase()}.`,
					href: '/dashboard/billetera#solicitudes-dinero',
					createdAt: request.createdAt,
					kind: 'money',
				});
			}
		}
	} catch (error) {
		console.error('No se pudieron cargar las solicitudes para notificaciones:', error);
	}

	try {
		const [topups, withdrawals] = await Promise.all([listTopups(), listWithdrawals()]);
		if (admin) {
			for (const topup of topups.filter((item) => item.status === 'Pendiente')) {
				notifications.push({
					id: `topup-${topup.id}-pending`,
					title: 'Recarga por revisar',
					detail: `${topup.username} solicita $${Math.round(topup.amount).toLocaleString('es-CO')}.`,
					href: '/dashboard/recargas',
					createdAt: topup.createdAt,
					kind: 'account',
				});
			}
			for (const withdrawal of withdrawals.filter((item) => item.status === 'Pendiente')) {
				notifications.push({
					id: `withdrawal-${withdrawal.id}-pending`,
					title: 'Retiro por revisar',
					detail: `${withdrawal.username} solicita retirar $${Math.round(withdrawal.amount).toLocaleString('es-CO')}.`,
					href: '/dashboard/retiros',
					createdAt: withdrawal.createdAt,
					kind: 'account',
				});
			}
		} else {
			for (const topup of topups.filter((item) => item.username.trim().toLowerCase() === username && item.status !== 'Pendiente')) {
				notifications.push({
					id: `topup-${topup.id}-${topup.status.toLowerCase()}`,
					title: `Recarga ${topup.status.toLowerCase()}`,
					detail: `Tu solicitud por $${Math.round(topup.amount).toLocaleString('es-CO')} fue ${topup.status.toLowerCase()}.`,
					href: '/dashboard/billetera#comprobantes',
					createdAt: topup.createdAt,
					kind: 'account',
				});
			}
			for (const withdrawal of withdrawals.filter((item) => item.username.trim().toLowerCase() === username && item.status !== 'Pendiente')) {
				notifications.push({
					id: `withdrawal-${withdrawal.id}-${withdrawal.status.toLowerCase()}`,
					title: `Retiro ${withdrawal.status.toLowerCase()}`,
					detail: `Tu solicitud por $${Math.round(withdrawal.amount).toLocaleString('es-CO')} fue ${withdrawal.status.toLowerCase()}.`,
					href: '/dashboard/billetera',
					createdAt: withdrawal.createdAt,
					kind: 'account',
				});
			}
		}
	} catch (error) {
		console.error('No se pudieron cargar los movimientos para notificaciones:', error);
	}

	notifications.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
	return json({ ok: true, releaseId, notifications: notifications.slice(0, 40) });
};

function json(payload: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
	});
}
