import { google } from 'googleapis';
import { readFileSync } from 'node:fs';
import { del } from '@vercel/blob';

const root = String.raw`c:\Users\JAC ROSABLANCA\Documents\GitHub\gana-pro`;
function env(key) {
	for (const line of readFileSync(`${root}\\.env`, 'utf-8').split(/\r?\n/)) {
		if (line.startsWith(key + '=')) {
			let v = line.slice(key.length + 1).trim();
			if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
			return v.replace(/\\n/g, '\n');
		}
	}
}
const SPREADSHEET_ID = env('GOOGLE_SHEET_ID');
const TAB = env('GOOGLE_SHEET_TESTIMONIALS_TAB') || 'valoracion';
const TARGET = 'VerifTmp';

const sheets = google.sheets({
	version: 'v4',
	auth: new google.auth.JWT({
		email: env('GOOGLE_SERVICE_ACCOUNT_EMAIL'),
		key: env('GOOGLE_PRIVATE_KEY'),
		scopes: ['https://www.googleapis.com/auth/spreadsheets'],
	}),
});

const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
const sheetId = meta.data.sheets.find((s) => s.properties.title === TAB).properties.sheetId;
const res = await sheets.spreadsheets.values.get({
	spreadsheetId: SPREADSHEET_ID,
	range: `${TAB}!A1:L1000`,
});
const rows = res.data.values || [];
const norm = (s) => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
let headerRow = -1;
for (let i = 0; i < rows.length; i++) {
	const n = rows[i].map(norm);
	if (n.includes('valoracion') && n.includes('comentario')) {
		headerRow = i;
		break;
	}
}
const headers = rows[headerRow].map(norm);
const colUser = headers.indexOf('usuario');
const colUrl = headers.indexOf('imagen_url');
const toDelete = [];
const blobs = [];
for (let i = headerRow + 1; i < rows.length; i++) {
	if (String(rows[i]?.[colUser] || '').trim() === TARGET) {
		toDelete.push(i);
		const u = String(rows[i]?.[colUrl] || '').trim();
		if (u.includes('vercel-storage.com/testimonios/')) {
			blobs.push(decodeURIComponent(u.split('/testimonios/')[1]));
		}
	}
}
if (toDelete.length) {
	await sheets.spreadsheets.batchUpdate({
		spreadsheetId: SPREADSHEET_ID,
		requestBody: {
			requests: toDelete
				.sort((a, b) => b - a)
				.map((idx) => ({
					deleteDimension: {
						range: { sheetId, dimension: 'ROWS', startIndex: idx, endIndex: idx + 1 },
					},
				})),
		},
	});
}
console.log(`Filas "${TARGET}" eliminadas de ${TAB}: ${toDelete.length}`);

for (const pathname of blobs) {
	try {
		await del(pathname, { token: env('BLOB_READ_WRITE_TOKEN') });
		console.log('Blob borrado:', pathname);
	} catch (e) {
		console.log('No se pudo borrar el blob', pathname, '-', e.message?.split('\n')[0]);
	}
}
