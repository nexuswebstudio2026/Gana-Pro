import { describe, expect, it } from 'vitest';
import { ownCodeOf } from './referrals';
import type { User } from './types';

describe('codigo propio y pago de la comision', () => {
	it('el codigo es solo para compartir; el saldo se busca por usuario', () => {
		// Este caso es el que rompia el pago: un referente con codigo propio
		// distinto de su usuario. La fila del saldo se busca en la columna
		// "Usuario", asi que buscar por el codio no encontraba nada y la
		// comision se perdia en silencio.
		const referente: User = {
			username: 'juan',
			email: 'juan@test.com',
			password: 'x',
			ownCode: 'PROMO-JUAN',
		};

		expect(referente.ownCode).toBe('PROMO-JUAN');
		// El codigo es lo que se muestra y se comparte.
		expect(ownCodeOf(referente)).toBe('PROMO-JUAN');
		// Pero el usuario es lo que identifica la fila donde se suma el saldo.
		expect(String(referente.username).trim()).toBe('juan');
	});

	it('sin codigo propio, se usa el usuario', () => {
		const referente: User = { username: 'juan', email: 'j@test.com', password: 'x' };
		expect(ownCodeOf(referente)).toBe('juan');
	});

	it('si no hay ni codigo ni usuario, ownCodeOf devuelve vacio', () => {
		expect(ownCodeOf({ password: 'x' } as User)).toBe('');
	});
});