import { getGoogleSheetUsers } from './sheets';
import { readJSON } from './store';
import type { User } from './types';

/** Nivel asignado cuando el usuario no tiene uno. */
export const DEFAULT_LEVEL = '1';

function normalize(value: string | undefined): string {
	return (value || '').trim().toLowerCase();
}

/**
 * Busca un usuario por nombre de usuario o correo.
 * Primero consulta Google Sheets y, si no está o falla, el registro local
 * (`data/users.json`).
 */
export async function findUser(username: string, email: string): Promise<User | null> {
	const match = (u: User) =>
		(!!username && normalize(u.username) === normalize(username)) ||
		(!!email && normalize(u.email) === normalize(email));

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
