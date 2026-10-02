/**
 * Registro de comisiones de referido.
 *
 * La comisión se acredita al SALDO de quien trae el alta, no al del referido:
 * quien capta es quien gana. Son dos pagos independientes de $1.000: uno
 * cuando se aprueba el registro y otro cuando el referido hace su primera
 * recarga aprobada.
 * Cada pago queda anotado en la pestaña `Comisiones`. Esa fila es además la
 * que evita el doble pago: antes de acreditar se comprueba que no exista ya un
 * pago con el mismo (referido, concepto), de modo que repetir la operación sea
 * inocuo aunque la lógica de estados cambie.
 */
import {
	getSheetsClient,
	SPREADSHEET_ID,
	setSheetUserBalance,
	parseSheetBalance,
} from './sheets';
import { getUserBalance } from './users';
import { toZonedIso } from './datetime';
import { COMMISSION_PER_REFERRAL, findReferrerByCode, ownCodeOf } from './referrals';
import { listTopups, TOPUP_STATUS } from './topups';
import type { User } from './types';

/** Pestaña donde queda la trazabilidad de las comisiones pagadas. */
export const COMMISSIONS_TAB = 'Comisiones';

/** Los dos momentos en los que se paga. */
export const COMMISSION_CONCEPT = {
	registro: 'Registro aprobado',
	primeraRecarga: 'Primera recarga',
} as const;

export type CommissionConcept = (typeof COMMISSION_CONCEPT)[keyof typeof COMMISSION_CONCEPT];

const HEADERS = ['FECHA', 'REFERENTE', 'REFERIDO', 'CONCEPTO', 'MONTO'] as const;
const RANGE = `${COMMISSIONS_TAB}!A1:E1000`;

function normalizeHeader(value: unknown): string {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

async function ensureTab(): Promise<string[]> {
	const sheets = getSheetsClient();
	const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
	const exists = meta.data.sheets?.some((s) => s.properties?.title === COMMISSIONS_TAB);

	if (!exists) {
		await sheets.spreadsheets.batchUpdate({
			spreadsheetId: SPREADSHEET_ID,
			requestBody: { requests: [{ addSheet: { properties: { title: COMMISSIONS_TAB } } }] },
		});
	}

	const res = await sheets.spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: RANGE,
	});
	const rows = (res.data.values || []).map((row) => row.map((c) => String(c ?? '')));

	const needsHeaders =
		rows.length === 0 || rows[0].every((c) => !c.trim());
	if (needsHeaders) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${COMMISSIONS_TAB}!A1:E1`,
			valueInputOption: 'RAW',
			requestBody: { values: [[...HEADERS]] },
		});
		return [...HEADERS];
	}

	// Esquema distinto (por ejemplo una hoja creada a mano): se reescribe solo
	// la fila de encabezados y los datos de abajo se conservan.
	const current = rows[0].map(normalizeHeader);
	if (current.length !== HEADERS.length || current.some((h, i) => h !== HEADERS[i])) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${COMMISSIONS_TAB}!A1:E1`,
			valueInputOption: 'RAW',
			requestBody: { values: [[...HEADERS]] },
		});
		return [...HEADERS];
	}

	return current;
}

/** Pares (referido, concepto) de los pagos ya registrados. */
async function paidPairs(headers: string[]): Promise<Set<string>> {
	const res = await getSheetsClient().spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: RANGE,
	});
	const rows = (res.data.values || []).slice(1);
	const referredAt = headers.indexOf('referido');
	const conceptAt = headers.indexOf('concepto');
	const paid = new Set<string>();
	for (const row of rows) {
		const referred = normalizeHeader(row?.[referredAt]);
		const concept = normalizeHeader(row?.[conceptAt]);
		if (referred && concept) paid.add(`${referred}|${concept}`);
	}
	return paid;
}

export interface CommissionResult {
	/** `true` solo cuando el saldo se movió en esta llamada. */
	credited: boolean;
	/** Nombre de quien recibió la comisión, si se identificó. */
	referrer: string;
	amount: number;
	/** Motivo legible para el log o el mensaje al admin. */
	reason: string;
}

const NOTHING: CommissionResult = { credited: false, referrer: '', amount: 0, reason: '' };

/**
 * Acredita $1.000 al referente si este pago todavía no se hizo.
 * Si el referido no tiene código de referido válido, no ocurre nada.
 */
async function credit(referred: User, concept: CommissionConcept): Promise<CommissionResult> {
	const referredName = String(referred.username || '').trim();
	const code = String(referred.referralCode || '').trim();
	if (!referredName || !code) {
		return { ...NOTHING, reason: 'El usuario no tiene código de referido.' };
	}

	const referrer = await findReferrerByCode(code);
	if (!referrer) {
		return { ...NOTHING, reason: `No se encontró al referente del código ${code}.` };
	}

	const referrerName = ownCodeOf(referrer) || String(referrer.username || '').trim();
	// Defensa extra: nadie se paga a sí mismo aunque la hoja esté inconsistente.
	if (normalizeHeader(referrerName) === normalizeHeader(referredName)) {
		return { ...NOTHING, reason: 'El referente y el referido son el mismo usuario.' };
	}

	const headers = await ensureTab();
	const paid = await paidPairs(headers);
	const key = `${normalizeHeader(referredName)}|${normalizeHeader(concept)}`;
	if (paid.has(key)) {
		return {
			credited: false,
			referrer: referrerName,
			amount: 0,
			reason: 'Esta comisión ya estaba pagada.',
		};
	}

	const current = parseSheetBalance(await getUserBalance(referrerName, String(referrer.email || '')));
	const next = current + COMMISSION_PER_REFERRAL;
	if (!(await setSheetUserBalance(referrerName, next))) {
		return {
			credited: false,
			referrer: referrerName,
			amount: 0,
			reason: 'No se encontró la fila del referente en Google Sheets.',
		};
	}

	await getSheetsClient().spreadsheets.values.append({
		spreadsheetId: SPREADSHEET_ID,
		range: `${COMMISSIONS_TAB}!A:E`,
		valueInputOption: 'RAW',
		insertDataOption: 'INSERT_ROWS',
		requestBody: {
			values: [
				[
					toZonedIso(),
					referrerName,
					referredName,
					concept,
					String(COMMISSION_PER_REFERRAL),
				],
			],
		},
	});

	return {
		credited: true,
		referrer: referrerName,
		amount: COMMISSION_PER_REFERRAL,
		reason: `Comisión de ${concept} pagada.`,
	};
}

/** Comisión por aprobarse el registro del referido. */
export function creditOnRegistrationApproved(referred: User): Promise<CommissionResult> {
	return credit(referred, COMMISSION_CONCEPT.registro);
}

/**
 * Comisión por la primera recarga aprobada del referido.
 *
 * Solo paga la primera: si el referido ya tenía otra recarga aprobada, esta
 * comisión ya se pagó antes y no se acredita nada.
 */
export async function creditOnFirstTopupApproved(
	referred: User,
	currentTopupId: string
): Promise<CommissionResult> {
	const referredName = String(referred.username || '').trim();
	const approved = (await listTopups(TOPUP_STATUS.aprobado)).filter(
		(t) => t.username.trim().toLowerCase() === referredName.toLowerCase()
	);
	const otherApproved = approved.filter((t) => t.id !== String(currentTopupId).trim());
	if (otherApproved.length > 0) {
		return { ...NOTHING, reason: 'El referido ya tenía una recarga aprobada.' };
	}
	return credit(referred, COMMISSION_CONCEPT.primeraRecarga);
}