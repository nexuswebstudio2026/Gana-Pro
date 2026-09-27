import { google } from 'googleapis';
import type { User } from './types';
import { toZonedIso } from './datetime';
import fs from 'node:fs';
import path from 'node:path';

export function getEnvValue(key: string): string | undefined {
	if (process.env[key]) return process.env[key];
	try {
		const envPath = path.resolve(process.cwd(), '.env');
		if (fs.existsSync(envPath)) {
			const content = fs.readFileSync(envPath, 'utf-8');
			const lines = content.split(/\r?\n/);
			for (const line of lines) {
				if (line.startsWith(key + '=')) {
					let val = line.slice(key.length + 1).trim();
					if (val.startsWith('"') && val.endsWith('"')) {
						val = val.slice(1, -1);
					}
					return val;
				}
			}
		}
	} catch {
		// Ignore
	}
	return undefined;
}

const SHEET_ID = getEnvValue('GOOGLE_SHEET_ID') || '15I3EAN5rcdG034Mu4mT6uuF6bolzCxQd-FKW9oiDyJo';
const SHEET_TAB = getEnvValue('GOOGLE_SHEET_TAB') || 'Usuarios';
const SERVICE_ACCOUNT_EMAIL = getEnvValue('GOOGLE_SERVICE_ACCOUNT_EMAIL');
const PRIVATE_KEY = getEnvValue('GOOGLE_PRIVATE_KEY')?.replace(/\\n/g, '\n');

/** Scope necesario solo para Google Sheets. */
export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';

export function getSheetsClient() {
	if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
		throw new Error('Las credenciales de Google Service Account no están configuradas.');
	}

	const auth = new google.auth.JWT({
		email: SERVICE_ACCOUNT_EMAIL,
		key: PRIVATE_KEY,
		scopes: [SHEETS_SCOPE],
	});

	return google.sheets({ version: 'v4', auth });
}


function normalizeHeader(header: string): string {
	return header
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

/**
 * Obtiene todos los usuarios desde Google Sheets.
 */
export async function getGoogleSheetUsers(): Promise<User[]> {
	try {
		const sheets = getSheetsClient();
		const response = await sheets.spreadsheets.values.get({
			spreadsheetId: SHEET_ID,
			range: `${SHEET_TAB}!A1:Z5000`,
		});

		const rows = response.data.values || [];
		if (rows.length === 0) return [];

		// Encontrar la fila de encabezados
		let headerRowIndex = -1;
		for (let i = 0; i < rows.length; i++) {
			const normalizedRow = rows[i].map((c: any) => normalizeHeader(String(c)));
			if (normalizedRow.includes('usuario') && (normalizedRow.includes('contrasena') || normalizedRow.includes('email'))) {
				headerRowIndex = i;
				break;
			}
		}

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
		const idxId = headers.indexOf('id');
		const idxFecha = headers.findIndex(h => h.includes('fecha'));
		const idxRol = headers.indexOf('rol');
		const idxTipoDoc = headers.findIndex(h => h.includes('tipo') && h.includes('doc'));
		const idxNumDoc = headers.findIndex(h => (h.includes('numero') || h.includes('num')) && h.includes('doc'));
		const idxUser = headers.indexOf('usuario');
		const idxEmail = headers.indexOf('email');
		const idxPass = headers.findIndex(h => h.includes('contrase'));
		const idxMetodoPago = headers.findIndex(h => h.includes('pago'));
		const idxWallet = headers.findIndex(h => h.includes('billetera'));
		const idxSaldo = headers.findIndex(h => h.includes('saldo'));
		const idxLevel = headers.indexOf('level');
		const idxRefCode = headers.findIndex(h => h.includes('referido'));
		const idxOwnCode = headers.findIndex(h => h.includes('propio'));
		const idxEstadoDoc = headers.findIndex(h => h.includes('estado') && h.includes('doc'));
		const idxLinkDoc = headers.findIndex(h => h.includes('enlace') && h.includes('doc'));
		const idxEscaneadoDoc = headers.findIndex(h => h.includes('escaneado'));

		const users: User[] = [];
		for (let i = headerRowIndex + 1; i < rows.length; i++) {
			const row = rows[i];
			if (!row || row.length === 0) continue;

			const username = idxUser !== -1 ? String(row[idxUser] || '').trim() : '';
			const email = idxEmail !== -1 ? String(row[idxEmail] || '').trim() : '';
			const password = idxPass !== -1 ? String(row[idxPass] || '').trim() : '';

			if (!username && !email) continue;

			users.push({
				id: idxId !== -1 ? row[idxId] : '',
				registeredAt: idxFecha !== -1 ? row[idxFecha] : '',
				role: idxRol !== -1 ? row[idxRol] : 'User',
				documentType: idxTipoDoc !== -1 ? row[idxTipoDoc] : '',
				documentNumber: idxNumDoc !== -1 ? row[idxNumDoc] : '',
				username,
				email,
				password,
				paymentMethod: idxMetodoPago !== -1 ? row[idxMetodoPago] : '',
				walletNumber: idxWallet !== -1 ? row[idxWallet] : '',
				balance: idxSaldo !== -1 ? row[idxSaldo] : '$0',
				level: idxLevel !== -1 ? row[idxLevel] : '1',
				referralCode: idxRefCode !== -1 ? row[idxRefCode] : '',
				ownCode: idxOwnCode !== -1 ? row[idxOwnCode] : '',
				documentStatus: idxEstadoDoc !== -1 ? row[idxEstadoDoc] : '',
				documentLink: idxLinkDoc !== -1 ? row[idxLinkDoc] : '',
				scannedDocument: idxEscaneadoDoc !== -1 ? row[idxEscaneadoDoc] : '',
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
 */
export async function appendGoogleSheetUser(user: {
	username: string;
	email: string;
	passwordHash: string;
	/** Código de quien lo refiere (columna "Código Referido"). */
	referralCode?: string;
}): Promise<void> {
	const sheets = getSheetsClient();

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

	// ISO 8601 con desfase: evita el desfase de 5 h del servidor (UTC)
	const formattedDate = toZonedIso();

	const newRow = [
		String(nextId),        // ID
		formattedDate,         // Fecha de Registro
		'User',                // Rol
		'',                    // Tipo Documento
		'',                    // Número Documento
		user.username,         // Usuario
		user.email,            // Email
		user.passwordHash,     // Contraseña
		'',                    // Método de Pago
		'',                    // Número de Billetera
		' $0',                 // Saldo Acumulado
		'1',                   // Level
		user.referralCode || '', // Código Referido
		user.username,         // Código Propio
		'Pendiente',           // Estado Documento
		'',                    // Enlace Documento
		'',                    // Documento Escaneado
	];

	await sheets.spreadsheets.values.append({
		spreadsheetId: SHEET_ID,
		range: `${SHEET_TAB}!A:Q`,
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
}

/**
 * Actualiza las columnas de documento de un usuario (estado, enlace y nombre
 * del archivo). Devuelve `true` si encontró y actualizó la fila.
 */
export async function updateSheetUserDocument(
	username: string,
	fields: UserDocumentFields
): Promise<boolean> {
	const sheets = getSheetsClient();

	const res = await sheets.spreadsheets.values.get({
		spreadsheetId: SHEET_ID,
		range: `${SHEET_TAB}!A1:Z2000`,
	});
	const rows = res.data.values || [];
	if (rows.length === 0) return false;

	// En esta hoja la fila 1 suele estar vacía: los encabezados no siempre
	// están en la primera fila, se localizan por contenido.
	let headerRow = -1;
	for (let i = 0; i < rows.length; i++) {
		const normalized = rows[i].map((c: unknown) => normalizeHeader(String(c)));
		if (normalized.includes('usuario') && (normalized.includes('contras') || normalized.includes('email'))) {
			headerRow = i;
			break;
		}
	}
	if (headerRow === -1) return false;

	const headers = rows[headerRow].map((h: unknown) => normalizeHeader(String(h)));
	const idxUser = headers.indexOf('usuario');
	const idxType = headers.findIndex((h) => h.includes('tipo') && h.includes('doc'));
	const idxNumber = headers.findIndex(
		(h) => (h.includes('numero') || h.includes('num')) && h.includes('doc')
	);
	const idxStatus = headers.findIndex((h) => h.includes('estado') && h.includes('doc'));
	const idxLink = headers.findIndex((h) => h.includes('enlace') && h.includes('doc'));
	const idxScanned = headers.findIndex((h) => h.includes('escaneado'));

	if (idxUser === -1) return false;

	const target = String(username || '').trim().toLowerCase();
	const rowIndex = rows.findIndex(
		(row, i) => i > headerRow && String(row?.[idxUser] || '').trim().toLowerCase() === target
	);
	if (rowIndex === -1) return false;

	// Se escribe cada columna por separado: así no depende de que existan todas
	const updates: { col: number; value: string }[] = [];
	if (fields.documentType !== undefined && idxType !== -1)
		updates.push({ col: idxType, value: fields.documentType });
	if (fields.documentNumber !== undefined && idxNumber !== -1)
		updates.push({ col: idxNumber, value: fields.documentNumber });
	if (fields.documentStatus !== undefined && idxStatus !== -1)
		updates.push({ col: idxStatus, value: fields.documentStatus });
	if (fields.documentLink !== undefined && idxLink !== -1)
		updates.push({ col: idxLink, value: fields.documentLink });
	if (fields.scannedDocument !== undefined && idxScanned !== -1)
		updates.push({ col: idxScanned, value: fields.scannedDocument });

	for (const u of updates) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SHEET_ID,
			range: `${SHEET_TAB}!${columnLetter(u.col)}${rowIndex + 1}`,
			valueInputOption: 'RAW',
			requestBody: { values: [[u.value]] },
		});
	}

	return updates.length > 0;
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
