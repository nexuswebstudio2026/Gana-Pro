import { createHmac, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { toZonedIso } from './datetime';
import { getEnvValue, getSheetsClient, SPREADSHEET_ID } from './sheets';

const TAB = 'VerificacionRegistro';
const HEADERS = ['ID', 'EMAIL', 'CODIGO_HMAC', 'CREADO', 'VENCE_MS', 'INTENTOS', 'ESTADO'];
const RANGE = `${TAB}!A1:G20000`;
const MAX_ATTEMPTS = 5;
const secret = getEnvValue('SESSION_SECRET') || (process.env.NODE_ENV === 'production' || process.env.VERCEL ? '' : randomBytes(32).toString('hex'));

export interface RegistrationEmailChallenge {
	id: string;
	email: string;
	digest: string;
	createdAt: string;
	expiresAt: number;
	attempts: number;
	status: string;
	rowNumber: number;
}

function digest(id: string, code: string): string {
	if (!secret) throw new Error('Falta SESSION_SECRET para proteger códigos de verificación.');
	return createHmac('sha256', secret).update(`${id}:${code}`).digest('hex');
}

async function ensureTab(): Promise<void> {
	const sheets = getSheetsClient();
	const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
	if (!meta.data.sheets?.some((sheet) => sheet.properties?.title === TAB)) {
		await sheets.spreadsheets.batchUpdate({
			spreadsheetId: SPREADSHEET_ID,
			requestBody: { requests: [{ addSheet: { properties: { title: TAB } } }] },
		});
	}
	const current = await sheets.spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: `${TAB}!A1:G1` });
	if (!current.data.values?.[0]?.some(Boolean)) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${TAB}!A1:G1`,
			valueInputOption: 'RAW',
			requestBody: { values: [HEADERS] },
		});
	}
}

export async function createRegistrationEmailChallenge(email: string, code: string, lifetimeMs: number): Promise<RegistrationEmailChallenge> {
	await ensureTab();
	const id = randomUUID();
	const createdAt = toZonedIso();
	const expiresAt = Date.now() + lifetimeMs;
	const codeDigest = digest(id, code);
	await getSheetsClient().spreadsheets.values.append({
		spreadsheetId: SPREADSHEET_ID,
		range: `${TAB}!A:G`,
		valueInputOption: 'RAW',
		insertDataOption: 'INSERT_ROWS',
		requestBody: { values: [[id, email, codeDigest, createdAt, String(expiresAt), '0', 'Pendiente']] },
	});
	return { id, email, digest: codeDigest, createdAt, expiresAt, attempts: 0, status: 'Pendiente', rowNumber: -1 };
}

export async function getRegistrationEmailChallenge(id: string): Promise<RegistrationEmailChallenge | null> {
	await ensureTab();
	const response = await getSheetsClient().spreadsheets.values.get({ spreadsheetId: SPREADSHEET_ID, range: RANGE });
	const rows = response.data.values || [];
	for (let index = rows.length - 1; index >= 1; index--) {
		const row = rows[index] || [];
		if (String(row[0] || '') !== id) continue;
		return {
			id,
			email: String(row[1] || ''),
			digest: String(row[2] || ''),
			createdAt: String(row[3] || ''),
			expiresAt: Number(row[4] || 0),
			attempts: Number(row[5] || 0),
			status: String(row[6] || ''),
			rowNumber: index + 1,
		};
	}
	return null;
}

async function writeState(challenge: RegistrationEmailChallenge, attempts: number, status: string): Promise<void> {
	await getSheetsClient().spreadsheets.values.update({
		spreadsheetId: SPREADSHEET_ID,
		range: `${TAB}!F${challenge.rowNumber}:G${challenge.rowNumber}`,
		valueInputOption: 'RAW',
		requestBody: { values: [[String(attempts), status]] },
	});
}

export async function verifyRegistrationEmailCode(challenge: RegistrationEmailChallenge, code: string): Promise<'valid' | 'invalid' | 'expired' | 'locked' | 'used'> {
	if (challenge.status !== 'Pendiente') return challenge.status === 'Usado' ? 'used' : 'locked';
	if (challenge.expiresAt < Date.now()) {
		await writeState(challenge, challenge.attempts, 'Vencido');
		return 'expired';
	}
	if (challenge.attempts >= MAX_ATTEMPTS) {
		await writeState(challenge, challenge.attempts, 'Bloqueado');
		return 'locked';
	}
	const expected = Buffer.from(challenge.digest, 'hex');
	const actual = Buffer.from(digest(challenge.id, code), 'hex');
	const valid = expected.length === actual.length && timingSafeEqual(expected, actual);
	const attempts = challenge.attempts + (valid ? 0 : 1);
	await writeState(challenge, attempts, valid ? 'Verificado' : attempts >= MAX_ATTEMPTS ? 'Bloqueado' : 'Pendiente');
	return valid ? 'valid' : attempts >= MAX_ATTEMPTS ? 'locked' : 'invalid';
}

export async function consumeRegistrationEmailChallenge(challenge: RegistrationEmailChallenge): Promise<void> {
	await writeState(challenge, challenge.attempts, 'Usado');
}

export const REGISTRATION_EMAIL_CODE_LIFETIME_MS = 10 * 60 * 1000;
