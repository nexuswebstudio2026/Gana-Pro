import { describe, expect, it } from 'vitest';
import {
	DOCUMENT_TYPES,
	DOCUMENT_TYPE_CODES,
	documentTypeLabel,
	normalizeDocumentType,
} from './testimonials';

describe('tipos de documento de identidad', () => {
	it('el catálogo es exactamente CC, TI, CE y PEP', () => {
		expect(DOCUMENT_TYPES.map((t) => t.code)).toEqual(['CC', 'TI', 'CE', 'PEP']);
	});

	it('los códigos derivados coinciden con el catálogo', () => {
		expect(DOCUMENT_TYPE_CODES).toEqual(['CC', 'TI', 'CE', 'PEP']);
	});

	it('acepta cada código sin importar mayúsculas ni espacios', () => {
		for (const code of DOCUMENT_TYPE_CODES) {
			expect(normalizeDocumentType(code)).toBe(code);
			expect(normalizeDocumentType(code.toLowerCase())).toBe(code);
			expect(normalizeDocumentType(` ${code} `)).toBe(code);
		}
	});

	it('acepta el nombre completo con y sin tildes', () => {
		expect(normalizeDocumentType('Cédula de Ciudadanía')).toBe('CC');
		expect(normalizeDocumentType('CEDULA DE CIUDADANIA')).toBe('CC');
		expect(normalizeDocumentType('tarjeta de identidad')).toBe('TI');
		expect(normalizeDocumentType('  Cédula   de  Extranjería ')).toBe('CE');
		expect(normalizeDocumentType('permiso por proteccion')).toBe('PEP');
	});

	it('rechaza lo que no está en el catálogo', () => {
		const invalidos = ['', '   ', 'NIT', 'XX', 'Pasaporte', 'CC CC'];
		for (const valor of invalidos) {
			expect(normalizeDocumentType(valor)).toBeNull();
		}
		expect(normalizeDocumentType(null as unknown as string)).toBeNull();
	});

	it('devuelve la etiqueta legible junto al código', () => {
		expect(documentTypeLabel('CC')).toBe('CC — Cédula de Ciudadanía');
		expect(documentTypeLabel('ti')).toBe('TI — Tarjeta de Identidad');
	});

	it('si el código no existe, devuelve el valor tal cual', () => {
		expect(documentTypeLabel('NIT')).toBe('NIT');
		expect(documentTypeLabel('  ')).toBe('');
	});
});