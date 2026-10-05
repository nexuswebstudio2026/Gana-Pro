import { describe, expect, it } from 'vitest';
import {
	MAX_RECEIPT_BYTES,
	P2P_CONCEPT,
	P2P_MIN_LEVEL,
	P2P_STATUS,
	P2P_STATUS_TONE,
	RECARGA_INICIAL_AMOUNT,
	canSubmitConcept,
	conceptAmount,
	isP2PConcept,
	normalizeReceiptReference,
	validateReceipt,
} from './p2p';

describe('isP2PConcept', () => {
	it('acepta los tres conceptos del selector', () => {
		expect(isP2PConcept(P2P_CONCEPT.recargaInicial)).toBe(true);
		expect(isP2PConcept(P2P_CONCEPT.ascensoPatrocinador)).toBe(true);
		expect(isP2PConcept(P2P_CONCEPT.sostenimientoGanaPro)).toBe(true);
	});

	it('rechaza cualquier otro texto', () => {
		expect(isP2PConcept('Recarga')).toBe(false);
		expect(isP2PConcept('')).toBe(false);
		expect(isP2PConcept(undefined)).toBe(false);
		expect(isP2PConcept(null)).toBe(false);
		expect(isP2PConcept({})).toBe(false);
	});
});

describe('conceptAmount', () => {
	it('la recarga inicial siempre vale lo mismo', () => {
		// Es un monto fijo: no depende del saldo que tenga el miembro.
		expect(conceptAmount(P2P_CONCEPT.recargaInicial, 0)).toBe(RECARGA_INICIAL_AMOUNT);
		expect(conceptAmount(P2P_CONCEPT.recargaInicial, 5_000_000)).toBe(RECARGA_INICIAL_AMOUNT);
	});

	it('el ascenso toma el 50 % del saldo', () => {
		expect(conceptAmount(P2P_CONCEPT.ascensoPatrocinador, 100_000)).toBe(50_000);
		// Redondeo a pesos enteros: no se admiten centavos.
		expect(conceptAmount(P2P_CONCEPT.ascensoPatrocinador, 1_001)).toBe(501);
	});

	it('el sostenimiento toma el 30 % del saldo', () => {
		expect(conceptAmount(P2P_CONCEPT.sostenimientoGanaPro, 100_000)).toBe(30_000);
	});

	it('un saldo vacío o inválido produce 0, no NaN', () => {
		expect(conceptAmount(P2P_CONCEPT.ascensoPatrocinador, 0)).toBe(0);
		expect(conceptAmount(P2P_CONCEPT.ascensoPatrocinador, -500)).toBe(0);
		expect(conceptAmount(P2P_CONCEPT.ascensoPatrocinador, NaN)).toBe(0);
	});

	it('los dos repartos suman el 80 % del saldo', () => {
		const balance = 250_000;
		const total =
			conceptAmount(P2P_CONCEPT.ascensoPatrocinador, balance) +
			conceptAmount(P2P_CONCEPT.sostenimientoGanaPro, balance);
		expect(total).toBe(200_000);
	});
});

describe('canSubmitConcept', () => {
	it('la recarga inicial está disponible desde el nivel 1', () => {
		expect(canSubmitConcept(P2P_CONCEPT.recargaInicial, '1')).toBe(true);
		expect(canSubmitConcept(P2P_CONCEPT.recargaInicial, 'Bronce')).toBe(true);
	});

	it('los repartos exigen el nivel mínimo', () => {
		expect(canSubmitConcept(P2P_CONCEPT.ascensoPatrocinador, '4')).toBe(false);
		expect(canSubmitConcept(P2P_CONCEPT.sostenimientoGanaPro, '4')).toBe(false);
		expect(canSubmitConcept(P2P_CONCEPT.ascensoPatrocinador, 'Oro')).toBe(true);
		expect(canSubmitConcept(P2P_CONCEPT.sostenimientoGanaPro, String(P2P_MIN_LEVEL))).toBe(true);
	});

	it('sin nivel reconocible no habilita los repartos', () => {
		expect(canSubmitConcept(P2P_CONCEPT.ascensoPatrocinador, '')).toBe(false);
		expect(canSubmitConcept(P2P_CONCEPT.ascensoPatrocinador, null)).toBe(false);
		expect(canSubmitConcept(P2P_CONCEPT.ascensoPatrocinador, 'inventado')).toBe(false);
	});
});

describe('validateReceipt', () => {
	it('acepta JPG, PNG, WebP y PDF dentro del límite', () => {
		for (const type of ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']) {
			expect(validateReceipt({ type, size: 1024 })).toBeNull();
		}
	});

	it('rechaza cuando no hay archivo', () => {
		expect(validateReceipt(null)).toBe('Adjunta el comprobante del pago.');
		expect(validateReceipt({ type: 'image/png', size: 0 })).toBe('Adjunta el comprobante del pago.');
	});

	it('rechaza tipos no admitidos', () => {
		expect(validateReceipt({ type: 'application/zip', size: 100 })).toBe(
			'El comprobante debe ser JPG, PNG, WebP o PDF.'
		);
		expect(validateReceipt({ type: 'text/html', size: 100 })).toBe(
			'El comprobante debe ser JPG, PNG, WebP o PDF.'
		);
	});

	it('rechaza lo que supera 3 MB', () => {
		expect(validateReceipt({ type: 'image/png', size: MAX_RECEIPT_BYTES })).toBeNull();
		expect(validateReceipt({ type: 'image/png', size: MAX_RECEIPT_BYTES + 1 })).toBe(
			'El comprobante supera el límite de 3 MB.'
		);
	});
});

describe('normalizeReceiptReference', () => {
	it('recorta y colapsa espacios', () => {
		expect(normalizeReceiptReference('  123  456  ')).toBe('123 456');
	});

	it('acepta vacío (el campo es opcional)', () => {
		expect(normalizeReceiptReference('')).toBe('');
		expect(normalizeReceiptReference(undefined)).toBe('');
	});

	it('acota la longitud', () => {
		expect(normalizeReceiptReference('a'.repeat(500))).toHaveLength(60);
	});
});

describe('P2P_STATUS_TONE', () => {
	it('asigna un color distinto a cada estado', () => {
		expect(P2P_STATUS_TONE[P2P_STATUS.pendiente]).toBe('pending');
		expect(P2P_STATUS_TONE[P2P_STATUS.aprobado]).toBe('approved');
		expect(P2P_STATUS_TONE[P2P_STATUS.rechazado]).toBe('rejected');
	});
});
