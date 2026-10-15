import { getSheetsClient, SPREADSHEET_ID } from './sheets';

export const ADVERTISING_TAB = 'Publicidad';

const HEADERS = [
	'TÍTULO',
	'IMAGEN URL',
	'DESCRIPCIÓN',
	'URL',
	'CATEGORÍA',
	'ANUNCIANTE',
	'ESTADO',
	'ORDEN',
] as const;

export interface SponsoredAd {
	title: string;
	imageUrl: string | null;
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
	if (value.startsWith('/') && !value.startsWith('//')) return value;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' ? url.href : null;
	} catch {
		return null;
	}
}

const INITIAL_AD: readonly string[] = [
	'Explora la calculadora educativa de GANA PRO',
	'/favicon.svg',
	'Revisa cómo funciona la matriz 5x1, compara escenarios y consulta los movimientos que calcula la herramienta. Los resultados dependen de las condiciones del plan y no están garantizados.',
	'/gana-dinero',
	'Educativa',
	'GANA PRO',
	'PUBLICAR',
	'1',
];

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
	const legacyHeaders = [...expectedHeaders];
	legacyHeaders[1] = 'LOGO URL';
	const isCurrentSchema = expectedHeaders.every((header, index) => currentHeaders[index] === header);
	const isLegacySchema = legacyHeaders.every((header, index) => currentHeaders[index] === header);

	if (isLegacySchema) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${ADVERTISING_TAB}!B1`,
			valueInputOption: 'RAW',
			requestBody: { values: [[HEADERS[1]]] },
		});
	} else if (!isCurrentSchema) {
		throw new Error(
			`La pestaña "${ADVERTISING_TAB}" no tiene los encabezados esperados: ${HEADERS.join(', ')}.`
		);
	}
}

/** Reads approved, complete ads; the sheet is initialized on first access. */
export async function listPublishedAds(): Promise<SponsoredAd[]> {
	await ensureAdvertisingTab();
	const sheets = getSheetsClient();
	const response = await sheets.spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: `${ADVERTISING_TAB}!A2:H1000`,
	});

	let rows = (response.data.values ?? [])
		.map((row) => row.map((value) => String(value ?? '')))
		.filter((row) => row.some((value) => value.trim()));

	if (rows.length === 0) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${ADVERTISING_TAB}!A2:H2`,
			valueInputOption: 'RAW',
			requestBody: { values: [[...INITIAL_AD]] },
		});
		rows = [[...INITIAL_AD]];
	}

	return rows
		.filter((row) => cell(row, 0) && cell(row, 2) && cell(row, 6).toLocaleUpperCase() === 'PUBLICAR')
		.map((row) => ({
			title: cell(row, 0),
			imageUrl: safeHttpUrl(cell(row, 1)),
			description: cell(row, 2),
			url: safeHttpUrl(cell(row, 3)),
			category: cell(row, 4),
			advertiser: cell(row, 5),
			order: Number(cell(row, 7)) || 0,
		}))
		.sort((left, right) => left.order - right.order);
}
