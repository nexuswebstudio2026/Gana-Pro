import { getSheetsClient, SPREADSHEET_ID } from './sheets';

export const ADVERTISING_TAB = 'Publicidad';

const HEADERS = [
	'TÍTULO',
	'LOGO URL',
	'DESCRIPCIÓN',
	'URL',
	'CATEGORÍA',
	'ANUNCIANTE',
	'ESTADO',
	'ORDEN',
] as const;

export interface SponsoredAd {
	title: string;
	logoUrl: string | null;
	description: string;
	url: string | null;
	category: string;
	advertiser: string;
	order: number;
}

function cell(row: string[], index: number): string {
	return String(row[index] ?? '').trim();
}

function safeHttpUrl(value: string): string | null {
	if (!value) return null;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}

async function ensureAdvertisingTab(): Promise<void> {
	const sheets = getSheetsClient();
	const metadata = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
	const tabExists = metadata.data.sheets?.some(
		(sheet) => sheet.properties?.title === ADVERTISING_TAB
	);

	if (!tabExists) {
		await sheets.spreadsheets.batchUpdate({
			spreadsheetId: SPREADSHEET_ID,
			requestBody: {
				requests: [{ addSheet: { properties: { title: ADVERTISING_TAB } } }],
			},
		});
	}

	const headerResponse = await sheets.spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: `${ADVERTISING_TAB}!A1:H1`,
	});
	const currentHeaders = (headerResponse.data.values?.[0] ?? []).map((value) =>
		String(value ?? '').trim().toLocaleUpperCase()
	);

	if (currentHeaders.length === 0 || currentHeaders.every((header) => !header)) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${ADVERTISING_TAB}!A1:H1`,
			valueInputOption: 'RAW',
			requestBody: { values: [[...HEADERS]] },
		});
		return;
	}

	const expectedHeaders = HEADERS.map((header) => header.toLocaleUpperCase());
	if (!expectedHeaders.every((header, index) => currentHeaders[index] === header)) {
		throw new Error(
			`La pestaña "${ADVERTISING_TAB}" no tiene los encabezados esperados: ${HEADERS.join(', ')}.`
		);
	}
}

/** Reads approved, complete ads; the sheet is initialized on first access. */
export async function listPublishedAds(): Promise<SponsoredAd[]> {
	await ensureAdvertisingTab();
	const response = await getSheetsClient().spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: `${ADVERTISING_TAB}!A2:H1000`,
	});

	return (response.data.values ?? [])
		.map((row) => row.map((value) => String(value ?? '')))
		.filter((row) => cell(row, 0) && cell(row, 2) && cell(row, 6).toLocaleUpperCase() === 'PUBLICAR')
		.map((row) => ({
			title: cell(row, 0),
			logoUrl: safeHttpUrl(cell(row, 1)),
			description: cell(row, 2),
			url: safeHttpUrl(cell(row, 3)),
			category: cell(row, 4),
			advertiser: cell(row, 5),
			order: Number(cell(row, 7)) || 0,
		}))
		.sort((left, right) => left.order - right.order);
}
