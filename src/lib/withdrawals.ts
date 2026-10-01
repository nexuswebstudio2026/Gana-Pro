import { getSheetsClient, SPREADSHEET_ID } from './sheets';
import { toZonedIso } from './datetime';

/** Pestaña donde se registran las solicitudes de retiro. */
export const WITHDRAWALS_TAB = 'Retiros';

/** Estados posibles de una solicitud. */
export const WITHDRAWAL_STATUS = {
	pendiente: 'Pendiente',
	aprobado: 'Aprobado',
	rechazado: 'Rechazado',
} as const;

export type WithdrawalStatus = (typeof WITHDRAWAL_STATUS)[keyof typeof WITHDRAWAL_STATUS];

/**
 * Comisión que el administrador cobra sobre cada retiro aprobado.
 *
 * El usuario elige el monto que quiere sacar; sobre ese monto se aplica este
 * porcentaje. Si pide $100 se le descuentan $100 del saldo y se le abonan
 * $95, y los $5 restantes son ganancia del administrador.
 */
export const ADMIN_COMMISSION_RATE = 0.05;

/** Comisión que corresponde a un retiro concreto. */
export function adminCommission(amount: number): number {
	return Math.round(amount * ADMIN_COMMISSION_RATE);
}

/** Neto que recibe el usuario tras la comisión. */
export function netAmount(amount: number): number {
	return Math.round(amount - adminCommission(amount));
}

const HEADERS = [
	'ID',
	'FECHA',
	'USUARIO',
	'EMAIL',
	'MONTO',
	'COMISION',
	'NETO_A_PAGAR',
	'METODO_PAGO',
	'NUMERO_BILLETERA',
	'NIVEL',
	'ESTADO',
	'ADMIN_NOTAS',
] as const;

const RANGE = `${WITHDRAWALS_TAB}!A1:L1000`;
export interface WithdrawalRequest {
	id: string;
	createdAt: string;
	username: string;
	email: string;
	/** Monto que el usuario eligió solicitar. */
	amount: number;
	/** Comisión retenida por el administrador (5 %). */
	commission: number;
	/** Neto que el administrador debe pagar al usuario. */
	netAmount: number;
	/** Tipo de billetera registrado en la hoja de usuarios (Nequi, Daviplata...). */
	walletType: string;
	/** Número de billetera asociado. */
	walletNumber: string;
	level: string;
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

/** Convierte una columna (0-based) en letra: 0 -> A, 9 -> J. */
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
 * Asegura que exista la pestaña de retiros con sus encabezados.
 *
 * Se llama antes de leer o escribir: si el administrador la borró o la hoja es
 * nueva, se vuelve a crear en lugar de fallar.
 */
async function ensureTab(): Promise<string[]> {
	const sheets = getSheetsClient();
	const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
	const exists = meta.data.sheets?.some((s) => s.properties?.title === WITHDRAWALS_TAB);

	if (!exists) {
		await sheets.spreadsheets.batchUpdate({
			spreadsheetId: SPREADSHEET_ID,
			requestBody: {
				requests: [{ addSheet: { properties: { title: WITHDRAWALS_TAB } } }],
			},
		});
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${WITHDRAWALS_TAB}!A1:L1`,
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

	// Pestaña recién creada o vacía: se escriben los encabezados.
	if (rows.length === 0 || rows[0].every((c) => !c.trim())) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${WITHDRAWALS_TAB}!A1:L1`,
			valueInputOption: 'RAW',
			requestBody: { values: [[...HEADERS]] },
		});
		return [...HEADERS];
	}

	return rows[0].map(normalizeHeader);
}

function toAmount(raw: string): number {
	// El monto se guarda con punto decimal; se acepta cualquier formato.
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

/** Lista las solicitudes de retiro. Sin `status`, devuelve todas. */
export async function listWithdrawals(status?: string): Promise<WithdrawalRequest[]> {
	const headers = await ensureTab();
	const res = await getSheetsClient().spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: RANGE,
	});
	const rows = (res.data.values || []).slice(1);

	const list: WithdrawalRequest[] = [];
	for (const row of rows) {
		if (!row || row.length === 0) continue;

		const amount = toAmount(row[at(headers, 'monto')] ?? '');
		// La comisión se calcula siempre aquí: si la fila es antigua y no tiene
		// las columnas, el cálculo sigue siendo correcto.
		const commission = toAmount(row[at(headers, 'comision')] ?? '') || adminCommission(amount);
		const net = toAmount(row[at(headers, 'neto_a_pagar')] ?? '') || netAmount(amount);

		const item: WithdrawalRequest = {
			id: row[at(headers, 'id')] ?? '',
			createdAt: row[at(headers, 'fecha')] ?? '',
			username: row[at(headers, 'usuario')] ?? '',
			email: row[at(headers, 'email')] ?? '',
			amount,
			commission,
			netAmount: net,
			walletType: row[at(headers, 'metodo_pago')] ?? '',
			walletNumber: row[at(headers, 'numero_billetera')] ?? '',
			level: row[at(headers, 'nivel')] ?? '',
			status: row[at(headers, 'estado')] ?? WITHDRAWAL_STATUS.pendiente,
			adminNotes: row[at(headers, 'admin_notas')] ?? '',
		};

		if (!item.username) continue;
		if (status && item.status !== status) continue;
		list.push(item);
	}

	// Más recientes primero.
	return list.reverse();
}

/** Registra una solicitud de retiro pendiente de aprobación. */
export async function createWithdrawal(
	data: Omit<WithdrawalRequest, 'id' | 'createdAt' | 'status' | 'adminNotes'>
): Promise<WithdrawalRequest> {
	const headers = await ensureTab();
	const sheets = getSheetsClient();

	const res = await sheets.spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: RANGE,
	});
	const rows = (res.data.values || []).slice(1);

	// El ID es consecutivo: se toma el mayor existente + 1.
	const nextId =
		rows.reduce((max, row) => {
			const n = parseInt(String(row?.[at(headers, 'id')] ?? '0'), 10);
			return !Number.isNaN(n) && n > max ? n : max;
		}, 0) + 1;

	const request: WithdrawalRequest = {
		...data,
		id: String(nextId),
		createdAt: toZonedIso(),
		status: WITHDRAWAL_STATUS.pendiente,
		adminNotes: '',
	};

	// Se escribe por encabezado, no por posición: si el administrador reordena
	// columnas, cada valor sigue cayendo en su sitio.
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
			case 'COMISION':
				return String(request.commission);
			case 'NETO_A_PAGAR':
				return String(request.netAmount);
			case 'METODO_PAGO':
				return request.walletType;
			case 'NUMERO_BILLETERA':
				return request.walletNumber;
			case 'NIVEL':
				return request.level;
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
		range: `${WITHDRAWALS_TAB}!A:L`,
		valueInputOption: 'RAW',
		insertDataOption: 'INSERT_ROWS',
		requestBody: { values: [HEADERS.map(pick)] },
	});

	return request;
}

/** Localiza el número de fila (1-based, como lo usa la API) de una solicitud. */
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
 * Aprueba o rechaza una solicitud.
 *
 * Solo cambia el estado: **no mueve dinero**. El saldo lo descuenta el endpoint
 * del admin al aprobar, de modo que la decisión y el movimiento quedan
 * registrados en el mismo paso.
 */
export async function setWithdrawalStatus(
	id: string,
	status: WithdrawalStatus,
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
		range: `${WITHDRAWALS_TAB}!${columnLetter(from)}${rowNumber}:${columnLetter(to)}${rowNumber}`,
		valueInputOption: 'RAW',
		requestBody: { values: [next.slice(from, to + 1)] },
	});

	return true;
}
