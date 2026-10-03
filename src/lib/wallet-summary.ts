/**
 * Desglose de la billetera de un miembro.
 *
 * La hoja guarda un único saldo, pero el usuario necesita ver tres cifras
 * distintas: lo que puede retirar hoy, lo que ya está comprometido en pagos que
 * el administrador todavía no ha aprobado, y lo que ha ganado en total.
 *
 * Este módulo es puro: recibe números y devuelve números, sin leer la hoja, para
 * que el reparto del saldo se pueda comprobar en los tests. Es la misma lógica
 * que aplica `/api/balance` al autorizar un retiro, para que lo que se promete
 * en la pantalla y lo que acepta el servidor no se separen nunca.
 */

/** Saldo autorizado a retirar de una sola vez, como máximo. */
export const MAX_WITHDRAWAL_AMOUNT = 100_000_000;

/** Desglose que ve el miembro en la billetera. */
export interface WalletSummary {
	/** Saldo de la hoja menos lo comprometido en solicitudes abiertas. */
	available: number;
	/** Suma de los retiros y envíos P2P que aún están pendientes. */
	committed: number;
	/** Total acreditado: el saldo de la hoja, comprometido o no. */
	totalEarned: number;
	/** Retiros ya pagados por el administrador. */
	paidOut: number;
}

/** Suma de los montos pendientes de una lista de solicitudes. */
export function sumPending(
	items: readonly { amount?: number; status?: string }[]
): number {
	return items
		.filter((item) => String(item.status ?? '').trim().toLowerCase() === 'pendiente')
		.reduce((total, item) => {
			const amount = Number(item.amount);
			return total + (Number.isFinite(amount) ? amount : 0);
		}, 0);
}

/** Suma de los montos ya aprobados de una lista de solicitudes. */
export function sumApproved(
	items: readonly { amount?: number; status?: string }[]
): number {
	return items
		.filter((item) => String(item.status ?? '').trim().toLowerCase() === 'aprobado')
		.reduce((total, item) => {
			const amount = Number(item.amount);
			return total + (Number.isFinite(amount) ? amount : 0);
		}, 0);
}

/**
 * Calcula el desglose de la billetera.
 *
 * El dinero comprometido nunca se descuenta del saldo de la hoja: la hoja solo
 * se toca cuando el administrador aprueba. Por eso `available` es el saldo
 * menos lo pendiente, y no una cifra que ya venga almacenada.
 */
export function buildWalletSummary(input: {
	/** Saldo acumulado leído de la hoja. */
	balance: number;
	/** Solicitudes de retiro abiertas (pendientes o ya aprobadas). */
	pendingWithdrawals?: number;
	/** Solicitudes P2P pendientes de verificar. */
	pendingPayments?: number;
	/** Retiros que el administrador ya pagó. */
	paidOut?: number;
}): WalletSummary {
	const balance = Number.isFinite(input.balance) ? input.balance : 0;
	const committed = Math.max(
		0,
		(Number(input.pendingWithdrawals) || 0) + (Number(input.pendingPayments) || 0)
	);
	const paidOut = Math.max(0, Number(input.paidOut) || 0);

	return {
		// Nunca negativo: si ya hay más solicitudes abiertas que saldo, lo
		// disponible es 0, no un saldo negativo que invite a pensar que debe.
		available: Math.max(0, balance - committed),
		committed,
		totalEarned: balance,
		paidOut,
	};
}

/**
 * Comprueba una solicitud de retiro contra el desglose.
 *
 * Devuelve el motivo del rechazo, o `null` si la solicitud es válida. El
 * endpoint llama a esta misma función, de modo que el botón del formulario y el
 * servidor aplican las mismas reglas.
 */
export function validateWithdrawal(
	amount: number,
	summary: WalletSummary,
	opts: { canWithdrawLevel: boolean; hasWallet: boolean } = {
		canWithdrawLevel: true,
		hasWallet: true,
	}
): string | null {
	if (!Number.isFinite(amount) || amount <= 0) {
		return 'El monto debe ser un número mayor que cero.';
	}
	if (amount > MAX_WITHDRAWAL_AMOUNT) {
		return 'El monto supera el máximo permitido.';
	}
	if (!opts.canWithdrawLevel) {
		return 'Para retirar saldo necesitas alcanzar el nivel Oro. Tu nivel actual no cumple el requisito.';
	}
	if (!opts.hasWallet) {
		return 'No tienes una billetera registrada. Actualiza tu medio de pago desde tu información de cuenta antes de solicitar un retiro.';
	}
	if (amount > summary.available) {
		return 'Saldo insuficiente para retirar.';
	}
	return null;
}
