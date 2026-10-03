/**
 * Persistencia de los pagos entre usuarios (P2P).
 *
 * Sigue el mismo patrón que `topups.ts` y `withdrawals.ts`: una pestaña por
 * módulo, encabezados fijos y escritura **por nombre de columna**, para que el
 * administrador pueda reordenar la hoja sin romper la lectura.
 *
 * Importa `p2p.ts` (las reglas) y nunca al revés: las reglas se prueban sin
 * necesidad de credenciales de Google.
 */
import { getSheetsClient, SPREADSHEET_ID } from './sheets';
import { toZonedIso } from './datetime';
import { P2P_STATUS, type P2PConcept } from './p2p';

/** Pestaña donde se registran los pagos entre usuarios. */
export const P2P_TAB = 'PagosP2P';

const HEADERS = [
	'ID',
	'FECHA',
	'USUARIO',
	'EMAIL',
	'CONCEPTO',
	'MONTO',
	'COMPROBANTE_URL',
	'ARCHIVO',
	'REFERENCIA',
	'ESTADO',
	'ADMIN_NOTAS',
] as const;

const RANGE = `${P2P_TAB}!A1:K1000`;

export interface P2PPayment {
	id: string;
	createdAt: string;
	username: string;
	email: string;
	concept: P2PConcept;
	amount: number;
	receiptUrl: string;
	receiptName: string;
	/** Número de transacción, si el usuario lo anotó. */
	reference: string;
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
 * Si la hoja se creó a mano con otro esquema, se reescribe solo la fila de
 * encabezados: los datos de abajo se conservan.
 */
async function ensureTab(): Promise<string[]> {
	const sheets = getSheetsClient();
	const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
	const exists = meta.data.sheets?.some((s) => s.properties?.title === P2P_TAB);

	if (!exists) {
		await sheets.spreadsheets.batchUpdate({
			spreadsheetId: SPREADSHEET_ID,
			requestBody: { requests: [{ addSheet: { properties: { title: P2P_TAB } } }] },
		});
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${P2P_TAB}!A1:K1`,
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
	const current = rows[0]?.map(normalizeHeader) ?? [];

	const needsHeaders = rows.length === 0 || rows[0].every((c) => !c.trim());
	const mismatched =
		!needsHeaders &&
		(current.length !== HEADERS.length ||
			current.some((h, i) => h !== normalizeHeader(HEADERS[i])));

	if (needsHeaders || mismatched) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${P2P_TAB}!A1:K1`,
			valueInputOption: 'RAW',
			requestBody: { values: [[...HEADERS]] },
		});
		return [...HEADERS];
	}

	return current;
}


/**
 * Lista los pagos P2P.
 *
 * Con `username` se filtra a los de una persona (es lo que ve el miembro); sin
 * él, salen todos (lo que revisa el administrador). Lo más reciente primero.
 */
export async function listP2PPayments(username?: string): Promise<P2PPayment[]> {
	const headers = await ensureTab();
	const res = await getSheetsClient().spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: RANGE,
	});
	const rows = (res.data.values || []).slice(1);

	const target = String(username ?? '').trim().toLowerCase();
	const list: P2PPayment[] = [];

	for (const row of rows) {
		if (!row || row.length === 0) continue;

		const item: P2PPayment = {
			id: row[at(headers, 'id')] ?? '',
			createdAt: row[at(headers, 'fecha')] ?? '',
			username: row[at(headers, 'usuario')] ?? '',
			email: row[at(headers, 'email')] ?? '',
			concept: row[at(headers, 'concepto')] ?? '',
			amount: toAmount(row[at(headers, 'monto')] ?? ''),
			receiptUrl: row[at(headers, 'comprobante_url')] ?? '',
			receiptName: row[at(headers, 'archivo')] ?? '',
			reference: row[at(headers, 'referencia')] ?? '',
			status: row[at(headers, 'estado')] ?? P2P_STATUS.pendiente,
			adminNotes: row[at(headers, 'admin_notas')] ?? '',
		};

		if (!item.username) continue;
		if (target && item.username.trim().toLowerCase() !== target) continue;
		list.push(item);
	}

	return list.reverse();
}

/** Registra un pago P2P pendiente de aprobación. */
export async function createP2PPayment(
	data: Omit<P2PPayment, 'id' | 'createdAt' | 'status' | 'adminNotes'>
): Promise<P2PPayment> {
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

	const request: P2PPayment = {
		...data,
		id: String(nextId),
		createdAt: toZonedIso(),
		status: P2P_STATUS.pendiente,
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
			case 'CONCEPTO':
				return request.concept;
			case 'MONTO':
				return String(request.amount);
			case 'COMPROBANTE_URL':
				return request.receiptUrl;
			case 'ARCHIVO':
				return request.receiptName;
			case 'REFERENCIA':
				return request.reference;
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
		range: `${P2P_TAB}!A:K`,
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
 * Aprueba o rechaza un pago P2P.
 *
 * Solo cambia el estado: **no mueve dinero**. El saldo lo ajusta el
 * administrador al aprobar, igual que en recargas y retiros.
 */
export async function setP2PPaymentStatus(
	id: string,
	status: string,
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
		range: `${P2P_TAB}!${columnLetter(from)}${rowNumber}:${columnLetter(to)}${rowNumber}`,
		valueInputOption: 'RAW',
		requestBody: { values: [next.slice(from, to + 1)] },
	});

	return true;
}
