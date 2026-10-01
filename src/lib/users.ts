import { getGoogleSheetUsers } from './sheets';
import { readJSON } from './store';
import type { User } from './types';

/** Nivel asignado cuando el usuario no tiene uno. */
export const DEFAULT_LEVEL = '1';

/**
 * Convierte el valor crudo de la celda "saldo acumulado" en un número.
 *
 * En la hoja conviven varios formatos: "$0" (con espacio inicial), "150.00",
 * "1.234,56" y "$1,234.56". Se aplica la regla habitual: el último separador
 * que aparece es el decimal y el otro es de miles; si solo hay uno, se
 * considera de miles cuando le siguen exactamente tres dígitos.
 */
function parseBalance(raw: string): number | null {
	const cleaned = raw.replace(/[^\d.,-]/g, '');
	if (!cleaned) return null;

	const lastComma = cleaned.lastIndexOf(',');
	const lastDot = cleaned.lastIndexOf('.');
	// Índice del separador decimal: el último en aparecer.
	const decimalAt = Math.max(lastComma, lastDot);

	let normalized: string;
	if (decimalAt > -1) {
		const decimals = cleaned.length - decimalAt - 1;
		const whole = cleaned.slice(0, decimalAt);
		// Hay otro separador antes: ese es de miles y este es el decimal.
		const otherSep = decimalAt === lastDot ? ',' : '.';
		const hasThousands = whole.includes(otherSep);

		if (hasThousands) {
			normalized = whole.replace(/[.,]/g, '') + '.' + cleaned.slice(decimalAt + 1);
		} else if (decimals === 3 && whole.replace(/[.,]/g, '').length > 0) {
			// "1.234" -> separador de miles
			normalized = cleaned.replace(/[.,]/g, '');
		} else {
			// "150.00" -> punto o coma decimal
			normalized = whole.replace(/[.,]/g, '') + '.' + cleaned.slice(decimalAt + 1);
		}
	} else {
		normalized = cleaned;
	}

	const value = Number(normalized);
	return Number.isFinite(value) ? value : null;
}

/**
 * Formatea el saldo de la hoja como pesos colombianos: 1234.5 -> "$1.235".
 * Devuelve `null` si la celda está vacía o no contiene un número legible.
 */
export function formatBalance(raw: string | null | undefined): string | null {
	if (raw == null) return null;
	const value = parseBalance(String(raw));
	if (value == null) return null;
	return `$${Math.round(value).toLocaleString('es-CO')}`;
}

function normalize(value: string | undefined): string {
	return (value || '').trim().toLowerCase();
}

/**
 * Indica si un usuario de la hoja corresponde al usuario conectado.
 *
 * La comparación no distingue mayúsculas ni espacios sobrantes, para que
 * "GanaPro" en la plataforma encuentre "ganapro " en Google Sheets.
 */
function isSameUser(user: User, username: string, email: string): boolean {
	return (
		(!!username && normalize(user.username) === normalize(username)) ||
		(!!email && normalize(user.email) === normalize(email))
	);
}

/**
 * Busca un usuario por nombre de usuario o correo.
 * Primero consulta Google Sheets y, si no está o falla, el registro local
 * (`data/users.json`).
 */
export async function findUser(username: string, email: string): Promise<User | null> {
	const match = (u: User) => isSameUser(u, username, email);

	let sheetUsers: User[] = [];
	try {
		sheetUsers = await getGoogleSheetUsers();
	} catch {
		// Sin acceso a la hoja: se continúa con el registro local
	}

	const fromSheet = sheetUsers.find(match);
	if (fromSheet) return fromSheet;

	let localUsers: User[] = [];
	try {
		localUsers = readJSON<User[]>('users.json', []);
	} catch {
		localUsers = [];
	}

	return localUsers.find(match) ?? null;
}

/**
 * Nivel en el que se encuentra el usuario (Bronze, Silver, Gold, Platinum...).
 * Devuelve `DEFAULT_LEVEL` si no se puede determinar.
 */
export async function getUserLevel(username: string, email: string): Promise<string> {
	try {
		const user = await findUser(username, email);
		return String(user?.level ?? '').trim() || DEFAULT_LEVEL;
	} catch (err) {
		console.error('No se pudo obtener el nivel del usuario:', err);
		return DEFAULT_LEVEL;
	}
}

/**
 * Saldo acumulado del usuario, leído de la columna "Saldo" de Google Sheets.
 *
 * A diferencia de `findUser`, aquí **no** se recurre a `data/users.json`: el
 * saldo solo se devuelve si el usuario aparece en la hoja, para no mostrar una
 * cifra que Google no ha confirmado.
 *
 * Devuelve `null` si el usuario no está en la hoja, si la celda está vacía o
 * si no se puede leer (se registra el error en el log del servidor).
 */
export async function getUserBalance(username: string, email: string): Promise<string | null> {
	try {
		const sheetUsers = await getGoogleSheetUsers();
		const user = sheetUsers.find((u) => isSameUser(u, username, email));
		if (!user) return null;

		const balance = String(user.balance ?? '').trim();
		return balance || null;
	} catch (err) {
		console.error('No se pudo obtener el saldo del usuario:', err);
		return null;
	}
}
