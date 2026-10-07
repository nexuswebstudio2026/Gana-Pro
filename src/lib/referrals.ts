import QRCode from 'qrcode';
import { getGoogleSheetUsers } from './sheets';
import { readJSON } from './store';
import type { User } from './types';

/**
 * Comisión que recibe cada usuario por cada nuevo registro con su código.
 *
 * Es un pago ÚNICO por referido: se cuenta una vez por cada alta y nunca se
 * repite aunque el referido siga activo en la plataforma.
 */
/**
 * Comisión por referido: $1.000 al aprobarse el registro y otros $1.000 al
 * aprobarse su primera recarga. Son dos pagos independientes, así que un
 * referido puede llegar a reportar el doble.
 */
export const COMMISSION_PER_REFERRAL = 1000;

/** Pagos que puede generar cada referido: registro + primera recarga. */
export const REFERRAL_COMMISSION_PAYMENTS = 2;


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
 * Busca al usuario que trae el código de referido indicado y cuenta por qué
 * no se encontró, si es el caso.
 */
export async function lookupReferrer(code: string): Promise<ReferrerLookup> {
	const target = normalize(code);
	if (!target) return { status: 'missing', user: null };

	let sheetUsers: User[] = [];
	let sheetAvailable = true;
	try {
		sheetUsers = await getGoogleSheetUsers();
	} catch (err) {
		sheetAvailable = false;
		console.error('No se pudo verificar el código de referido en Google Sheets:', err);
	}

	let localUsers: User[] = [];
	try {
		localUsers = readJSON<User[]>('users.json', []);
	} catch {
		localUsers = [];
	}

	const allUsers = [...sheetUsers, ...localUsers];
	const user = findUserByReferralCode(allUsers, code);

	if (user) {
		return { status: 'found', user };
	}

	return sheetAvailable
		? { status: 'missing', user: null }
		: { status: 'unavailable', user: null };
}

/**
 * Busca al usuario que trae el código de referido indicado.
 * Se puede introducir el "código propio" o el nombre de usuario.
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
		commission: referred.length * COMMISSION_PER_REFERRAL * REFERRAL_COMMISSION_PAYMENTS,
		shareUrl: referralShortUrl(origin, ownCode),
	};
}
