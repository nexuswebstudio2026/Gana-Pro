import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { getEnvValue, getSheetsClient, SPREADSHEET_ID } from './sheets';
import { toZonedIso } from './datetime';

const TAB = 'CodigosRecuperacion';
const HEADERS = ['ID', 'EMAIL', 'USUARIO', 'CODIGO_HMAC', 'CREADO', 'VENCE_MS', 'INTENTOS', 'ESTADO'];
const RANGE = `${TAB}!A1:H10000`;
const MAX_ATTEMPTS = 5;
const secret = getEnvValue('SESSION_SECRET') || (process.env.NODE_ENV === 'production' || process.env.VERCEL ? '' : randomBytes(32).toString('hex'));

if (!secret) console.error('[password-reset] Define SESSION_SECRET para firmar códigos de recuperación.');

function digest(id: string, code: string): string {
	if (!secret) throw new Error('Falta SESSION_SECRET para proteger códigos de recuperación.');
	return createHmac('sha256', secret).update(`${id}:${code}`).digest('hex');
}

async function ensureTab(): Promise<void> {
	const sheets = getSheetsClient();
	const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
	if (!meta.data.sheets?.some((sheet) => sheet.properties?.title === TAB)) {
		await sheets.spreadsheets.batchUpdate({ spreadsheetId: SPREADSHEET_ID, requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] } });
	}
	const current = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A1:H1` });
	if (!current.data.values?.[0]?.some(Boolean)) {
		await sheets.spreadsheets.values.update({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A1:H1`, valueInputOption: 'RAW', requestBody: { values: [HEADERS] } });
	}
}

export interface PasswordResetChallenge {
	id: string; email: string; username: string; digest: string; createdAt: string;
	expiresAt: number; attempts: number; status: string; rowNumber: number;
}

export async function createPasswordResetChallenge(email: string, username: string, code: string, lifetimeMs: number): Promise<PasswordResetChallenge> {
	await ensureTab();
	const id = randomUUID();
	const createdAt = toZonedIso();
	const expiresAt = Date.now() + lifetimeMs;
	const codeDigest = digest(id, code);
	await getSheetsClient().spreadsheets.values.append({
		spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A:H`, valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS',
		requestBody: { values: [[id, email, username, codeDigest, createdAt, String(expiresAt), '0', 'Pendiente']] },
	});
	return { id, email, username, digest: codeDigest, createdAt, expiresAt, attempts: 0, status: 'Pendiente', rowNumber: -1 };
}

export async function getPasswordResetChallenge(id: string): Promise<PasswordResetChallenge | null> {
	await ensureTab();
	const res = await getSheetsClient().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
	const rows = res.data.values || [];
	for (let i = rows.length - 1; i >= 1; i--) {
		const row = rows[i] || [];
		if (String(row[0] || '') !== id) continue;
		return { id, email: String(row[1] || ''), username: String(row[2] || ''), digest: String(row[3] || ''), createdAt: String(row[4] || ''), expiresAt: Number(row[5] || 0), attempts: Number(row[6] || 0), status: String(row[7] || ''), rowNumber: i + 1 };
	}
	return null;
}

async function writeState(challenge: PasswordResetChallenge, attempts: number, status: string): Promise<void> {
	await getSheetsClient().spreadsheets.values.update({
		spreadsheetId: SPREADSHEET_ID, range: `${TAB}!G${challenge.rowNumber}:H${challenge.rowNumber}`, valueInputOption: 'RAW',
		requestBody: { values: [[String(attempts), status]] },
	});
}

export async function verifyPasswordResetCode(challenge: PasswordResetChallenge, code: string): Promise<'valid'|'invalid'|'expired'|'locked'|'used'> {
	if (challenge.status !== 'Pendiente') return challenge.status === 'Usado' ? 'used' : 'locked';
	if (challenge.expiresAt < Date.now()) { await writeState(challenge, challenge.attempts, 'Vencido'); return 'expired'; }
	if (challenge.attempts >= MAX_ATTEMPTS) { await writeState(challenge, challenge.attempts, 'Bloqueado'); return 'locked'; }
	const expected = Buffer.from(challenge.digest, 'hex');
	const actual = Buffer.from(digest(challenge.id, code), 'hex');
	const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
	const attempts = challenge.attempts + (valid ? 0 : 1);
	await writeState(challenge, attempts, valid ? 'Verificado' : attempts >= MAX_ATTEMPTS ? 'Bloqueado' : 'Pendiente');
	return valid ? 'valid' : attempts >= MAX_ATTEMPTS ? 'locked' : 'invalid';
}

export async function consumePasswordResetChallenge(challenge: PasswordResetChallenge): Promise<void> {
	await writeState(challenge, challenge.attempts, 'Usado');
}

export async function markPasswordResetChallengeFailed(challenge: PasswordResetChallenge): Promise<void> {
	await writeState(challenge, challenge.attempts, 'Pendiente');
}

export async function invalidatePasswordResetChallenge(challenge: PasswordResetChallenge): Promise<void> {
	await writeState(challenge, challenge.attempts, 'Fallido');
}

export const PASSWORD_RESET_MAX_ATTEMPTS = MAX_ATTEMPTS;
