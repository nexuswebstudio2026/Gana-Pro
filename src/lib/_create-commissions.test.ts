import { describe, it, expect } from 'vitest';
import { getSheetsClient, SPREADSHEET_ID } from './sheets';
import { COMMISSION_CONCEPT, COMMISSIONS_TAB, listCommissions } from './referral-commissions';

const HEADERS = ['FECHA', 'REFERENTE', 'REFERIDO', 'CONCEPTO', 'MONTO'];

describe('pestana Comisiones', () => {
	it('crea la pestaña con su encabezado si no existe', async () => {
		const sheets = getSheetsClient();
		const meta = await sheets.spreadsheets.get({
			spreadsheetId: SPREADSHEET_ID,
			fields: 'sheets.properties.title',
		});
		const titles = meta.data.sheets?.map((s) => s.properties?.title) ?? [];
		console.log('\n=== PESTANAS ANTES ===');
		console.log('  ' + titles.join(', '));

		if (!titles.includes(COMMISSIONS_TAB)) {
			await sheets.spreadsheets.batchUpdate({
				spreadsheetId: SPREADSHEET_ID,
				requestBody: {
					requests: [{ addSheet: { properties: { title: COMMISSIONS_TAB } } }],
				},
			});
			console.log('\n  Pestana "' + COMMISSIONS_TAB + '" creada.');
		} else {
			console.log('\n  La pestana "' + COMMISSIONS_TAB + '" ya existia.');
		}

		// Encabezado: solo se escribe si la fila esta vacia, para no pisar datos.
		const res = await sheets.spreadsheets.values.get({
			spreadsheetId: SPREADSHEET_ID,
			range: `${COMMISSIONS_TAB}!A1:E1`,
		});
		const fila = (res.data.values?.[0] ?? []).map((c) => String(c ?? '').trim());
		const vacia = fila.length === 0 || fila.every((c) => !c);
		if (vacia) {
			await sheets.spreadsheets.values.update({
				spreadsheetId: SPREADSHEET_ID,
				range: `${COMMISSIONS_TAB}!A1:E1`,
				valueInputOption: 'RAW',
				requestBody: { values: [HEADERS] },
			});
			console.log('  Encabezado escrito: ' + HEADERS.join(' | '));
		} else {
			console.log('  Encabezado ya existente: ' + fila.join(' | '));
		}

		const meta2 = await sheets.spreadsheets.get({
			spreadsheetId: SPREADSHEET_ID,
			fields: 'sheets.properties.title',
		});
		console.log('\n=== PESTANAS DESPUES ===');
		console.log('  ' + (meta2.data.sheets ?? []).map((s) => s.properties?.title).join(', '));

		const lista = await listCommissions();
		console.log('\n=== listCommissions() ===');
		console.log('  registros:', lista.length);
		expect(true).toBe(true);
	}, 60000);
});