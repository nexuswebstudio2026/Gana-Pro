import type { APIRoute } from 'astro';
import {
	getGoogleSheetUsers,
	moveBalance,
	parseSheetBalance,
} from '../../lib/sheets';
import { buildPersonalHierarchy } from '../../lib/user-hierarchy';
import { createWithdrawal, adminCommission, netAmount } from '../../lib/withdrawals';
import {
	getUserBalance,
	getSheetUserLevel,
	getUserWallet,
	canWithdraw,
} from '../../lib/users';

export const prerender = false;

/** Saldo autoritativo de Google Sheets para refrescar el chip del panel. */
export const GET: APIRoute = async ({ locals }) => {
	const session = locals.user;
	if (!session) return json({ ok: false, message: 'Sesión no válida.' }, 401);

	try {
		const balance = await getUserBalance(session.username, session.email);
		return json({ ok: balance !== null, message: balance === null ? 'No se encontró el saldo en Google Sheets.' : '', balance: balance === null ? null : parseSheetBalance(balance) }, balance === null ? 404 : 200);
	} catch (error) {
		console.error('No se pudo actualizar el saldo del panel:', error);
		return json({ ok: false, message: 'No se pudo consultar el saldo.' }, 500);
	}
};

/** Monto máximo permitido por operación, para no escribir cifras absurdas. */
const MAX_AMOUNT = 100_000_000;

/**
 * Operaciones sobre el saldo acumulado.
 *
 * Recibe JSON: `{ op, amount, to }` y responde `{ ok, message }`.
 *
 * - "recargar" no se atiende aquí: vive en /api/balance/topup, que exige
 *   comprobante y deja la solicitud pendiente de aprobación.
 * - "retirar" crea una solicitud que debe aprobar el administrador; el saldo
 *   no se descuenta hasta que él la apruebe.
 * - "enviar" transfiere saldo entre dos usuarios de la hoja.
 */
export const POST: APIRoute = async (Astro) => {
	try {
		const session = Astro.locals.user;
		if (!session) {
			return json({ ok: false, message: 'Sesión no válida.' }, 401);
		}

		const body = await Astro.request.json().catch(() => null);
		if (!body) {
			return json({ ok: false, message: 'Datos inválidos.' }, 400);
		}

		const { op, amount, to } = body as { op?: unknown; amount?: unknown; to?: unknown };
		const value = Number(amount);

		if (!Number.isFinite(value) || value <= 0) {
			return json({ ok: false, message: 'El monto debe ser un número mayor que cero.' }, 400);
		}
		if (value > MAX_AMOUNT) {
			return json({ ok: false, message: 'El monto supera el máximo permitido.' }, 400);
		}

		const username = session.username;

		switch (op) {
			// --- Recargar: vive en /api/balance/topup ---
			// Exigir comprobante es obligatorio, así que aquí se rechaza: si se
		// aceptara, bastaría con llamar a este endpoint para saltarse la
		// validación del comprobante.
			case 'recargar':
				return json(
					{
						ok: false,
						message:
							'La recarga requiere comprobante. Usa el formulario de recarga ' +
							'para adjuntar la evidencia de la transferencia.',
					},
					400
				);

			// --- Retirar: genera una solicitud para que la apruebe el admin ---
			// El saldo NO se descuenta aquí: se descuenta cuando el admin aprueba.
			// La comprobación de nivel y de billetera se hace en el servidor,
			// que es la única capa que no se puede saltar desde el navegador.
			case 'retirar': {
				const level = await getSheetUserLevel(username, session.email);
				if (!canWithdraw(level)) {
					return json(
						{
							ok: false,
							message:
								'Para retirar saldo necesitas alcanzar el nivel Oro. ' +
								'Tu nivel actual no cumple el requisito.',
						},
						403
					);
				}

				// Sin billetera registrada no hay a dónde enviar el retiro.
				const wallet = await getUserWallet(username, session.email);
				if (!wallet || !wallet.walletType || !wallet.walletNumber) {
					return json(
						{
							ok: false,
							message:
								'No tienes una billetera registrada. Actualiza tu medio de pago ' +
								'desde tu información de cuenta antes de solicitar un retiro.',
						},
						400
					);
				}

				// El saldo se valida al solicitar para no acumular solicitudes
				// que el admin no podría aprobar después, pero no se descuenta.
				const available = await currentBalance(username, session.email);
				if (value > available) {
					return json(
						{
							ok: false,
							message: `Saldo insuficiente. Tienes ${fmt(available)} disponibles.`,
						},
						400
					);
				}

				const request = await createWithdrawal({
					username,
					email: session.email,
					amount: value,
					commission: adminCommission(value),
					netAmount: netAmount(value),
					walletType: wallet.walletType,
					walletNumber: wallet.walletNumber,
					level: level ?? '',
				});

				return json({
					ok: true,
					message:
						`Tu solicitud de retiro por ${fmt(value)} fue enviada al administrador. ` +
						`Recibirás ${fmt(netAmount(value))} (comisión de ${fmt(adminCommission(value))}). ` +
						`Referencia: solicitud #${request.id}.`,
				});
			}

			// --- Enviar: transfiere saldo a otro usuario registrado ---
			case 'enviar': {
				const target = String(to ?? '').trim();
				if (!target) {
					return json({ ok: false, message: 'Indica el usuario que recibirá el saldo.' }, 400);
				}

				const users = await getGoogleSheetUsers();
				const personal = buildPersonalHierarchy(users, { username, email: session.email });
				if (!personal.upline || personal.upline.name.toLowerCase() !== target.toLowerCase()) {
					return json({ ok: false, message: 'Solo puedes enviar saldo a tu líder registrado.' }, 403);
				}
				const found = users.find(
					(u) => String(u.username ?? '').trim().toLowerCase() === target.toLowerCase()
				);
				if (!found) {
					return json({ ok: false, message: 'Ese usuario no está registrado en la hoja.' }, 404);
				}

				const ok = await moveBalance(username, value, found.username);
				return ok
					? json({
							ok: true,
							message: `Enviaste ${fmt(value)} a ${found.username} correctamente.`,
						})
					: json(
							{ ok: false, message: 'Saldo insuficiente o destinatario inválido.' },
							400
						);
			}

			default:
				return json({ ok: false, message: 'Operación no reconocida.' }, 400);
		}
	} catch (err) {
		console.error('Error en la operación de saldo:', err);
		return json({ ok: false, message: 'Error del servidor. Inténtalo de nuevo.' }, 500);
	}
};

function json(payload: { ok: boolean; message: string; [key: string]: unknown }, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

function fmt(value: number) {
	return `$${Math.round(value).toLocaleString('es-CO')}`;
}

/** Saldo actual del usuario en la hoja. */
async function currentBalance(username: string, email: string): Promise<number> {
	return parseSheetBalance(await getUserBalance(username, email));
}
