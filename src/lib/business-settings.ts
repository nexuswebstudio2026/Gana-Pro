import { getSheetsClient, SPREADSHEET_ID } from './sheets';
import { toZonedIso } from './datetime';

export const BUSINESS_SETTINGS_TAB = 'Configuracion';
export const BUSINESS_SETTINGS_ID = 'NEGOCIO';

const HEADERS = ['ID', 'NIT', 'ENLACE RUT', 'ARCHIVO RUT', 'TIPO MIME', 'ACTUALIZADO EN'] as const;
const RANGE = `${BUSINESS_SETTINGS_TAB}!A1:F100`;

export interface BusinessSettings {
	id: typeof BUSINESS_SETTINGS_ID;
	nit: string;
	rutLink: string;
	rutFileName: string;
	mimeType: string;
	updatedAt: string;
}

function normalizeHeader(value: unknown): string {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

async function getSettingsRows(): Promise<string[][]> {
	const sheets = getSheetsClient();
	const metadata = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
	const tabExists = metadata.data.sheets?.some(
		(sheet) => sheet.properties?.title === BUSINESS_SETTINGS_TAB
	);

	if (!tabExists) {
		await sheets.spreadsheets.batchUpdate({
			spreadsheetId: SPREADSHEET_ID,
			requestBody: {
				requests: [{ addSheet: { properties: { title: BUSINESS_SETTINGS_TAB } } }],
			},
		});
	}

	const response = await sheets.spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: RANGE,
	});
	const rows = (response.data.values || []).map((row) => row.map((cell) => String(cell ?? '')));

	if (rows.length === 0 || rows[0].every((cell) => !cell.trim())) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${BUSINESS_SETTINGS_TAB}!A1:F1`,
			valueInputOption: 'RAW',
			requestBody: { values: [[...HEADERS]] },
		});
		return [[...HEADERS]];
	}

	const actualHeaders = rows[0].map(normalizeHeader);
	if (!HEADERS.every((header, index) => actualHeaders[index] === normalizeHeader(header))) {
		throw new Error(`La pestaña ${BUSINESS_SETTINGS_TAB} no tiene los encabezados esperados.`);
	}

	return rows;
}

/** Devuelve la configuración empresarial, o null cuando aún no se ha guardado. */
export async function getBusinessSettings(): Promise<BusinessSettings | null> {
	const rows = await getSettingsRows();
	const rowIndex = rows.findIndex(
		(row, index) => index > 0 && String(row[0] || '').trim().toUpperCase() === BUSINESS_SETTINGS_ID
	);
	if (rowIndex < 0) return null;

	const [id, nit, rutLink, rutFileName, mimeType, updatedAt] = rows[rowIndex];
	return {
		id: id.toUpperCase() as typeof BUSINESS_SETTINGS_ID,
		nit: nit || '',
		rutLink: rutLink || '',
		rutFileName: rutFileName || '',
		mimeType: mimeType || '',
		updatedAt: updatedAt || '',
	};
}

/** Crea o actualiza el único registro de NIT/RUT de Gana Pro. */
export async function saveBusinessSettings(
	settings: Omit<BusinessSettings, 'id' | 'updatedAt'>
): Promise<void> {
	const sheets = getSheetsClient();
	const rows = await getSettingsRows();
	const existingIndex = rows.findIndex(
		(row, index) => index > 0 && String(row[0] || '').trim().toUpperCase() === BUSINESS_SETTINGS_ID
	);
	const targetRow = existingIndex >= 0 ? existingIndex + 1 : Math.max(rows.length + 1, 2);

	await sheets.spreadsheets.values.update({
		spreadsheetId: SPREADSHEET_ID,
		range: `${BUSINESS_SETTINGS_TAB}!A${targetRow}:F${targetRow}`,
		valueInputOption: 'RAW',
		requestBody: {
			values: [[BUSINESS_SETTINGS_ID, settings.nit, settings.rutLink, settings.rutFileName, settings.mimeType, toZonedIso()]],
		},
	});
}
