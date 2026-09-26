import { google } from 'googleapis';
import type { User } from './types';
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
/** Scope necesario para crear archivos en Google Drive. */
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

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

/**
 * Cliente de Google Drive para subir imágenes de testimonios.
 * Requiere el scope `drive.file` y que la Service Account tenga
 * acceso de editor a la carpeta de destino.
 */
export function getDriveClient() {
	if (!SERVICE_ACCOUNT_EMAIL || !PRIVATE_KEY) {
		throw new Error('Las credenciales de Google Service Account no están configuradas.');
	}

	const auth = new google.auth.JWT({
		email: SERVICE_ACCOUNT_EMAIL,
		key: PRIVATE_KEY,
		scopes: [DRIVE_SCOPE],
	});

	return google.drive({ version: 'v3', auth });
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

	const now = new Date();
	const formattedDate = `${now.toLocaleDateString('es-CO')}, ${now.toLocaleTimeString('es-CO')}`;

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
		'',                    // Código Referido
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
