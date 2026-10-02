import { JWT } from 'google-auth-library';
import { sheets_v4 } from 'googleapis/build/src/apis/sheets/v4.js';
import type { User } from './types';
import { toZonedIso } from './datetime';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Lee una variable de entorno.
 *
 * Primero mira `process.env` (Vercel, CI, `astro dev` con `--env`) y, si no
 * está, analiza el archivo `.env` del proyecto, que es la única fuente
 * disponible en desarrollo local.
 */
export function getEnvValue(key: string): string | undefined {
	if (process.env[key]) return process.env[key];
	try {
		const envPath = path.resolve(process.cwd(), '.env');
		if (fs.existsSync(envPath)) {
			const content = fs.readFileSync(envPath, 'utf-8');
			const lines = content.split(/\r?\n/);
			for (const line of lines) {
				// Se admite el prefijo "export " habitual en archivos .env.
				const normalized = line.trim().startsWith('export ') ? line.trim().slice(7) : line;
				// Se ignoran comentarios y líneas en blanco.
				if (!normalized.startsWith(key)) continue;
				const rest = normalized.slice(key.length);
				if (!rest.startsWith('=')) continue;

				let val = rest.slice(1).trim();
				if (val.startsWith('"') && val.endsWith('"')) {
					val = val.slice(1, -1);
				}
				return val;
			}
		}
	} catch {
		// Ignore
	}
	return undefined;
}

/**
 * Dominio público del sitio, sin barra final.
 *
 * Los QR de referido y los enlaces que se comparten deben apuntar siempre al
 * sitio real: si se construyen con el origen de la petición, en desarrollo
 * quedarían codificados como `http://localhost:4321` y al escanearlos el
 * teléfono se llevaría a una dirección que no existe en internet.
 *
 * Se resuelve en este orden:
 *   1. `PUBLIC_SITE_URL` del entorno (con o sin https://).
 *   2. El dominio del despliegue en Vercel, vía los encabezados del proxy.
 *   3. El origen de la petición, como último recurso.
 */
export function getPublicSiteUrl(request?: Request): string {
	const configured = (getEnvValue('PUBLIC_SITE_URL') || '').trim();
	if (configured) {
		const withProtocol = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
		return withProtocol.replace(/\/+$/, '');
	}

	const headers = request?.headers;
	const host =
		headers?.get('x-vercel-deployment-url') ||
		headers?.get('x-forwarded-host') ||
		headers?.get('host') ||
		'';
	if (host) {
		// x-forwarded-host puede traer una lista separada por comas.
		const hostname = host.split(',')[0].trim();
		if (hostname && !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(hostname)) {
			return `https://${hostname}`;
		}
	}

	// Último recurso: el origen de la petición (localhost en desarrollo).
	try {
		return new URL(request?.url || 'http://localhost:4321').origin;
	} catch {
		return 'http://localhost:4321';
	}
}

const SHEET_ID = getEnvValue('GOOGLE_SHEET_ID') || '15I3EAN5rcdG034Mu4mT6uuF6bolzCxQd-FKW9oiDyJo';
const SHEET_TAB = getEnvValue('GOOGLE_SHEET_TAB') || 'Usuarios';
const SERVICE_ACCOUNT_EMAIL = getEnvValue('GOOGLE_SERVICE_ACCOUNT_EMAIL');
const PRIVATE_KEY = getEnvValue('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

/** ID del spreadsheet principal (compartido por todas las pestañas). */
export const SPREADSHEET_ID = SHEET_ID;

/** Scope necesario solo para Google Sheets. */
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export function getSheetsClient() {
	if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
		// Se nombra la variable que falta: en producción es el error más común
		// (credenciales no añadidas en el panel de Vercel) y sin este detalle
		// el fallo solo se manifiesta como "no se pudieron cargar los datos".
		const missing = [
			...(!SERVICE_ACCOUNT_EMAIL ? ['GOOGLE_SERVICE_ACCOUNT_EMAIL'] : []),
			...(!PRIVATE_KEY ? ['GOOGLE_PRIVATE_KEY'] : []),
		];
		throw new Error(
			`Las credenciales de Google Service Account no están configuradas. ` +
				`Falta definir: ${missing.join(', ')} en las variables de entorno del servidor.`
		);
	}

	const auth = new JWT({
		email: SERVICE_ACCOUNT_EMAIL,
		key: PRIVATE_KEY,
		scopes: [SHEETS_SCOPE],
	});

	// `sheets_v4.Sheets` ya es la versión v4, por eso no se pasa `version`
	// (esa opción solo existe en el factory `google.sheets()`).
	return new sheets_v4.Sheets({ auth });
}


function normalizeHeader(header: string): string {
	return header
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

/** Localiza la fila de encabezados de la hoja de usuarios. */
function findHeaderRowIndex(rows: unknown[][]): number {
	for (let i = 0; i < rows.length; i++) {
		const normalized = rows[i].map((c: unknown) => normalizeHeader(String(c)));
		if (
			normalized.includes('usuario') &&
			(normalized.includes('contrasena') || normalized.includes('email'))
		) {
			return i;
		}
	}
	return -1;
}

/** Posición de cada campo en la hoja de usuarios (-1 si no existe). */
interface UserColumnIndexes {
	id: number;
	registeredAt: number;
	role: number;
	documentType: number;
	documentNumber: number;
	address: number;
	neighborhood: number;
	city: number;
	phone: number;
	whatsapp: number;
	username: number;
	email: number;
	password: number;
	paymentMethod: number;
	walletNumber: number;
	balance: number;
	level: number;
	referralCode: number;
	ownCode: number;
	documentStatus: number;
	documentLink: number;
	scannedDocument: number;
	nit: number;
	scannedRut: number;
	rutLink: number;
}

/**
 * Traduce la fila de encabezados al índice de cada campo.
 *
 * Todo el módulo (lectura, alta de usuarios y actualizaciones) usa este único
 * mapa: si el administrador reordena o inserta columnas —por ejemplo los datos
 * de contacto— ninguna parte escribe en la columna de otra.
 */
function userColumnIndexes(headers: string[]): UserColumnIndexes {
	// "Contacto WhatsApp" también contiene "whatsapp", así que se localiza
	// primero para no usarlo como teléfono.
	const whatsapp = headers.findIndex((h) => h.includes('whatsapp'));
	return {
		id: headers.indexOf('id'),
		registeredAt: headers.findIndex((h) => h.includes('fecha')),
		role: headers.indexOf('rol'),
		documentType: headers.findIndex((h) => h.includes('tipo') && h.includes('doc')),
		documentNumber: headers.findIndex(
			(h) => (h.includes('numero') || h.includes('num')) && h.includes('doc')
		),
		address: headers.findIndex((h) => h.includes('direccion')),
		neighborhood: headers.findIndex((h) => h.includes('barrio')),
		city: headers.findIndex((h) => h.includes('ciudad')),
		// "Telefonico" no contiene "telefono" (termina en -ico), así que se
		// busca el prefijo "telefon" y no la palabra completa.
		phone: headers.findIndex(
			(h, i) => i !== whatsapp && (h.includes('telefon') || h.includes('movil'))
		),
		whatsapp,
		username: headers.indexOf('usuario'),
		email: headers.indexOf('email'),
		password: headers.findIndex(
			(h) =>
				h.includes('contrase') || h.includes('clave') || h.includes('password') || h === 'pass'
		),
		paymentMethod: headers.findIndex((h) => h.includes('pago')),
		walletNumber: headers.findIndex((h) => h.includes('billetera')),
		balance: headers.findIndex((h) => h.includes('saldo')),
		level: headers.indexOf('level'),
		referralCode: headers.findIndex((h) => h.includes('referido')),
		ownCode: headers.findIndex((h) => h.includes('propio')),
		documentStatus: headers.findIndex((h) => h.includes('estado') && h.includes('doc')),
		documentLink: headers.findIndex((h) => h.includes('enlace') && h.includes('doc')),
		scannedDocument: headers.findIndex((h) => h.includes('escaneado')),
		nit: headers.findIndex((h) => h === 'nit' || h.includes('nit')),
		scannedRut: headers.findIndex(
			(h) => (h.includes('escaneado') || h.includes('archivo') || h.includes('nombre')) && h.includes('rut')
		),
		rutLink: headers.findIndex((h) => h.includes('enlace') && h.includes('rut')),
	};
}

/**
 * Obtiene todos los usuarios desde Google Sheets.
 */
export async function getGoogleSheetUsers(): Promise<User[]> {
	try {
		const sheets = getSheetsClient();
		const response = await sheets.spreadsheets.values.get({
			spreadsheetId: SHEET_ID,
			// El administrador puede añadir columnas de contacto (F..J) y otras
			// al final, así que el rango llega hasta AZ y no solo hasta Z.
			range: `${SHEET_TAB}!A1:AZ5000`,
		});

		const rows = response.data.values || [];
		if (rows.length === 0) return [];

		// Encontrar la fila de encabezados (puede no ser la primera).
		const headerRowIndex = findHeaderRowIndex(rows);

		if (headerRowIndex === -1) {
			return rows.slice(2).map((row) => ({
				id: row[0] || '',
				registeredAt: row[1] || '',
				role: row[2] || 'User',
				documentType: row[3] || '',
				documentNumber: row[4] || '',
				username: row[5] || '',
				email: row[6] || '',
				password: row[7] || '',
				paymentMethod: row[8] || '',
				walletNumber: row[9] || '',
				balance: row[10] || '$0',
				level: row[11] || '1',
				referralCode: row[12] || '',
				ownCode: row[13] || '',
				documentStatus: row[14] || '',
				documentLink: row[15] || '',
				scannedDocument: row[16] || '',
			})).filter(u => u.username || u.email);
		}

		const headers = rows[headerRowIndex].map((h: any) => normalizeHeader(String(h)));
		const idx = userColumnIndexes(headers);

		const cell = (row: unknown[], index: number): string =>
			index === -1 ? '' : String(row[index] ?? '').trim();

		const users: User[] = [];
		for (let i = headerRowIndex + 1; i < rows.length; i++) {
			const row = rows[i];
			if (!row || row.length === 0) continue;

			const username = cell(row, idx.username);
			const email = cell(row, idx.email);
			const password = cell(row, idx.password);

			if (!username && !email) continue;

			users.push({
				id: idx.id !== -1 ? row[idx.id] : '',
				registeredAt: idx.registeredAt !== -1 ? row[idx.registeredAt] : '',
				role: idx.role !== -1 ? row[idx.role] : 'User',
				documentType: idx.documentType !== -1 ? row[idx.documentType] : '',
				documentNumber: idx.documentNumber !== -1 ? row[idx.documentNumber] : '',
				address: cell(row, idx.address),
				neighborhood: cell(row, idx.neighborhood),
				city: cell(row, idx.city),
				phone: cell(row, idx.phone),
				whatsapp: cell(row, idx.whatsapp),
				username,
				email,
				password,
				paymentMethod: idx.paymentMethod !== -1 ? row[idx.paymentMethod] : '',
				walletNumber: idx.walletNumber !== -1 ? row[idx.walletNumber] : '',
				balance: idx.balance !== -1 ? row[idx.balance] : '$0',
				level: idx.level !== -1 ? row[idx.level] : '1',
				referralCode: idx.referralCode !== -1 ? row[idx.referralCode] : '',
				ownCode: idx.ownCode !== -1 ? row[idx.ownCode] : '',
				documentStatus: idx.documentStatus !== -1 ? row[idx.documentStatus] : '',
				documentLink: idx.documentLink !== -1 ? row[idx.documentLink] : '',
				scannedDocument: idx.scannedDocument !== -1 ? row[idx.scannedDocument] : '',
				nit: idx.nit !== -1 ? row[idx.nit] : '',
				scannedRut: idx.scannedRut !== -1 ? row[idx.scannedRut] : '',
				rutLink: idx.rutLink !== -1 ? row[idx.rutLink] : '',
			});
		}
		return users;
	} catch (error) {
		console.error('Error al leer de Google Sheets:', error);
		throw error;
	}
}



/**
 * Agrega un nuevo usuario en Google Sheets.
 *
 * La fila se arma por nombre de columna, no por posición: el administrador
 * reordena o inserta columnas con frecuencia (por ejemplo los datos de
 * contacto) y una escritura posicional pondría el usuario en "Direccion
 * Residencia" y la contraseña en "Ciudad de Residencia".
 */
export async function appendGoogleSheetUser(user: {
	username: string;
	email: string;
	passwordHash: string;
	/** Código de quien lo refiere (columna "Código Referido"). */
	referralCode?: string;
}): Promise<void> {
	const sheets = getSheetsClient();

	const res = await sheets.spreadsheets.values.get({
		spreadsheetId: SHEET_ID,
		range: `${SHEET_TAB}!A1:AZ50`,
	});
	const rows = res.data.values || [];
	const headerRow = findHeaderRowIndex(rows);
	if (headerRow === -1) {
		throw new Error('No se encontró la fila de encabezados de la hoja de usuarios.');
	}

	const headers = rows[headerRow].map((h: unknown) => normalizeHeader(String(h)));
	const idx = userColumnIndexes(headers);
	if (idx.username === -1 || idx.email === -1) {
		throw new Error('La hoja de usuarios no tiene las columnas "Usuario" y "Email".');
	}

	let nextId = 1;
	try {
		const existingUsers = await getGoogleSheetUsers();
		if (existingUsers.length > 0) {
			const highestId = existingUsers.reduce((max, u) => {
				const idNum = parseInt(u.id || '0', 10);
				return !isNaN(idNum) && idNum > max ? idNum : max;
			}, 0);
			nextId = highestId + 1;
		}
	} catch {
		nextId = Date.now();
	}

	// Se cubre la última columna con datos: la fila debe llegar completa hasta
	// el final de la tabla, no hasta la posición del último valor escrito.
	const lastColumn = Math.max(headers.length - 1, ...Object.values(idx).filter((i) => i !== -1));
	const newRow: string[] = new Array(lastColumn + 1).fill('');
	const set = (column: number, value: string) => {
		if (column !== -1) newRow[column] = value;
	};

	// ISO 8601 con desfase: evita el desfase de 5 h del servidor (UTC)
	set(idx.id, String(nextId));
	set(idx.registeredAt, toZonedIso());
	set(idx.role, 'User');
	set(idx.username, user.username);
	set(idx.email, user.email);
	set(idx.password, user.passwordHash);
	set(idx.balance, ' $0');
	set(idx.level, '1');
	set(idx.referralCode, user.referralCode || '');
	set(idx.ownCode, user.username);
	set(idx.documentStatus, 'Pendiente');

	// Google rechaza escrituras fuera de la cuadrícula, así que se comprueba
	// que la hoja tenga sitio antes de añadir la fila.
	await ensureUserGridCapacity(sheets, newRow.length);

	await sheets.spreadsheets.values.append({
		spreadsheetId: SHEET_ID,
		range: `${SHEET_TAB}!A:${columnLetter(newRow.length - 1)}`,
		valueInputOption: 'USER_ENTERED',
		insertDataOption: 'INSERT_ROWS',
		requestBody: {
			values: [newRow],
		},
	});
}

/** Campos de documento que se pueden actualizar de un usuario. */
export interface UserDocumentFields {
	documentType?: string;
	documentNumber?: string;
	documentStatus?: string;
	documentLink?: string;
	scannedDocument?: string;
	/** Número de Identificación Tributaria. */
	nit?: string;
	/** Nombre del archivo del RUT. */
	scannedRut?: string;
	/** Enlace al archivo del RUT. */
	rutLink?: string;
}

/**
 * Busca la fila de un usuario en la hoja.
 *
 * Devuelve `null` si no se puede leer la hoja, no se encuentra la fila de
 * encabezados o el usuario no está dado de alta.
 */
async function findUserRow(
	username: string
): Promise<{
	sheets: ReturnType<typeof getSheetsClient>;
	idx: UserColumnIndexes;
	rowIndex: number;
	rows: unknown[][];
} | null> {
	const sheets = getSheetsClient();

	const res = await sheets.spreadsheets.values.get({
		spreadsheetId: SHEET_ID,
		range: `${SHEET_TAB}!A1:AZ2000`,
	});
	const rows = res.data.values || [];
	if (rows.length === 0) return null;

	// La fila 1 suele estar vacía: los encabezados no siempre están en la
	// primera fila, se localizan por contenido.
	const headerRow = findHeaderRowIndex(rows);
	if (headerRow === -1) return null;

	const idx = userColumnIndexes(rows[headerRow].map((h: unknown) => normalizeHeader(String(h))));
	if (idx.username === -1) return null;

	const target = String(username || '').trim().toLowerCase();
	const rowIndex = rows.findIndex(
		(row, i) => i > headerRow && String(row?.[idx.username] || '').trim().toLowerCase() === target
	);
	if (rowIndex === -1) return null;

	return { sheets, idx, rowIndex, rows };
}

/** Escribe una celda suelta de la fila de un usuario. */
async function writeUserCell(
	sheets: ReturnType<typeof getSheetsClient>,
	rowIndex: number,
	column: number,
	value: string
): Promise<void> {
	await sheets.spreadsheets.values.update({
		spreadsheetId: SHEET_ID,
		range: `${SHEET_TAB}!${columnLetter(column)}${rowIndex + 1}`,
		valueInputOption: 'RAW',
		requestBody: { values: [[value]] },
	});
}

/**
 * Reemplaza la contraseña (ya hasheada) de un usuario en Google Sheets.
 * Devuelve `true` si encontró la fila y la actualizó.
 */
export async function updateSheetUserPassword(
	username: string,
	hashedPassword: string
): Promise<boolean> {
	const found = await findUserRow(username);
	if (!found || found.idx.password === -1) return false;

	await writeUserCell(found.sheets, found.rowIndex, found.idx.password, hashedPassword);
	return true;
}

/**
 * Actualiza las columnas de documento de un usuario (estado, enlace y nombre
 * del archivo). Devuelve `true` si encontró y actualizó la fila.
 */
export async function updateSheetUserDocument(
	username: string,
	fields: UserDocumentFields
): Promise<boolean> {
	const found = await findUserRow(username);
	if (!found) return false;
	const { sheets, idx, rowIndex } = found;

	// Se escribe cada columna por separado: así no depende de que existan todas
	const updates: { col: number; value: string }[] = [];
	if (fields.documentType !== undefined && idx.documentType !== -1)
		updates.push({ col: idx.documentType, value: fields.documentType });
	if (fields.documentNumber !== undefined && idx.documentNumber !== -1)
		updates.push({ col: idx.documentNumber, value: fields.documentNumber });
	if (fields.documentStatus !== undefined && idx.documentStatus !== -1)
		updates.push({ col: idx.documentStatus, value: fields.documentStatus });
	if (fields.documentLink !== undefined && idx.documentLink !== -1)
		updates.push({ col: idx.documentLink, value: fields.documentLink });
	if (fields.scannedDocument !== undefined && idx.scannedDocument !== -1)
		updates.push({ col: idx.scannedDocument, value: fields.scannedDocument });
	if (fields.nit !== undefined && idx.nit !== -1) updates.push({ col: idx.nit, value: fields.nit });
	if (fields.scannedRut !== undefined && idx.scannedRut !== -1)
		updates.push({ col: idx.scannedRut, value: fields.scannedRut });
	if (fields.rutLink !== undefined && idx.rutLink !== -1)
		updates.push({ col: idx.rutLink, value: fields.rutLink });

	for (const u of updates) {
		await writeUserCell(sheets, rowIndex, u.col, u.value);
	}

	return updates.length > 0;
}

/**
 * Columnas que necesita la pestaña de usuarios para guardar el NIT y el RUT.
 *
 * `match` usa los mismos criterios que la lectura (`getGoogleSheetUsers`), para
 * no crear una columna que ya exista con otro nombre (p. ej. "RUT escaneado").
 */
export const USER_DOCUMENT_COLUMNS: { header: string; match: (normalized: string) => boolean }[] = [
	{ header: 'NIT', match: (h) => h === 'nit' || h.includes('nit') },
	{
		header: 'Escaneado RUT',
		match: (h) =>
			(h.includes('escaneado') || h.includes('archivo') || h.includes('nombre')) && h.includes('rut'),
	},
	{ header: 'Enlace RUT', match: (h) => h.includes('enlace') && h.includes('rut') },
];

/**
 * Columnas que necesita la pestaña de usuarios para guardar los datos de
 * contacto y residencia que muestra "Información de la cuenta".
 *
 * `match` replica los criterios de la lectura (`getGoogleSheetUsers`), para no
 * crear una columna que ya exista con otro nombre.
 */
export const USER_PROFILE_COLUMNS: { header: string; match: (normalized: string) => boolean }[] = [
	{ header: 'Direccion', match: (h) => h.includes('direccion') },
	{ header: 'Barrio', match: (h) => h.includes('barrio') },
	{ header: 'Ciudad', match: (h) => h.includes('ciudad') },
	// "Telefonico" no contiene "telefono": se busca el prefijo "telefon".
	{ header: 'Telefono', match: (h) => h.includes('telefon') || h.includes('movil') },
	{ header: 'Whatsapp', match: (h) => h.includes('whatsapp') },
];

/** Mínimo de columnas que se garantizan en la pestaña de usuarios. */
const MIN_USER_COLUMNS = 26;

/**
 * Amplía la cuadrícula de la pestaña de usuarios si le faltan columnas.
 *
 * Google fija un tope de columnas por hoja (en la de usuarios son 20) y
 * rechaza con "exceeds grid limits" cualquier escritura fuera de ese rango,
 * así que antes de añadir encabezados hay que asegurar que la hoja tenga sitio.
 */
async function ensureUserGridCapacity(
	sheets: ReturnType<typeof getSheetsClient>,
	required: number
): Promise<void> {
	const meta = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
	const sheet = meta.data.sheets?.find((s) => s.properties?.title === SHEET_TAB);
	const sheetId = sheet?.properties?.sheetId;
	const columnCount = sheet?.properties?.gridProperties?.columnCount ?? 0;
	if (sheetId === undefined || sheetId === null || columnCount >= required) return;

	await sheets.spreadsheets.batchUpdate({
		spreadsheetId: SHEET_ID,
		requestBody: {
			requests: [
				{
					updateSheetProperties: {
						properties: {
							sheetId,
							gridProperties: { columnCount: Math.max(required, columnCount) },
						},
						fields: 'gridProperties.columnCount',
					},
				},
			],
		},
	});
}

/**
 * Garantiza que la pestaña de usuarios tenga las columnas indicadas.
 *
 * Solo se añaden las que falten, al final de la fila de encabezados, para no
 * alterar el orden de las columnas que ya usa el administrador. Devuelve `true`
 * si tuvo que crear alguna.
 */
async function ensureUserColumns(
	columns: { header: string; match: (normalized: string) => boolean }[]
): Promise<boolean> {
	const sheets = getSheetsClient();

	const res = await sheets.spreadsheets.values.get({
		spreadsheetId: SHEET_ID,
		range: `${SHEET_TAB}!A1:AZ50`,
	});
	const rows = res.data.values || [];
	if (rows.length === 0) return false;

	// Igual que en `getGoogleSheetUsers`: la fila 1 puede estar vacía, así que
	// los encabezados se localizan por contenido.
	const headerRow = findHeaderRowIndex(rows);
	if (headerRow === -1) return false;

	const headers = rows[headerRow].map((h: unknown) => normalizeHeader(String(h)));
	const missing = columns.filter((col) => !headers.some((h) => col.match(h))).map((col) => col.header);
	if (missing.length === 0) return false;

	// La hoja puede tener menos columnas de las necesarias: se amplía antes de
	// escribir, o Google rechaza el rango.
	await ensureUserGridCapacity(sheets, Math.max(MIN_USER_COLUMNS, headers.length + missing.length));

	// Se escriben después de la última columna con datos: Google recorta las
	// celdas vacías del final de cada fila.
	await sheets.spreadsheets.values.update({
		spreadsheetId: SHEET_ID,
		range: `${SHEET_TAB}!${columnLetter(headers.length)}${headerRow + 1}`,
		valueInputOption: 'RAW',
		requestBody: { values: [[...missing]] },
	});

	return true;
}

/**
 * Garantiza que la pestaña de usuarios tenga las columnas de NIT y RUT.
 *
 * Devuelve `true` si tuvo que crear alguna.
 */
export function ensureUserDocumentColumns(): Promise<boolean> {
	return ensureUserColumns(USER_DOCUMENT_COLUMNS);
}

/**
 * Garantiza que la pestaña de usuarios tenga las columnas de dirección, barrio,
 * ciudad, teléfono y WhatsApp. Devuelve `true` si tuvo que crear alguna.
 */
export function ensureUserProfileColumns(): Promise<boolean> {
	return ensureUserColumns(USER_PROFILE_COLUMNS);
}

/** Datos de contacto y residencia que se pueden actualizar de un usuario. */
export interface UserProfileFields {
	address?: string;
	neighborhood?: string;
	city?: string;
	phone?: string;

	whatsapp?: string;
}

/**
 * Actualiza la dirección, barrio, ciudad, teléfono y WhatsApp de un usuario.
 * Devuelve `true` si encontró la fila y escribió al menos un campo.
 */
export async function updateSheetUserProfile(
	username: string,
	fields: UserProfileFields
): Promise<boolean> {
	const found = await findUserRow(username);
	if (!found) return false;
	const { sheets, idx, rowIndex } = found;

	// Igual que en `updateSheetUserDocument`: cada columna por separado, para no
	// depender de que existan todas.
	const columns: Record<keyof UserProfileFields, number> = {
		address: idx.address,
		neighborhood: idx.neighborhood,
		city: idx.city,
		phone: idx.phone,
		whatsapp: idx.whatsapp,
	};

	const updates: { col: number; value: string }[] = [];
	for (const key of Object.keys(columns) as (keyof UserProfileFields)[]) {
		const value = fields[key];
		if (value !== undefined && columns[key] !== -1) {
			updates.push({ col: columns[key], value });
		}
	}

	for (const u of updates) {
		await writeUserCell(sheets, rowIndex, u.col, u.value);
	}

	return updates.length > 0;
}

/**
 * Borra los datos de contacto y residencia de un usuario (deja las celdas
 * vacías). Devuelve `true` si encontró la fila y la limpió.
 */
export async function clearSheetUserProfile(username: string): Promise<boolean> {
	const found = await findUserRow(username);
	if (!found) return false;
	const { sheets, idx, rowIndex } = found;

	const columns = [idx.address, idx.neighborhood, idx.city, idx.phone, idx.whatsapp].filter(
		(column) => column !== -1
	);
	if (columns.length === 0) return false;

	for (const column of columns) {
		await writeUserCell(sheets, rowIndex, column, '');
	}

	return true;
}

/** Convierte un índice de columna (0-based) en letra (0 -> A, 26 -> AA). */
function columnLetter(index: number): string {
	let letter = '';
	let n = index;
	do {
		letter = String.fromCharCode(65 + (n % 26)) + letter;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return letter;
}

// ---------------------------------------------------------------------------
// Operaciones sobre el saldo acumulado
// ---------------------------------------------------------------------------

/**
 * Saldo en número de la celda "saldo acumulado".
 *
 * Acepta los formatos que conviven en la hoja (" $0", "150.00", "1.234,56").
 * Devuelve 0 cuando la celda está vacía o no es un número legible, para que
 * un valor corrupto nunca se interprete como saldo disponible.
 */
export function parseSheetBalance(raw: unknown): number {
	const cleaned = String(raw ?? '').replace(/[^\d.,-]/g, '');
	if (!cleaned) return 0;

	const lastComma = cleaned.lastIndexOf(',');
	const lastDot = cleaned.lastIndexOf('.');
	const decimalAt = Math.max(lastComma, lastDot);

	let normalized: string;
	if (decimalAt === -1) {
		normalized = cleaned;
	} else {
		const decimals = cleaned.length - decimalAt - 1;
		const whole = cleaned.slice(0, decimalAt);
		const otherSep = decimalAt === lastDot ? ',' : '.';
		if (whole.includes(otherSep)) {
			normalized = whole.replace(/[.,]/g, '') + '.' + cleaned.slice(decimalAt + 1);
		} else if (decimals === 3 && whole.replace(/[.,]/g, '').length > 0) {
			normalized = cleaned.replace(/[.,]/g, '');
		} else {
			normalized = whole.replace(/[.,]/g, '') + '.' + cleaned.slice(decimalAt + 1);
		}
	}

	const value = Number(normalized);
	return Number.isFinite(value) ? value : 0;
}

/**
 * Escribe un saldo nuevo en la fila del usuario.
 *
 * Se guarda sin símbolos y con punto decimal ("1234.5") para que la celda
 * siga siendo numérica y se pueda sumar en la propia hoja. `valueInputOption:
 * 'RAW'` evita que Sheets lo interprete como texto.
 */
export async function setSheetUserBalance(username: string, value: number): Promise<boolean> {
	const found = await findUserRow(username);
	if (!found || found.idx.balance === -1) return false;

	await writeUserCell(found.sheets, found.rowIndex, found.idx.balance, String(value));
	return true;
}

/**
 * Resta saldo al usuario y, si `toUsername` no está vacío, lo suma a otro.
 *
 * Se usa para "retirar" (solo resta) y "enviar" (resta y suma). Devuelve
 * `false` si el usuario no existe o no tiene saldo suficiente: en ese caso no
 * se escribe nada, de modo que el saldo nunca queda en negativo por accidente.
 */
export async function moveBalance(
	fromUsername: string,
	amount: number,
	toUsername?: string
): Promise<boolean> {
	if (!(amount > 0)) return false;

	const from = await findUserRow(fromUsername);
	if (!from || from.idx.balance === -1) return false;

	const fromBalance = parseSheetBalance(from.rows[from.rowIndex]?.[from.idx.balance]);
	if (fromBalance < amount) return false;

	let to: Awaited<ReturnType<typeof findUserRow>> = null;
	if (toUsername) {
		const target = String(toUsername).trim().toLowerCase();
		if (!target) return false;
		// No se permite transferirse saldo a uno mismo: sería un no-op que
		// solo genera confusion en el historial.
		if (target === String(fromUsername).trim().toLowerCase()) return false;

		to = await findUserRow(target);
		if (!to || to.idx.balance === -1) return false;
	}

	await writeUserCell(from.sheets, from.rowIndex, from.idx.balance, String(fromBalance - amount));
	if (to) {
		const toBalance = parseSheetBalance(to.rows[to.rowIndex]?.[to.idx.balance]);
		await writeUserCell(to.sheets, to.rowIndex, to.idx.balance, String(toBalance + amount));
	}
	return true;
}
