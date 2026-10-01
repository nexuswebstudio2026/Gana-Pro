import type { APIRoute } from 'astro';
import { validateSession } from '../../lib/session';
import {
	getGoogleSheetUsers,
	moveBalance,
	parseSheetBalance,
	setSheetUserBalance,
} from '../../lib/sheets';
import { getUserBalance } from '../../lib/users';

export const prerender = false;

/** Monto máximo permitido por operación, para no escribir cifras absurdas. */
const MAX_AMOUNT = 100_000_000;

/**
 * Operaciones sobre el saldo acumulado.
 *
 * Recibe JSON: `{ op, amount, to }` y responde `{ ok, message }`.
 * El saldo se modifica de inmediato en Google Sheets.
 */
export const POST: APIRoute = async (Astro) => {
	try {
		const session = validateSession(Astro.cookies.get('auth_session')?.value);
		if (!session) {
			return new Response(JSON.stringify({ ok: false, message: 'Sesión no válida.' }), {
				status: 401,
			});
		}

		const body = await Astro.request.json().catch(() => null);
		if (!body) {
			return new Response(JSON.stringify({ ok: false, message: 'Datos inválidos.' }), {
				status: 400,
			});
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
			// --- Recargar: la plataforma acredita saldo al usuario ---
			case 'recargar': {
				const ok = await setSheetUserBalance(
					username,
					(await currentBalance(username, session.email)) + value
				);
				return ok
					? json({ ok: true, message: `Recargaste ${fmt(value)} correctamente.` })
					: json({ ok: false, message: 'No se encontró tu fila en Google Sheets.' }, 404);
			}

			// --- Retirar: el usuario saca saldo de la plataforma ---
			case 'retirar': {
				const ok = await moveBalance(username, value);
				return ok
					? json({ ok: true, message: `Retiraste ${fmt(value)} correctamente.` })
					: json(
							{ ok: false, message: 'Saldo insuficiente o usuario no encontrado en la hoja.' },
							400
						);
			}

			// --- Enviar: transfiere saldo a otro usuario registrado ---
			case 'enviar': {
				const target = String(to ?? '').trim();
				if (!target) {
					return json({ ok: false, message: 'Indica el usuario que recibirá el saldo.' }, 400);
				}

				const users = await getGoogleSheetUsers();
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

			// --- Solicitar: acumulado pendiente de aprobación del admin ---
			case 'solicitar': {
				const ok = await setSheetUserBalance(
					username,
					(await currentBalance(username, session.email)) + value
				);
				return ok
					? json({ ok: true, message: `Solicitud de ${fmt(value)} registrada correctamente.` })
					: json({ ok: false, message: 'No se encontró tu fila en Google Sheets.' }, 404);
			}

			default:
				return json({ ok: false, message: 'Operación no reconocida.' }, 400);
		}
	} catch (err) {
		console.error('Error en la operación de saldo:', err);
		return json({ ok: false, message: 'Error del servidor. Inténtalo de nuevo.' }, 500);
	}
};

function json(payload: { ok: boolean; message: string }, status = 200) {
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
