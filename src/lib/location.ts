import { getSheetsClient, SPREADSHEET_ID } from './sheets';
import { toZonedIso } from './datetime';

/** Nombre de la pestaña donde se guarda la ubicación de los usuarios. */
export const LOCATION_TAB = 'Ubicacion';

/** Columnas de la pestaña de ubicación, en orden. */
export const LOCATION_HEADERS = [
	'ID',
	'FECHA',
	'USUARIO',
	'EMAIL',
	'LATITUD',
	'LONGITUD',
	'EXACTITUD',
	'ORIGEN',
	'URL GOOGLE MAPS',
	'IP PUBLICA',
	'CIUDAD APROXIMADA',
	'REGION APROXIMADA',
	'PAIS APROXIMADO',
	'CONSENTIMIENTO',
] as const;

/** Última columna de la pestaña (A..I). */
const LAST_COL = 'N';

/** Enlace a Google Maps con las coordenadas indicadas. */
export function getMapUrl(lat: number, lng: number): string {
	return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

export interface UserLocation {
	lat: number;
	lng: number;
	accuracy?: number;
	/** 'gps' | 'network' | 'manual' */
	source?: string;
}

export interface StoredLocation extends UserLocation {
	date: string;
	username: string;
	email: string;
	/** Enlace de Google Maps con la posición. */
	mapUrl: string;
	/** Id interno de la pestaña, para poder enlazar a la fila. */
	sheetId: number;
}

/** Enlace directo a la pestaña de ubicaciones dentro del spreadsheet. */
export function getLocationSheetUrl(sheetId?: number): string {
	const base = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`;
	return sheetId !== undefined ? `${base}#gid=${sheetId}` : base;
}

const RANGE = `${LOCATION_TAB}!A1:${LAST_COL}1000`;

function sleep(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/** Lee todas las filas con datos de la pestaña de ubicaciones. */
async function readRows(): Promise<string[][]> {
	const sheets = getSheetsClient();
	const res = await sheets.spreadsheets.values.get({
		spreadsheetId: SPREADSHEET_ID,
		range: RANGE,
	});
	return res.data.values || [];
}

/** Índice de la fila del usuario, o -1 si no está. */
function findRowIndex(rows: string[][], username: string): number {
	const target = username.trim().toLowerCase();
	return rows.findIndex((r) => String(r?.[2] ?? '').trim().toLowerCase() === target);
}

/**
 * Devuelve el ID de la pestaña "Ubicacion", creándola si no existe.
 * Los encabezados se (re)escriben si la fila 1 no los tiene, porque Google
 * Sheets puede tardar unos instantes en propagar la hoja recién creada.
 */
export async function ensureLocationSheet(): Promise<number> {
	const sheets = getSheetsClient();

	let sheetId: number | null = null;
	const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
	const found = meta.data.sheets?.find((s) => s.properties?.title === LOCATION_TAB);
	if (found?.properties?.sheetId !== undefined && found.properties.sheetId !== null) {
		sheetId = found.properties.sheetId;
		const grid = found.properties.gridProperties;
		const rowCount = Math.max(1000, grid?.rowCount ?? 0);
		const columnCount = Math.max(LOCATION_HEADERS.length, grid?.columnCount ?? 0);
		if (rowCount !== grid?.rowCount || columnCount !== grid?.columnCount) {
			await sheets.spreadsheets.batchUpdate({
				spreadsheetId: SPREADSHEET_ID,
				requestBody: {
					requests: [{
						updateSheetProperties: {
							properties: { sheetId, gridProperties: { rowCount, columnCount } },
							fields: 'gridProperties.rowCount,gridProperties.columnCount',
						},
					}],
				},
			});
		}
	} else {
		const created = await sheets.spreadsheets.batchUpdate({
			spreadsheetId: SPREADSHEET_ID,
			requestBody: { requests: [{ addSheet: { properties: { title: LOCATION_TAB } } }] },
		});
		const newId = created.data.replies?.[0]?.addSheet?.properties?.sheetId;
		if (newId === undefined || newId === null) {
			throw new Error('No se pudo crear la pestaña de ubicaciones.');
		}
		sheetId = newId;
	}

	// La fila 1 debe tener los encabezados. No se reescribe entera: si el
	// administrador personalizó los títulos, se respeta lo que puso.
	for (let intento = 0; intento < 3; intento++) {
		const rows = await readRows();
		if (!rows.length) {
			await escribirEncabezados(sheets);
			await sleep(400);
			continue;
		}

		const cabeceras = (rows[0] || []).map((c) => norm(c));
		const colUsuario = cabeceras.indexOf('usuario');
		const colLat = cabeceras.indexOf('latitud');
		const colMaps = cabeceras.findIndex((c) => c.includes('google maps'));

		// Fila válida: tiene las columnas base y la del mapa ya escrita.
		if (colUsuario >= 0 && colLat >= 0 && colMaps >= 0) {
			const missing = LOCATION_HEADERS.slice(cabeceras.length);
			if (missing.length) {
				await sheets.spreadsheets.values.update({
					spreadsheetId: SPREADSHEET_ID,
					range: `${LOCATION_TAB}!J1:N1`,
					valueInputOption: 'RAW',
					requestBody: { values: [[...LOCATION_HEADERS.slice(9)]] },
				});
			}
			break;
		}

		// Si la fila 1 no es la de encabezados, se reconstruye completa.
		if (colUsuario < 0 || colLat < 0) {
			await escribirEncabezados(sheets);
		} else if (colMaps < 0) {
			// Solo falta la columna del mapa: se rellenan las celdas vacías
			// que hay a su derecha, sin tocar los títulos ya personalizados.
			const celda = `${LOCATION_TAB}!${String.fromCharCode(65 + cabeceras.length)}1`;
			await sheets.spreadsheets.values.update({
				spreadsheetId: SPREADSHEET_ID,
				range: celda,
				valueInputOption: 'RAW',
				requestBody: { values: [['URL GOOGLE MAPS']] },
			});
		}
		await sleep(400);
	}

	return sheetId;
}

export interface VisitorAccess {
	ip: string;
	latitude: number;
	longitude: number;
	accuracy?: number;
	city?: string;
	region?: string;
	country?: string;
	visitorId: string;
}

/** Registra la autorización y la ubicación aproximada derivada de la IP. */
export async function saveVisitorAccess(
	access: VisitorAccess,
	user?: { username: string; email: string }
): Promise<void> {
	const sheets = getSheetsClient();
	await ensureLocationSheet();
	const rows = await readRows();
	const username = user?.username?.trim() || `Visitante ${access.visitorId.slice(-8)}`;
	const key = user?.username?.trim().toLowerCase() || username.toLowerCase();
	const existing = rows.findIndex((row) => String(row?.[2] ?? '').trim().toLowerCase() === key);
	const ids = rows.slice(1).map((row) => Number(row?.[0]) || 0);
	const id = existing >= 0 ? Number(rows[existing]?.[0]) || existing : Math.max(0, ...ids) + 1;
	const mapUrl = getMapUrl(access.latitude, access.longitude);
	const row = [
		String(id), toZonedIso(), username, user?.email || '',
		String(access.latitude), String(access.longitude),
		access.accuracy !== undefined ? String(Math.round(access.accuracy)) : '', 'gps',
		`=HYPERLINK("${mapUrl}";"Ver en Google Maps")`,
		access.ip, access.city || '', access.region || '', access.country || '', 'Aceptado',
	];
	if (existing >= 0) {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${LOCATION_TAB}!A${existing + 1}:N${existing + 1}`,
			valueInputOption: 'USER_ENTERED',
			requestBody: { values: [row] },
		});
		return;
	}
	const targetRow = rows.length + 1;
	await sheets.spreadsheets.values.update({
		spreadsheetId: SPREADSHEET_ID,
		range: `${LOCATION_TAB}!A${targetRow}:N${targetRow}`,
		valueInputOption: 'USER_ENTERED',
		requestBody: { values: [row] },
	});
}

/** Escribe los encabezados de la fila 1. */
async function escribirEncabezados(
	sheets: ReturnType<typeof getSheetsClient>
): Promise<void> {
	await sheets.spreadsheets.values.update({
		spreadsheetId: SPREADSHEET_ID,
		range: `${LOCATION_TAB}!A1:${LAST_COL}1`,
		valueInputOption: 'RAW',
		requestBody: { values: [[...LOCATION_HEADERS]] },
	});
}

/** Normaliza un texto de encabezado para compararlo. */
function norm(value: string): string {
	return String(value ?? '')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

/** Valida que las coordenadas sean correctas antes de guardarlas. */
export function isValidCoordinates(lat: unknown, lng: unknown): boolean {
	const latitude = Number(lat);
	const longitude = Number(lng);
	return (
		Number.isFinite(latitude) &&
		Number.isFinite(longitude) &&
		latitude >= -90 &&
		latitude <= 90 &&
		longitude >= -180 &&
		longitude <= 180
	);
}

/**
 * Guarda (o actualiza) la ubicación de un usuario.
 * Cada inicio de sesión sobrescribe la fila: siempre queda la última posición.
 */
export async function saveUserLocation(
	username: string,
	email: string,
	location: UserLocation
): Promise<void> {
	const sheets = getSheetsClient();
	const sheetId = await ensureLocationSheet();

	// La lectura se reintenta: Google Sheets puede devolver datos desactualizados
	// justo después de una escritura, y eso provocaba filas duplicadas.
	let rows: string[][] = [];
	let existing = -1;
	for (let intento = 0; intento < 3; intento++) {
		rows = await readRows();
		existing = findRowIndex(rows, username);
		if (existing >= 0) break;
		await sleep(300);
	}

	// ID correlativo: solo se cuentan las filas de datos (la fila 1 es de títulos).
	const idsDatos = rows
		.slice(1)
		.map((r) => Number(r?.[0]) || 0)
		.filter((n) => n > 0);
	const maxId = idsDatos.length ? Math.max(...idsDatos) : 0;
	const id = existing >= 0 ? Number(rows[existing]?.[0]) || existing : maxId + 1;

	const mapUrl = getMapUrl(location.lat, location.lng);
	const row = [
		String(id),
		toZonedIso(),
		username,
		email,
		String(location.lat),
		String(location.lng),
		location.accuracy !== undefined ? String(Math.round(location.accuracy)) : '',
		location.source || 'gps',
	];

	// Se escribe siempre en una fila concreta (nunca con `append`), para que un
	// desfase de lectura no pueda crear una segunda fila del mismo usuario.
	const fila = existing >= 0 ? existing + 1 : rows.length + 1;
	await sheets.spreadsheets.values.update({
		spreadsheetId: SPREADSHEET_ID,
		range: `${LOCATION_TAB}!A${fila}:H${fila}`,
		valueInputOption: 'RAW',
		requestBody: { values: [row] },
	});

	// La celda del mapa se escribe como fórmula HYPERLINK para que quede
	// clicable dentro de la hoja. El separador es ";" porque el idioma de la
	// hoja es español; con "," Google devuelve #ERROR!.
	try {
		await sheets.spreadsheets.values.update({
			spreadsheetId: SPREADSHEET_ID,
			range: `${LOCATION_TAB}!I${fila}`,
			valueInputOption: 'USER_ENTERED',
			requestBody: { values: [[`=HYPERLINK("${mapUrl}";"Ver en Google Maps")`]] },
		});
	} catch (err) {
		// Si la fórmula no es válida, se deja al menos el texto plano de la URL.
		console.error('No se pudo crear el enlace de Google Maps:', err);
		try {
			await sheets.spreadsheets.values.update({
				spreadsheetId: SPREADSHEET_ID,
				range: `${LOCATION_TAB}!I${fila}`,
				valueInputOption: 'RAW',
				requestBody: { values: [[mapUrl]] },
			});
		} catch {
			// sin enlace y sin texto: la fila conserva la coordenada, que es lo esencial.
		}
	}
}

/** Última ubicación registrada de un usuario, o `null` si aún no ha compartido. */
export async function getUserLocation(username: string): Promise<StoredLocation | null> {
	let sheetId: number;
	try {
		sheetId = await ensureLocationSheet();
	} catch {
		return null;
	}

	const rows = await readRows();
	const idx = findRowIndex(rows, username);
	if (idx < 0) return null;

	const row = rows[idx];
	const lat = Number(row?.[4]);
	const lng = Number(row?.[5]);
	if (!isValidCoordinates(lat, lng)) return null;

	// La columna del mapa guarda una fórmula =HYPERLINK(...). Con la lectura
	// habitual solo llega el texto "Ver en Google Maps", así que se pide esa
	// celda en modo fórmula para recuperar la URL real.
	let mapUrl = getMapUrl(lat, lng);
	try {
		const link = await getSheetsClient().spreadsheets.values.get({
			spreadsheetId: SPREADSHEET_ID,
			range: `${LOCATION_TAB}!I${idx + 1}`,
			valueRenderOption: 'FORMULA',
		});
		mapUrl = extractMapUrl(link.data.values?.[0]?.[0], lat, lng);
	} catch {
		// sin la celda del mapa se reconstruye la URL con las coordenadas.
	}

	return {
		lat,
		lng,
		accuracy: row?.[6] ? Number(row[6]) : undefined,
		source: row?.[7] || 'gps',
		date: String(row?.[1] || ''),
		username: String(row?.[2] || username),
		email: String(row?.[3] || ''),
		// La celda I guarda una fórmula =HYPERLINK(...): se extrae la URL real
		// con una expresión regular para poder reutilizarla en el panel.
		mapUrl,
		sheetId,
	};
}

/** Saca la URL de una celda que puede contener la fórmula HYPERLINK o el texto plano. */
function extractMapUrl(celda: unknown, lat: number, lng: number): string {
	const texto = String(celda ?? '').trim();
	if (!texto) return getMapUrl(lat, lng);
	if (texto.startsWith('http')) return texto;
	const match = texto.match(/https?:\/\/[^"')]+/);
	return match ? match[0] : getMapUrl(lat, lng);
}

