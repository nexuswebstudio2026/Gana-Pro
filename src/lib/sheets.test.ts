import { describe, expect, it } from 'vitest';
import {
	parseSheetBalance,
	registrationContactColumnIndexes,
	userColumnIndexes,
} from './sheets';
import { siteUrlFromHeaders } from './sheets';

/**
 * El encabezado tal y como está en Google Sheets. Se reproduce completo,
 * tildes incluidas, porque `normalizeHeader` las quita antes de comparar.
 */
const REAL_HEADERS = [
	'ID',
	'Fecha de Registro',
	'Rol',
	'Tipo Documento',
	'Número Documento',
	'Direccion Residencia',
	'Barrio',
	'Ciudad de Residencia',
	'Contacto Telefonico',
	'Contacto whatsapp',
	'Direccion',
	'Barrio',
	'Ciudad',
	'Telefono',
	'Whatsapp',
	'Email',
	'Usuario',
	'Contraseña',
	'Método de Pago',
	'Número de Billetera',
	'Saldo Acumulado',
	'Level',
	'Código Referido',
	'Código Propio',
	'Estado Documento',
	'Enlace Documento',
	'Documento Escaneado',
	'NIT',
	'RUT escaneado',
	'Enlace RUT',
];

/** Reproduce `normalizeHeader` de `sheets.ts` sin importar el módulo entero. */
function normalize(header: string): string {
	return header
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

const normalizedHeaders = REAL_HEADERS.map(normalize);

/**
 * Encabezado actual de la hoja "Usuarios", después de unificar columnas: se
 * quitaron las largas de contacto y "NIT", "RUT escaneado" y "Enlace RUT"
 * pasaron a llamarse "Numero de Documento", "Documento Escaneado" y
 * "Enlace Documento".
 */
const CURRENT_HEADERS = [
	'ID',
	'Fecha de Registro',
	'Rol',
	'Tipo Documento',
	'Número Documento',
	'Direccion',
	'Barrio',
	'Ciudad',
	'Telefono',
	'Whatsapp',
	'Email',
	'Usuario',
	'Contraseña',
	'Método de Pago',
	'Número de Billetera',
	'Saldo Acumulado',
	'Level',
	'Código Referido',
	'Código Propio',
	'Estado Documento',
	'Enlace Documento',
	'Documento Escaneado',
	'Numero de Documento',
	'Documento Escaneado',
	'Enlace Documento',
];

describe('userColumnIndexes con el encabezado actual', () => {
	const idx = userColumnIndexes(CURRENT_HEADERS.map(normalize));

	it('no deja ninguna columna sin resolver', () => {
		// Un `-1` no da error: la escritura se salta en silencio y el dato se
		// pierde. Este es el aviso más barato de que algo se rompió.
		const sinResolver = Object.entries(idx).filter(([, i]) => i === -1);
		expect(sinResolver).toEqual([]);
	});

	it('separa "Número Documento" de "Numero de Documento" (el NIT)', () => {
		// Solo se distinguen por el "de". Sin esa precisión, ambas caían en la 4.
		expect(idx.documentNumber).toBe(4);
		expect(idx.nit).toBe(22);
	});

	it('lee el NIT aunque la columna ya no se llame "NIT"', () => {
		expect(idx.nit).toBe(22);
	});

	it('apunta el enlace y el archivo a las columnas de documento', () => {
		expect(idx.documentLink).toBe(20);
		expect(idx.scannedDocument).toBe(21);
		// Sin columna propia, el par del RUT se apoya en las del documento.
		expect(idx.rutLink).toBe(idx.documentLink);
		expect(idx.scannedRut).toBe(idx.scannedDocument);
	});

	it('sigue escribiendo en las columnas cortas de contacto y billetera', () => {
		expect(idx.address).toBe(5);
		expect(idx.neighborhood).toBe(6);
		expect(idx.city).toBe(7);
		expect(idx.phone).toBe(8);
		expect(idx.whatsapp).toBe(9);
		expect(idx.paymentMethod).toBe(13);
		expect(idx.walletNumber).toBe(14);
	});
});

describe('userColumnIndexes con el encabezado anterior', () => {
	const idx = userColumnIndexes(normalizedHeaders);

	it('mantiene las columnas propias de NIT y RUT', () => {
		expect(idx.nit).toBe(27);
		expect(idx.scannedRut).toBe(28);
		expect(idx.rutLink).toBe(29);
	});
});

describe('siteUrlFromHeaders', () => {
	// Se prueba esta función y no `getPublicSiteUrl` porque `PUBLIC_SITE_URL`
	// tiene prioridad y cortocircuitaría la lógica de encabezados.
	const h = (headers: Record<string, string>) => new Headers(headers);

	it('usa el host real de la visita, no el URL del despliegue', () => {
		// Este es el bug que rompía el QR: se preguntaba antes por
		// `x-vercel-deployment-url`, que apunta a una vista previa que luego
		// desaparece, y el QR acababa en un error de Vercel.
		expect(
			siteUrlFromHeaders(
				h({
					'x-vercel-deployment-url': 'gana-pro-abc123-equipo.vercel.app',
					'x-forwarded-host': 'gana-pro.vercel.app',
					host: 'gana-pro.vercel.app',
				})
			)
		).toBe('https://gana-pro.vercel.app');
	});

	it('usa el host si no hay forwarded-host', () => {
		expect(
			siteUrlFromHeaders(
				h({ 'x-vercel-deployment-url': 'preview-1.vercel.app', host: 'gana-pro.vercel.app' })
			)
		).toBe('https://gana-pro.vercel.app');
	});

	it('recurre al despliegue solo cuando no hay host de entrada', () => {
		expect(
			siteUrlFromHeaders(h({ 'x-vercel-deployment-url': 'preview-1.vercel.app' }))
		).toBe('https://preview-1.vercel.app');
	});

	it('toma el primero de una lista de x-forwarded-host', () => {
		expect(
			siteUrlFromHeaders(h({ 'x-forwarded-host': 'gana-pro.vercel.app, proxy.interno' }))
		).toBe('https://gana-pro.vercel.app');
	});

	it('nunca devuelve localhost como dominio público', () => {
		expect(
			siteUrlFromHeaders(h({ 'x-forwarded-host': 'localhost:4321', host: 'localhost:4321' }))
		).toBeNull();
	});

	it('devuelve null si no hay nada utilizable', () => {
		expect(siteUrlFromHeaders(h({}))).toBeNull();
		expect(siteUrlFromHeaders(undefined)).toBeNull();
	});
});

describe('registrationContactColumnIndexes', () => {
	const idx = registrationContactColumnIndexes(normalizedHeaders);

	it('escribe en las columnas cortas, no en las largas del panel', () => {
		// K, L, M, N, O -> índices 10..14. Estas son las que pidió el registro.
		expect(idx.address).toBe(10);
		expect(idx.neighborhood).toBe(11);
		expect(idx.city).toBe(12);
		expect(idx.phone).toBe(13);
		expect(idx.whatsapp).toBe(14);
	});

	it('no confunde "Direccion Residencia" con "Direccion"', () => {
		// Es el caso que motiva el nombre exacto: con `includes` se elegiría la
		// columna del panel (F) y el registro nunca llenaría la K.
		expect(normalizedHeaders.indexOf('direccion')).not.toBe(
			normalizedHeaders.indexOf('direccion residencia')
		);
		expect(idx.address).not.toBe(5);
	});

	it('elige la segunda columna "Barrio", que está duplicada en el encabezado', () => {
		expect(normalizedHeaders.filter((h) => h === 'barrio')).toHaveLength(2);
		expect(idx.neighborhood).toBe(11);
	});

	it('no confunde los teléfonos largos con el corto', () => {
		// "Contacto Telefonico" contiene "telefon" pero no es "telefono".
		expect(normalizedHeaders.indexOf('telefono')).not.toBe(
			normalizedHeaders.indexOf('contacto telefonico')
		);
		expect(idx.phone).toBe(13);
		expect(idx.whatsapp).toBe(14);
	});

	it('devuelve -1 si la hoja no tiene esas columnas', () => {
		const empty = registrationContactColumnIndexes(['id', 'usuario', 'email']);
		expect(empty.address).toBe(-1);
		expect(empty.neighborhood).toBe(-1);
		expect(empty.city).toBe(-1);
		expect(empty.phone).toBe(-1);
		expect(empty.whatsapp).toBe(-1);
	});
});

/**
 * Tests de `parseSheetBalance`.
 *
 * En la hoja conviven varios formatos porque las celdas se escribieron a mano
 * con el separador de miles y el decimal cambiados según quien las editó. La
 * función decide qué separador es el decimal, y un error ahí se traduce
 * directamente en dinero: "1.234" leído como mil doscientos treinta y cuatro
 * cuando son mil doscientos treinta y cuatro pesos... o al revés, mil doscientos
 * treinta y cuatro CREDITADOS de más.
 */
describe('parseSheetBalance', () => {
	it('devuelve 0 para celdas vacías o sin dígitos', () => {
		expect(parseSheetBalance('')).toBe(0);
		expect(parseSheetBalance(null)).toBe(0);
		expect(parseSheetBalance(undefined)).toBe(0);
		expect(parseSheetBalance('   ')).toBe(0);
		expect(parseSheetBalance('N/A')).toBe(0);
	});

	it('ignora el símbolo de moneda y los espacios', () => {
		// El comentario de la hoja documenta un caso real: " $0" con espacio inicial.
		expect(parseSheetBalance(' $0')).toBe(0);
		expect(parseSheetBalance('$1.500')).toBe(1500);
		expect(parseSheetBalance('  $ 2.500  ')).toBe(2500);
	});

	it('lee enteros sin separador', () => {
		expect(parseSheetBalance('1500')).toBe(1500);
		expect(parseSheetBalance('0')).toBe(0);
	});

	it('trata el punto como decimal cuando no es separador de miles', () => {
		expect(parseSheetBalance('150.00')).toBe(150);
		expect(parseSheetBalance('1234.5')).toBe(1234.5);
	});

	it('trata la coma como decimal cuando no es separador de miles', () => {
		expect(parseSheetBalance('150,00')).toBe(150);
		expect(parseSheetBalance('1234,5')).toBe(1234.5);
	});

	it('reconoce el punto como separador de miles cuando le siguen 3 dígitos', () => {
		// "1.234" -> 1234, no 1.234
		expect(parseSheetBalance('1.234')).toBe(1234);
		expect(parseSheetBalance('1.234.567')).toBe(1234567);
	});

	it('reconoce la coma como separador de miles cuando le siguen 3 dígitos', () => {
		expect(parseSheetBalance('1,234')).toBe(1234);
	});

	it('resuelve el formato colombiano "1.234,56" (punto de miles, coma decimal)', () => {
		// El último separador es la coma, así que es la decimal; el punto de la
		// parte entera es de miles. Si se invirtiera, el saldo se inflaría x1000.
		expect(parseSheetBalance('1.234,56')).toBe(1234.56);
		expect(parseSheetBalance('1.234.567,89')).toBe(1234567.89);
	});

	it('resuelve el formato anglosajón "1,234.56" (coma de miles, punto decimal)', () => {
		// Aquí el punto es el decimal, no un separador de miles.
		expect(parseSheetBalance('1,234.56')).toBe(1234.56);
	});

	it('admite negativos', () => {
		expect(parseSheetBalance('-500')).toBe(-500);
		expect(parseSheetBalance('-1.234,56')).toBe(-1234.56);
	});

	it('nunca devuelve NaN aunque la celda sea basura', () => {
		// Es la garantía importante: un valor corrupto nunca se interpreta
		// como saldo disponible.
		for (const raw of [',..', '--', '...', '$,.']) {
			expect(Number.isFinite(parseSheetBalance(raw))).toBe(true);
		}
	});
});
