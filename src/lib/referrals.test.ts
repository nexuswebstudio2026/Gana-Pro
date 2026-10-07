import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGoogleSheetUsers } from './sheets';
import { getReferralStats, lookupReferrer } from './referrals';

vi.mock('./sheets', () => ({
	getGoogleSheetUsers: vi.fn(),
}));

const user = {
	username: 'Felipe',
	email: 'felipe@example.com',
	password: 'hash',
	ownCode: 'CodigoFelipe',
};

describe('lookupReferrer', () => {
	beforeEach(() => {
		vi.mocked(getGoogleSheetUsers).mockReset();
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('does not match a referral code against a non-username column', async () => {
		vi.mocked(getGoogleSheetUsers).mockResolvedValue([user]);

		await expect(lookupReferrer('felipe@example.com')).resolves.toEqual({
			status: 'missing',
			user: null,
		});
	});

	it('finds a referral only by the username stored in Google Sheets', async () => {
		vi.mocked(getGoogleSheetUsers).mockResolvedValue([user]);

		await expect(lookupReferrer('felipe')).resolves.toEqual({
			status: 'found',
			user,
		});
		await expect(lookupReferrer('CodigoFelipe')).resolves.toEqual({
			status: 'missing',
			user: null,
		});
		await expect(lookupReferrer('Felipe')).resolves.toEqual({
			status: 'found',
			user,
		});
		await expect(lookupReferrer('NoRegistrado')).resolves.toEqual({
			status: 'missing',
			user: null,
		});
	});

	it('reports a code as unavailable when Google Sheets cannot be read', async () => {
		vi.mocked(getGoogleSheetUsers).mockRejectedValue(new Error('Sheets unavailable'));
		vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(lookupReferrer('Felipe')).resolves.toEqual({
			status: 'unavailable',
			user: null,
		});
	});

	it('builds the shared referral link from the Google Sheets username', async () => {
		vi.mocked(getGoogleSheetUsers).mockResolvedValue([
			{
				username: 'NuevoUsuario',
				email: 'nuevo@example.com',
				password: 'hash',
				referralCode: 'CodigoFelipe',
				ownCode: 'CodigoNuevo',
			},
		]);

		const stats = await getReferralStats(user, 'https://ganapro.org');

		expect(stats.ownCode).toBe('Felipe');
		expect(stats.shareUrl).toBe('https://ganapro.org/r/Felipe');
		expect(stats.count).toBe(1);
	});
});
