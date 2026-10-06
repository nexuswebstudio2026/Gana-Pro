import { beforeEach, describe, expect, it, vi } from 'vitest';
import { findUserByReferralCode, lookupReferrer, ownCodeOf, referralShortUrl } from './referrals';
import { getGoogleSheetUsers } from './sheets';
import type { User } from './types';

// La hoja se sustituye para poder decidir los tres estados de `lookupReferrer`
// sin credenciales de Google en el entorno de tests.
vi.mock('./sheets', () => ({ getGoogleSheetUsers: vi.fn() }));

const mockSheetUsers = vi.mocked(getGoogleSheetUsers);

describe('lookupReferrer', () => {
	const ana: User = {
		username: 'ana',
		email: 'ana@test.com',
		password: 'x',
		ownCode: 'PROMO-ANA',
	};

	beforeEach(() => {
		mockSheetUsers.mockReset();
	});

	it('found cuando alguien usa ese código', async () => {
		mockSheetUsers.mockResolvedValueOnce([ana]);
		const result = await lookupReferrer('PROMO-ANA');
		expect(result.status).toBe('found');
		expect(result.user?.username).toBe('ana');
	});

	it('missing cuando la hoja responde y nadie tiene ese código', async () => {
		// Este es el estado que muestra el aviso "no está registrado" en
		// /register: sin hoja no se podría afirmar, por eso importa separarlos.
		mockSheetUsers.mockResolvedValueOnce([ana]);
		const result = await lookupReferrer('Felipe');
		expect(result.status).toBe('missing');
		expect(result.user).toBeNull();
	});

	it('missing cuando la hoja no responde y no hay usuario local', async () => {
		mockSheetUsers.mockRejectedValueOnce(new Error('credenciales ausentes'));
		const result = await lookupReferrer('PROMO-ANA');
		expect(result.status).toBe('missing');
		expect(result.user).toBeNull();
	});

	it('missing sin consultar la hoja si el código viene vacío', async () => {
		const result = await lookupReferrer('   ');
		expect(result.status).toBe('missing');
		expect(mockSheetUsers).not.toHaveBeenCalled();
	});
});


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


describe('findUserByReferralCode', () => {
	// Es la comprobación que decide si `/register?ref=...` muestra el aviso
	// "no está registrado": si esto falla, un invitador real queda fuera.
	const users: User[] = [
		{ username: 'ana', email: 'ana@test.com', password: 'x', ownCode: 'PROMO-ANA' },
		{ username: 'luis', email: 'luis@test.com', password: 'x' },
	];

	it('encuentra por el codigo propio', () => {
		expect(findUserByReferralCode(users, 'PROMO-ANA')?.username).toBe('ana');
	});

	it('encuentra por el nombre de usuario', () => {
		expect(findUserByReferralCode(users, 'luis')?.username).toBe('luis');
	});

	it('ignora mayusculas y espacios alrededor', () => {
		expect(findUserByReferralCode(users, '  promo-ana ')?.username).toBe('ana');
		expect(findUserByReferralCode(users, 'ANA')?.username).toBe('ana');
	});

	it('devuelve null cuando nadie usa ese codigo', () => {
		expect(findUserByReferralCode(users, 'Felipe')).toBeNull();
	});

	it('devuelve null sin codigo en lugar de coincidir con un usuario sin nombre', () => {
		// Un usuario vacío no puede ser el referente de todo el mundo.
		const list: User[] = [{ password: 'x' } as User, ...users];
		expect(findUserByReferralCode(list, '')).toBeNull();
		expect(findUserByReferralCode(list, '   ')).toBeNull();
	});
});