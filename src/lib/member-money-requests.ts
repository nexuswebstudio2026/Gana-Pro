import { getSheetsClient, SPREADSHEET_ID } from './sheets';
import { toZonedIso } from './datetime';

export const MONEY_REQUESTS_TAB = 'SolicitudesDinero';
const HEADERS = ['ID', 'FECHA', 'SOLICITA', 'DESTINATARIO', 'MONTO', 'ESTADO'] as const;
const RANGE = `${MONEY_REQUESTS_TAB}!A1:F2000`;

export interface MemberMoneyRequest {
	id: string;
	createdAt: string;
	requester: string;
	recipient: string;
	amount: number;
	status: string;
}

async function ensureTab() {
	const sheets = getSheetsClient();
	const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
	if (!meta.data.sheets?.some((sheet) => sheet.properties?.title === MONEY_REQUESTS_TAB)) {
		await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: MONEY_REQUESTS_TAB } } }] } });
		await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${MONEY_REQUESTS_TAB}!A1:F1`, valueInputOption: 'RAW', requestBody: { values: [[...HEADERS]] } });
	}
}

export async function listMemberMoneyRequests(username: string): Promise<MemberMoneyRequest[]> {
	await ensureTab();
	const response = await getSheetsClient().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
	const target = username.trim().toLowerCase();
	return (response.data.values ?? []).slice(1).map((row) => ({
		id: String(row[0] ?? ''), createdAt: String(row[1] ?? ''), requester: String(row[2] ?? ''),
		recipient: String(row[3] ?? ''), amount: Number(row[4] ?? 0), status: String(row[5] ?? 'Pendiente'),
	})).filter((item) => item.id && (item.requester.toLowerCase() === target || item.recipient.toLowerCase() === target)).reverse();
}

export async function createMemberMoneyRequest(requester: string, recipient: string, amount: number): Promise<MemberMoneyRequest> {
	await ensureTab();
	const sheets = getSheetsClient();
	const existing = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
	const rows = existing.data.values ?? [];
	const id = String(Math.max(0, ...rows.slice(1).map((row) => Number(row[0]) || 0)) + 1);
	const request: MemberMoneyRequest = { id, createdAt: toZonedIso(), requester, recipient, amount, status: 'Pendiente' };
	await sheets.spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: `${MONEY_REQUESTS_TAB}!A:F`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [[id, request.createdAt, requester, recipient, String(amount), request.status]] } });
	return request;
}

export async function updateMemberMoneyRequestStatus(id: string, expected: string, status: string): Promise<boolean> {
	await ensureTab();
	const sheets = getSheetsClient();
	const response = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
	const rows = response.data.values ?? [];
	const rowIndex = rows.findIndex((row, index) => index > 0 && String(row[0]) === id);
	if (rowIndex < 1 || String(rows[rowIndex][5]) !== expected) return false;
	await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${MONEY_REQUESTS_TAB}!F${rowIndex + 1}`, valueInputOption: 'RAW', requestBody: { values: [[status]] } });
	return true;
}
