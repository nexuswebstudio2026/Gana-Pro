import { getSheetsClient, SPREADSHEET_ID } from './sheets';
import { toZonedIso } from './datetime';

/** Pestaña donde se registran las solicitudes de recarga. */
export const TOPUPS_TAB = 'Recargas';

/** Estados posibles de una solicitud. */
export const TOPUP_STATUS = {
	pendiente: 'Pendiente',
	aprobado: 'Aprobado',
	rechazado: 'Rechazado',
} as const;

export type TopupStatus = (typeof TOPUP_STATUS)[keyof typeof TOPUP_STATUS];

const HEADERS = [
	'ID',
	'FECHA',
	'USUARIO',
	'EMAIL',
	'MONTO',
	'COMPROBANTE_URL',
	'ARCHIVO',
	'ESTADO',
	'ADMIN_NOTAS',
] as const;

const RANGE = `${TOPUPS_TAB}!A1:I1000`;

export interface TopupRequest {
	id: string;
	createdAt: string;
	username: string;
	email: string;
	/** Monto que el usuario indicó en el formulario. */
	amount: number;
	/** Enlace al comprobante que adjuntó, para que el admin lo compare. */
	receiptUrl: string;
	receiptName: string;
	status: string;
	adminNotes: string;
}

function normalizeHeader(value: unknown): string {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

const at = (headers: string[], name: string) => headers.indexOf(name);

function toAmount(raw: string): number {
	const cleaned = String(raw ?? '').replace(/[^\d.,-]/g, '');
	if (!cleaned) return 0;
	const lastComma = cleaned.lastIndexOf(',');
	const lastDot = cleaned.lastIndexOf('.');
	const normalized =
		lastComma > -1 && lastComma > lastDot
			? cleaned.replace(/\./g, '').replace(',', '.')
			: cleaned.replace(/[.,](?=\d{3}\b)/g, '');
	const value = Number(normalized);
	return Number.isFinite(value) ? value : 0;
}

function columnLetter(index: number): string {
	let letter = '';
	let n = index;
	do {
		letter = String.fromCharCode(65 + (n % 26)) + letter;
		n = Math.floor(n / 26) - 1;
	} while (n >= 0);
	return letter;
}

/**
 * Asegura que la pestaña exista y tenga los encabezados esperados.
 *
 * Si la hoja ya existe con el esquema anterior (10 columnas que incluían
 * `MONTOS_LEIDOS`), se reescribe la fila de encabezados con el esquema actual
 * para que las lecturas por nombre de columna sigan siendo correctas.
 */
async function ensureTab(): Promise<string[]> {
	const sheets = getSheetsClient();
	const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
	const exists = meta.data.sheets?.some((s) => s.properties?.title === TOPUPS_TAB);

	if (!exists) {
		await sheets.spreadsheets.batchUpdate({
			spreadsheetId: SPREADSHEET_ID,
			requestBody: { requests: [{ addSheet: { properties: { title: TOPUPS_TAB } } }] },
		});
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${TOPUPS_TAB}!A1:I1`,
			valueInputOption: 'RAW',
			requestBody: { values: [[...HEADERS]] },
		});
		return [...HEADERS];
	}

	const res = await sheets.spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: RANGE,
	});
	const rows = (res.data.values || []).map((row) => row.map((c) => String(c ?? '')));

	if (rows.length === 0 || rows[0].every((c) => !c.trim())) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${TOPUPS_TAB}!A1:I1`,
			valueInputOption: 'RAW',
			requestBody: { values: [[...HEADERS]] },
		});
		return [...HEADERS];
	}

	const current = rows[0].map(normalizeHeader);

	// Migración del esquema antiguo: se reescriben solo los encabezados. Los
	// datos de las filas siguientes se conservan; las columnas que ya no se
	// usan simplemente se ignoran al leer por nombre.
	if (current.length !== HEADERS.length || current.some((h, i) => h !== HEADERS[i])) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${TOPUPS_TAB}!A1:I1`,
			valueInputOption: 'RAW',
			requestBody: { values: [[...HEADERS]] },
		});
		return [...HEADERS];
	}

	return current;
}

/** Lista las solicitudes de recarga. Sin `status`, devuelve todas. */
export async function listTopups(status?: string): Promise<TopupRequest[]> {
	const headers = await ensureTab();
	const res = await getSheetsClient().spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: RANGE,
	});
	const rows = (res.data.values || []).slice(1);

	const list: TopupRequest[] = [];
	for (const row of rows) {
		if (!row || row.length === 0) continue;

		const item: TopupRequest = {
			id: row[at(headers, 'id')] ?? '',
			createdAt: row[at(headers, 'fecha')] ?? '',
			username: row[at(headers, 'usuario')] ?? '',
			email: row[at(headers, 'email')] ?? '',
			amount: toAmount(row[at(headers, 'monto')] ?? ''),
			receiptUrl: row[at(headers, 'comprobante_url')] ?? '',
			receiptName: row[at(headers, 'archivo')] ?? '',
			status: row[at(headers, 'estado')] ?? TOPUP_STATUS.pendiente,
			adminNotes: row[at(headers, 'admin_notas')] ?? '',
		};

		if (!item.username) continue;
		if (status && item.status !== status) continue;
		list.push(item);
	}

	// Más recientes primero.
	return list.reverse();
}

/** Registra una solicitud de recarga pendiente de aprobación. */
export async function createTopup(
	data: Omit<TopupRequest, 'id' | 'createdAt' | 'status' | 'adminNotes'>
): Promise<TopupRequest> {
	const headers = await ensureTab();
	const sheets = getSheetsClient();

	const res = await sheets.spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: RANGE,
	});
	const rows = (res.data.values || []).slice(1);

	const nextId =
		rows.reduce((max, row) => {
			const n = parseInt(String(row?.[at(headers, 'id')] ?? '0'), 10);
			return !Number.isNaN(n) && n > max ? n : max;
		}, 0) + 1;

	const request: TopupRequest = {
		...data,
		id: String(nextId),
		createdAt: toZonedIso(),
		status: TOPUP_STATUS.pendiente,
		adminNotes: '',
	};

	// Se escribe por encabezado para no depender del orden de columnas.
	const pick = (column: string): string => {
		switch (column) {
			case 'ID':
				return request.id;
			case 'FECHA':
				return request.createdAt;
			case 'USUARIO':
				return request.username;
			case 'EMAIL':
				return request.email;
			case 'MONTO':
				return String(request.amount);
			case 'COMPROBANTE_URL':
				return request.receiptUrl;
			case 'ARCHIVO':
				return request.receiptName;
			case 'ESTADO':
				return request.status;
			case 'ADMIN_NOTAS':
				return request.adminNotes;
			default:
				return '';
		}
	};

	await sheets.spreadsheets.values.append({
		spreadsheetId: SPREADSHEET_ID,
		range: `${TOPUPS_TAB}!A:I`,
		valueInputOption: 'RAW',
		insertDataOption: 'INSERT_ROWS',
		requestBody: { values: [HEADERS.map(pick)] },
	});

	return request;
}

async function findRowNumber(id: string): Promise<number | null> {
	const headers = await ensureTab();
	const res = await getSheetsClient().spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: RANGE,
	});
	const rows = res.data.values || [];
	const idCol = at(headers, 'id');
	for (let i = 1; i < rows.length; i++) {
		if (String(rows[i]?.[idCol] ?? '').trim() === String(id).trim()) return i + 1;
	}
	return null;
}

/**
 * Aprueba o rechaza una solicitud de recarga.
 *
 * No mueve dinero: el saldo lo acredita el endpoint del admin al aprobar, de
 * modo que la decisión y el movimiento quedan en el mismo paso.
 */
export async function setTopupStatus(
	id: string,
	status: TopupStatus,
	adminNotes = ''
): Promise<boolean> {
	const headers = await ensureTab();
	const rowNumber = await findRowNumber(id);
	if (rowNumber === null) return false;

	const stateCol = at(headers, 'estado');
	const notesCol = at(headers, 'admin_notas');
	if (stateCol === -1) return false;

	const res = await getSheetsClient().spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: RANGE,
	});
	const current = (res.data.values || [])[rowNumber - 1] || [];
	const next = [...current];
	while (next.length < HEADERS.length) next.push('');

	next[stateCol] = status;
	if (notesCol !== -1) next[notesCol] = adminNotes;

	const from = notesCol === -1 ? stateCol : Math.min(stateCol, notesCol);
	const to = notesCol === -1 ? stateCol : Math.max(stateCol, notesCol);

	await getSheetsClient().spreadsheets.values.update({
		spreadsheetId: SPREADSHEET_ID,
		range: `${TOPUPS_TAB}!${columnLetter(from)}${rowNumber}:${columnLetter(to)}${rowNumber}`,
		valueInputOption: 'RAW',
		requestBody: { values: [next.slice(from, to + 1)] },
	});

	return true;
}
