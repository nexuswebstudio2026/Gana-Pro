import { getSheetsClient, SPREADSHEET_ID } from './sheets';
import { toZonedIso } from './datetime';

const AUDIT_TAB = 'AuditoriaAdmin';
const EXPENSE_TAB = 'GastosAdmin';
const auditHeaders = ['ID', 'FECHA', 'ADMIN', 'ACCION', 'ENTIDAD', 'REFERENCIA', 'DETALLE'];
const expenseHeaders = ['ID', 'FECHA', 'CATEGORIA', 'DESCRIPCION', 'MONTO', 'ADMIN'];

async function ensureTab(tab: string, headers: string[]): Promise<void> {
	const sheets = getSheetsClient();
	const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
	if (!meta.data.sheets?.some((sheet) => sheet.properties?.title === tab)) {
		await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: tab } } }] } });
	}
	const current = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${tab}!A1:${String.fromCharCode(64 + headers.length)}1` });
	if (!current.data.values?.[0]?.some(Boolean)) {
		await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${tab}!A1:${String.fromCharCode(64 + headers.length)}1`, valueInputOption: 'RAW', requestBody: { values: [headers] } });
	}
}

async function appendRecord(tab: string, headers: string[], values: string[]): Promise<void> {
	await ensureTab(tab, headers);
	await getSheetsClient().spreadsheets.values.append({ spreadsheetId: SPREADSHEET_ID, range: `${tab}!A:${String.fromCharCode(64 + headers.length)}`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', requestBody: { values: [values] } });
}

export interface AdminAuditRecord { id: string; date: string; admin: string; action: string; entity: string; reference: string; detail: string; }
export async function recordAdminAudit(input: Omit<AdminAuditRecord, 'id' | 'date'>): Promise<void> {
	const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
	await appendRecord(AUDIT_TAB, auditHeaders, [id, toZonedIso(), input.admin, input.action, input.entity, input.reference, input.detail.slice(0, 500)]);
}
/** Audit persistence must never make an already-completed money operation look failed. */
export async function safeRecordAdminAudit(input: Omit<AdminAuditRecord, 'id' | 'date'>): Promise<void> {
	try { await recordAdminAudit(input); } catch (error) { console.error('No se pudo guardar la auditoría administrativa:', error); }
}
export async function listAdminAudit(): Promise<AdminAuditRecord[]> {
	await ensureTab(AUDIT_TAB, auditHeaders);
	const res = await getSheetsClient().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${AUDIT_TAB}!A2:G5000` });
	return (res.data.values || []).filter((r) => r[0]).map((r) => ({ id: String(r[0] || ''), date: String(r[1] || ''), admin: String(r[2] || ''), action: String(r[3] || ''), entity: String(r[4] || ''), reference: String(r[5] || ''), detail: String(r[6] || '') })).reverse();
}

export interface AdminExpense { id: string; date: string; category: string; description: string; amount: number; admin: string; }
export async function listAdminExpenses(): Promise<AdminExpense[]> {
	await ensureTab(EXPENSE_TAB, expenseHeaders);
	const res = await getSheetsClient().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${EXPENSE_TAB}!A2:F5000` });
	return (res.data.values || []).filter((r) => r[0]).map((r) => ({ id: String(r[0] || ''), date: String(r[1] || ''), category: String(r[2] || ''), description: String(r[3] || ''), amount: Number(String(r[4] || '0').replace(',', '.')) || 0, admin: String(r[5] || '') })).reverse();
}
export async function createAdminExpense(input: Omit<AdminExpense, 'id' | 'date'>): Promise<AdminExpense> {
	const expense = { ...input, id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, date: toZonedIso() };
	await appendRecord(EXPENSE_TAB, expenseHeaders, [expense.id, expense.date, expense.category, expense.description, String(expense.amount), expense.admin]);
	return expense;
}
