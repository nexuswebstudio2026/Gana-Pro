import { getGoogleSheetUsers } from './sheets';
import type { User } from './types';

/**
 * Comisión que recibe cada usuario por cada nuevo registro con su código.
 *
 * Es un pago ÚNICO por referido: se cuenta una vez por cada alta y nunca se
 * repite aunque el referido siga activo en la plataforma.
 */
export const COMMISSION_PER_REFERRAL = 1000;


/** Formatea un monto en pesos colombianos: 1000 -> "$1.000" */
export function formatCOP(value: number): string {
	return `$${Math.round(value).toLocaleString('es-CO')}`;
}

function normalize(value: string | undefined): string {
	return String(value || '').trim().toLowerCase();
}

/** El código con el que se identifica a un usuario: su "código propio" o su usuario. */
export function ownCodeOf(user: User): string {
	return String(user.ownCode || user.username || '').trim();
}

/**
 * ¿Este usuario fue referido por `code`?
 *
 * Solo se compara la columna "Código Referido": comparar también el código
 * propio haría que un usuario se contara a sí mismo.
 */
export function isReferredBy(user: User, code: string): boolean {
	const target = normalize(code);
	if (!target) return false;
	if (normalize(ownCodeOf(user)) === target) return false; // no se cuenta a si mismo
	return normalize(user.referralCode) === target;
}

/**
 * Busca al usuario que trae el código de referido indicado.
 * Se puede introducir el "código propio" o el nombre de usuario.
 */
export async function findReferrerByCode(code: string): Promise<User | null> {
	const target = normalize(code);
	if (!target) return null;

	let users: User[] = [];
	try {
		users = await getGoogleSheetUsers();
	} catch {
		return null;
	}

	return (
		users.find(
			(u) => normalize(ownCodeOf(u)) === target || normalize(u.username) === target
		) ?? null
	);
}

export interface ReferralStats {
	/** Código con el que este usuario capta. */
	ownCode: string;
	/** Usuarios que se registraron con su código (pago único por cada uno). */
	referred: User[];
	/** Cuántos son. */
	count: number;
	/** Comisión pagada una sola vez por cada referido: $1.000. */
	commission: number;
	/** Enlace listo para compartir. */
	shareUrl: string;
}

/**
 * Estadísticas de la red de referidos de un usuario.
 *
 * Cada referido se cuenta una sola vez (pagamento único al registrarse), así
 * que la comisión se obtiene contando los registros que citan su código, en
 * lugar de leer un saldo almacenado: nunca se desincroniza de la realidad.
 * Si la hoja no está disponible devuelve las estadísticas vacías.
 */
export async function getReferralStats(user: User, origin: string): Promise<ReferralStats> {
	const ownCode = ownCodeOf(user) || user.username || '';

	let referred: User[] = [];
	try {
		const all = await getGoogleSheetUsers();
		referred = all.filter((u) => isReferredBy(u, ownCode));
	} catch (err) {
		console.error('No se pudo calcular la red de referidos:', err);
	}

	return {
		ownCode,
		referred,
		count: referred.length,
		commission: referred.length * COMMISSION_PER_REFERRAL,
		shareUrl: `${origin.replace(/\/$/, '')}/register?ref=${encodeURIComponent(ownCode)}`,
	};
}
