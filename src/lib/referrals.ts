import QRCode from 'qrcode';
import { getGoogleSheetUsers } from './sheets';
import { listTopups, TOPUP_STATUS } from './topups';
import { RECARGA_INICIAL_AMOUNT } from './p2p';
import type { User } from './types';

/** Comisión única por referido, pagada al aprobar la recarga inicial de $15.000. */
export const COMMISSION_PER_REFERRAL = 1000;

/** Cada referido genera un pago de comisión, después de activar su cuenta. */
export const REFERRAL_COMMISSION_PAYMENTS = 1;


/**
 * Genera el QR de referido de un usuario como SVG.
 *
 * El QR codifica el mismo enlace que ya se comparte a mano
 * (`/register?ref=CODIGO`), de modo que escanearlo y escribir el código llevan
 * al mismo resultado. Se usa nivel de corrección bajo porque el QR se muestra en
 * pantallas limpias: si alguien lo tapa con el dedo, el usuario puede escribir
 * el código a mano.
 */
export async function buildReferralQrSvg(shareUrl: string): Promise<string> {
	return QRCode.toString(shareUrl, {
		type: 'svg',
		errorCorrectionLevel: 'L',
		margin: 1,
		width: 240,
		color: { dark: '#0b1220', light: '#ffffff' },
	});
}

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
 * Busca al usuario que trae el código de referido indicado, dentro de una
 * lista ya cargada. Se puede introducir el "código propio" o el nombre de
 * usuario.
 *
 * Va aparte de `lookupReferrer` para poder comprobar la lógica de matching
 * sin tocar Google Sheets.
 */
export function findUserByReferralCode(users: User[], code: string): User | null {
	const target = normalize(code);
	if (!target) return null;

	return (
		users.find(
			(u) =>
				normalize(ownCodeOf(u)) === target ||
				normalize(u.username) === target ||
				normalize(u.email) === target ||
				normalize(u.ownCode) === target ||
				normalize(u.id) === target
		) ?? null
	);
}

/**
 * Estado de un código de referido que llega en el enlace de registro.
 *
 * No basta con "encontrado / no encontrado": si la hoja no responde,
 * `missing` sería mentira y el formulario mostraría "este usuario no está
 * registrado" a alguien cuyo invitador sí existe. Por eso el fallo de lectura
 * se devuelve aparte (`unavailable`) y quien llame decide qué mostrar.
 */
export type ReferrerLookup =
	| { status: 'found'; user: User }
	| { status: 'missing'; user: null }
	| { status: 'unavailable'; user: null };

/**
 * Busca el nombre de usuario referido exclusivamente en la columna `Usuario`
 * de Google Sheets y cuenta por qué no se encontró, si es el caso.
 */
export async function lookupReferrer(code: string): Promise<ReferrerLookup> {
	const target = normalize(code);
	if (!target) return { status: 'missing', user: null };

	let sheetUsers: User[];
	try {
		sheetUsers = await getGoogleSheetUsers();
	} catch (err) {
		console.error('No se pudo verificar el código de referido en Google Sheets:', err);
		return { status: 'unavailable', user: null };
	}

	const user = sheetUsers.find((candidate) => normalize(candidate.username) === target);

	if (user) {
		return { status: 'found', user };
	}

	return { status: 'missing', user: null };
}

/**
 * Busca en Google Sheets al usuario cuyo nombre de usuario coincide con el
 * referido indicado.
 *
 * Devuelve `null` tanto si no existe como si la hoja no responde: para el
 * alta da igual (sin hoja el registro no se puede guardar). Quién necesite
 * distinguir ambos casos debe usar `lookupReferrer`.
 */
export async function findReferrerByCode(code: string): Promise<User | null> {
	const result = await lookupReferrer(code);
	return result.user;
}

/**
 * Enlace corto de referido.
 *
 * Se comparte por WhatsApp y en redes, así que va lo más corto posible: la
 * ruta `/r/CODIGO` redirige a `/register?ref=CODIGO`, que es donde el
 * formulario lee el código. Antes se compartía la ruta larga completa; cambiar
 * aquí actualiza a la vez el QR, la invitación y lo que se muestra en el panel.
 */
export function referralShortUrl(origin: string, code: string): string {
	return `${origin.replace(/\/$/, '')}/r/${encodeURIComponent(code)}`;
}

export interface ReferralStats {
	/** Código con el que este usuario capta. */
	ownCode: string;
	/** Usuarios que se registraron con su código. */
	referred: User[];
	/** Cuántos son. */
	count: number;
	/** Comisión asociada a referidos activos: $1.000 por cada recarga inicial aprobada. */
	commission: number;
	/** Enlace listo para compartir. */
	shareUrl: string;
}

/**
 * Estadísticas de la red de referidos de un usuario.
 *
	 * La tabla y los enlaces incluyen todos los registros que citan su código.
	 * La comisión se gana únicamente cuando se aprueba la recarga inicial.
 * Si la hoja no está disponible devuelve las estadísticas vacías.
 */
export async function getReferralStats(user: User, origin: string): Promise<ReferralStats> {
	// Los enlaces compartidos se validan contra la columna Usuario.
	const ownCode = user.username || ownCodeOf(user);

	let referred: User[] = [];
	let activatedNames = new Set<string>();
	try {
		const all = await getGoogleSheetUsers();
		const legacyCode = ownCodeOf(user);
		referred = all.filter(
			(u) =>
				isReferredBy(u, ownCode) ||
				(legacyCode !== ownCode && isReferredBy(u, legacyCode))
		);
		const referredNames = new Set(referred.map((person) => normalize(person.username)).filter(Boolean));
		const approvedInitialTopups = await listTopups(TOPUP_STATUS.aprobado);
		activatedNames = new Set(
			approvedInitialTopups
				.filter((topup) => topup.amount === RECARGA_INICIAL_AMOUNT && referredNames.has(normalize(topup.username)))
				.map((topup) => normalize(topup.username))
		);
	} catch (err) {
		console.error('No se pudo calcular la red o sus recargas aprobadas:', err);
	}

	return {
		ownCode,
		referred,
		count: referred.length,
		commission: activatedNames.size * COMMISSION_PER_REFERRAL * REFERRAL_COMMISSION_PAYMENTS,
		shareUrl: referralShortUrl(origin, user.username || ownCode),
	};
}
