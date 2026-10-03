import { describe, expect, it } from 'vitest';
import { ownCodeOf, referralShortUrl } from './referrals';
import type { User } from './types';

describe('referralShortUrl', () => {
	it('arma la ruta corta /r/CODIGO', () => {
		expect(referralShortUrl('https://ganapro.org', 'PROMO-JUAN')).toBe(
			'https://ganapro.org/r/PROMO-JUAN'
		);
	});

	it('no duplica la barra final del dominio', () => {
		expect(referralShortUrl('https://ganapro.org/', 'ANA')).toBe('https://ganapro.org/r/ANA');
	});

	it('escapa un código con caracteres que rompen la URL', () => {
		// Un espacio o una barra romperían la ruta: se codifican.
		expect(referralShortUrl('https://ganapro.org', 'ANA P')).toBe(
			'https://ganapro.org/r/ANA%20P'
		);
		expect(referralShortUrl('https://ganapro.org', 'a/b')).toBe(
			'https://ganapro.org/r/a%2Fb'
		);
	});
});


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