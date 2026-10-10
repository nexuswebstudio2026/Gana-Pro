/**
 * Revisión de pagos entre usuarios (P2P) por parte del administrador.
 *
 * Usa el mismo patrón que `api/admin/topups.ts`, incluida la protección:
 * `isAdminApiPath` en el middleware ya exige sesión y rol de admin, pero aquí
 * se repite el chequeo porque es la capa que no se puede saltar desde el
 * navegador.
 *
 * Aprobar mueve el saldo de verdad, y cada concepto va a un sitio distinto: el
 * 50 % al patrocinador que trajo al usuario y el 30 % sale del saldo hacia la
 * cuenta de la plataforma, que se concilia aparte.
 */
import type { APIRoute } from 'astro';
import { isAdminRole } from '../../../lib/auth';
import { listP2PPayments, setP2PPaymentStatus } from '../../../lib/p2p-payments';
import { P2P_CONCEPT, P2P_STATUS, RECARGA_INICIAL_AMOUNT } from '../../../lib/p2p';
import { getGoogleSheetUsers, moveBalance, setSheetUserLevel, setSheetUserMatrixParent } from '../../../lib/sheets';
import { buildUserHierarchy, findUserParent } from '../../../lib/user-hierarchy';
import { toLevelNumber } from '../../../lib/users';

export const prerender = false;

function json(payload: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

const fmt = (v: number) => `$${Math.round(v).toLocaleString('es-CO')}`;

/** Lista todos los pagos P2P. */
export const GET: APIRoute = async (Astro) => {
	const session = Astro.locals.user;
	if (!session) return json({ ok: false, message: 'Sesión no válida.' }, 401);
	if (!isAdminRole(session.role)) return json({ ok: false, message: 'Sin permisos.' }, 403);

	try {
		return json({ ok: true, message: '', list: await listP2PPayments() });
	} catch (err) {
		console.error('Error al listar pagos P2P:', err);
		return json({ ok: false, message: 'No se pudieron cargar los pagos.' }, 500);
	}
};

/**
 * Aprueba o rechaza un pago P2P.
 *
 * El dinero se mueve aquí, que es la única capa que el usuario no controla: el
 * formulario solo crea la solicitud en estado Pendiente.
 */
export const POST: APIRoute = async (Astro) => {
	const session = Astro.locals.user;
	if (!session) return json({ ok: false, message: 'Sesión no válida.' }, 401);
	if (!isAdminRole(session.role)) return json({ ok: false, message: 'Sin permisos.' }, 403);

	try {
		const body = await Astro.request.json().catch(() => null);
		if (!body) return json({ ok: false, message: 'Datos inválidos.' }, 400);

		const { id, action, notes } = body as { id?: unknown; action?: unknown; notes?: unknown };
		const requestId = String(id ?? '').trim();
		const decision = String(action ?? '');
		const adminNotes = String(notes ?? '').slice(0, 300);

		if (!requestId) return json({ ok: false, message: 'Falta el identificador.' }, 400);
		if (decision !== 'aprobar' && decision !== 'rechazar') {
			return json({ ok: false, message: 'Acción no reconocida.' }, 400);
		}

		const request = (await listP2PPayments()).find((r) => r.id === requestId);
		if (!request) return json({ ok: false, message: 'El pago no existe.' }, 404);

		// No se reprocesa uno ya resuelto: es lo que evita mover el saldo dos
		// veces si se pulsa dos veces el botón de aprobar.
		if (request.status !== P2P_STATUS.pendiente) {
			return json({ ok: false, message: 'Ese pago ya fue revisado.' }, 400);
		}

		let message = `Pago #${requestId} ${decision === 'aprobar' ? 'aprobado' : 'rechazado'}.`;

		if (decision === 'aprobar') {
			if (request.concept === P2P_CONCEPT.aporteMatriz) {
				const recipientUsername = String(request.recipientUsername || '').trim();
				const senderLevel = Number(request.senderLevel || 0);
				if (!recipientUsername || request.amount !== RECARGA_INICIAL_AMOUNT || senderLevel < 1 || senderLevel >= 5) {
					return json({ ok: false, message: 'El aporte no tiene un destinatario o monto válido.' }, 400);
				}
				const users = await getGoogleSheetUsers();
				const payer = users.find((user) => user.username.trim().toLowerCase() === request.username.trim().toLowerCase());
				const recipient = users.find((user) => user.username.trim().toLowerCase() === recipientUsername.toLowerCase());
				if (!payer || !recipient || toLevelNumber(payer.level || '1') !== senderLevel) {
					return json({ ok: false, message: 'El usuario que envía ya no es elegible para este aporte.' }, 409);
				}
				const recipientIsRoot = isAdminRole(recipient.role);
				const existing = await listP2PPayments();
				const rootLevelOneCount = existing.filter((payment) =>
					payment.concept === P2P_CONCEPT.aporteMatriz &&
					payment.recipientUsername?.trim().toLowerCase() === recipientUsername.toLowerCase() &&
					payment.senderLevel === 1 && payment.status === P2P_STATUS.aprobado
				).length;
				const recipientLevel = recipientIsRoot
					? rootLevelOneCount < 5 ? 2 : Math.max(3, toLevelNumber(recipient.level || '3'))
					: toLevelNumber(recipient.level || '1');
				const inbound = existing.filter((payment) =>
					payment.id !== request.id && payment.concept === P2P_CONCEPT.aporteMatriz &&
					payment.recipientUsername?.trim().toLowerCase() === recipientUsername.toLowerCase() &&
					payment.senderLevel === senderLevel &&
					payment.status !== P2P_STATUS.rechazado
				);
				const approvedInbound = inbound.filter((payment) => payment.status === P2P_STATUS.aprobado).length;
				if (recipientLevel !== senderLevel + 1 || inbound.length >= 5) {
					return json({ ok: false, message: 'El destinatario ya no tiene puestos disponibles para tu nivel.' }, 409);
				}

				const moved = await moveBalance(request.username, request.amount, recipient.username);
				if (!moved) return json({ ok: false, message: 'No se pudo transferir el aporte. Verifica el saldo del usuario.' }, 400);
				await setP2PPaymentStatus(requestId, P2P_STATUS.aprobado, adminNotes);
				await setSheetUserMatrixParent(request.username, recipientIsRoot ? 'gana-pro' : recipient.username);

				const approvedToRecipient = [...inbound, { ...request, status: P2P_STATUS.aprobado }]
					.filter((payment) => payment.status === P2P_STATUS.aprobado);
				if (approvedToRecipient.length >= 5) {
					await setSheetUserLevel(recipient.username, senderLevel + 2);
					for (const contribution of approvedToRecipient.slice(0, 5)) {
						await setSheetUserLevel(contribution.username, senderLevel + 1);
					}
					message += ` El usuario ${recipient.username} y sus cinco aportantes ascendieron de nivel.`;
				} else {
					message += ` Se enviaron ${fmt(request.amount)} a ${recipient.username}; puesto ${approvedInbound + 1} de 5.`;
				}
				return json({ ok: true, message });
			}

			if (request.concept === P2P_CONCEPT.recargaInicial) {
				// La recarga inicial no mueve saldo aquí: se acredita en el flujo
				// de recargas, que además paga la comisión del referido.
				await setP2PPaymentStatus(requestId, P2P_STATUS.aprobado, adminNotes);
				return json({
					ok: true,
					message:
						message +
						' La recarga inicial no se procesa aquí: apruébala también en ' +
						'Solicitudes de Recargas para acreditar el saldo.',
				});
			}

			if (request.concept === P2P_CONCEPT.ascensoPatrocinador) {
				const users = await getGoogleSheetUsers();
				const patrocinador = findUserParent(buildUserHierarchy(users), {
					username: request.username,
					email: request.email,
				});

				if (!patrocinador) {
					return json(
						{
							ok: false,
							message:
								`No se pudo determinar el patrocinador de ${request.username}. ` +
								'Revisa la matriz antes de aprobar.',
						},
						400
					);
				}

				const moved = await moveBalance(
					request.username,
					request.amount,
					patrocinador.name
				);
				if (!moved) {
					return json(
						{
							ok: false,
							message:
								'No se pudo mover el saldo: verifica que ' +
								`${request.username} tenga al menos ${fmt(request.amount)} y que ` +
								`${patrocinador.name} exista en la hoja.`,
						},
						400
					);
				}
				message += ` Se enviaron ${fmt(request.amount)} a ${patrocinador.name}.`;
			} else {
				// Sostenimiento: sale del saldo del usuario y se concilia con la
				// cuenta de la plataforma.
				const moved = await moveBalance(request.username, request.amount);
				if (!moved) {
					return json(
						{
							ok: false,
							message:
								'No se pudo descontar el saldo: ' +
								`${request.username} debe tener al menos ${fmt(request.amount)}.`,
						},
						400
					);
				}
				message +=
					` Se descontaron ${fmt(request.amount)} del saldo. ` +
					'Confirma el ingreso en la cuenta de GanaPro.';
			}
		}

		await setP2PPaymentStatus(
			requestId,
			decision === 'aprobar' ? P2P_STATUS.aprobado : P2P_STATUS.rechazado,
			adminNotes
		);

		return json({ ok: true, message });
	} catch (err) {
		console.error('Error al revisar el pago P2P:', err);
		return json({ ok: false, message: 'Error del servidor. Inténtalo de nuevo.' }, 500);
	}
};
