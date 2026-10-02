import { describe, expect, it } from 'vitest';
import {
	WALLET_NUMBER_MAX,
	WALLET_TYPE_SUGGESTIONS,
	isValidWalletNumber,
	isValidWalletType,
	normalizeWalletNumber,
	normalizeWalletType,
} from './account-wallet';

describe('tipo y numero de billetera', () => {
	it('normaliza recortando y colapsando espacios', () => {
		expect(normalizeWalletType('  Bre   B  ')).toBe('Bre B');
		expect(normalizeWalletType('Nequi')).toBe('Nequi');
		expect(normalizeWalletNumber('  300  123  4567 ')).toBe('300 123 4567');
	});

	it('recorta al maximo permitido', () => {
		const largo = 'a'.repeat(80);
		expect(normalizeWalletType(largo).length).toBe(30);
		expect(normalizeWalletNumber(largo).length).toBe(WALLET_NUMBER_MAX);
	});

	it('acepta vacio en ambos campos (son opcionales)', () => {
		expect(normalizeWalletType('')).toBe('');
		expect(normalizeWalletNumber('')).toBe('');
		expect(isValidWalletType('')).toBe(true);
		expect(isValidWalletNumber('')).toBe(true);
	});

	it('acepta los tipos de billetera sugeridos', () => {
		for (const tipo of WALLET_TYPE_SUGGESTIONS) {
			expect(isValidWalletType(tipo)).toBe(true);
		}
	});

	it('acepta el numero de un Nequi y el alias de un Bre-B', () => {
		expect(isValidWalletNumber('3001234567')).toBe(true);
		expect(isValidWalletNumber('@DAVINEXUWEBSTUD')).toBe(true);
		expect(isValidWalletNumber('+57 300 123 4567')).toBe(true);
	});

	it('rechaza el numero si es demasiado corto o trae simbolos raros', () => {
		expect(isValidWalletNumber('12')).toBe(false);
		expect(isValidWalletNumber('a'.repeat(WALLET_NUMBER_MAX + 1))).toBe(false);
		expect(isValidWalletNumber('cuenta#secreta')).toBe(false);
	});

	it('rechaza un tipo de billetera con simbolos no permitidos', () => {
		expect(isValidWalletType('Nequi <script>')).toBe(false);
		expect(isValidWalletType('Nequi#')).toBe(false);
	});
});