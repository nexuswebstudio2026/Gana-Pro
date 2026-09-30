import {
	ensureUserProfileColumns,
	getGoogleSheetUsers,
	updateSheetUserProfile,
} from './sheets';
import { isProfileEmpty, profileToFormValues } from './account-profile';
import type { AccountProfile } from './account-profile';

/** Operaciones del CRUD de la información de la cuenta. */
export type ProfileAction = 'save' | 'delete';

/** Resultado de guardar el contacto de un usuario. */
export type SaveResult = 'created' | 'updated' | 'not-found' | 'invalid';

/** Fila del usuario tal y como está en la hoja, para el CRUD del admin. */
export interface UserProfileRow {
	username: string;
	email: string;
	profile: AccountProfile;
}

/**
 * Guarda el contacto de un usuario, creando las columnas que falten antes.
 *
 * Se dice "created" si el usuario no tenía ningún dato de contacto, para poder
 * distinguir el alta de una modificación y avisar al usuario.
 */
export async function saveUserProfile(
	username: string,
	profile: AccountProfile
): Promise<SaveResult> {
	if (isProfileEmpty(profile)) return 'invalid';

	// Si la hoja no tiene aún las columnas de contacto, se crean: si no, el
	// contacto se escribiría en una celda que Google descarta.
	try {
		await ensureUserProfileColumns();
	} catch (err) {
		console.error('No se pudieron preparar las columnas de contacto:', err);
	}

	const existed = await hasContactData(username);
	const updated = await updateSheetUserProfile(username, profile);
	if (!updated) return 'not-found';

	return existed ? 'updated' : 'created';
}

/** ¿Tiene ya el usuario algún dato de contacto en la hoja? */
async function hasContactData(username: string): Promise<boolean> {
	try {
		const users = await getGoogleSheetUsers();
		const match = users.find(
			(u) => (u.username || '').trim().toLowerCase() === username.trim().toLowerCase()
		);
		if (!match) return false;
		return !isProfileEmpty(profileToFormValues(match));
	} catch {
		// Si no se puede leer, se asume que ya existía: solo cambia el aviso.
		return true;
	}
}

/**
 * Filas de contacto de todos los usuarios, para el listado del administrador.
 * Devuelve `[]` si la hoja no se puede leer (la página avisa por separado).
 */
export async function listUserProfiles(): Promise<UserProfileRow[]> {
	const users = await getGoogleSheetUsers();
	return users
		.filter((u) => (u.username || '').trim())
		.map((u) => ({
			username: u.username,
			email: u.email || '',
			profile: profileToFormValues(u),
		}));
}