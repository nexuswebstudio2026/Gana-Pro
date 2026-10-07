import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getGoogleSheetUsers } from './sheets';
import { readJSON } from './store';
import { lookupReferrer } from './referrals';

vi.mock('./sheets', () => ({
	getGoogleSheetUsers: vi.fn(),
}));

vi.mock('./store', () => ({
	readJSON: vi.fn(),
}));

const user = {
	username: 'Felipe',
	email: 'felipe@example.com',
	password: 'hash',
};

describe('lookupReferrer', () => {
	beforeEach(() => {
		vi.mocked(getGoogleSheetUsers).mockReset();
		vi.mocked(readJSON).mockReset();
		vi.mocked(readJSON).mockReturnValue([]);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('reports an unregistered code when the user list was read successfully', async () => {
		vi.mocked(getGoogleSheetUsers).mockResolvedValue([]);

		await expect(lookupReferrer('Felipe')).resolves.toEqual({
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

	it('still finds a locally stored referrer when Google Sheets is unavailable', async () => {
		vi.mocked(getGoogleSheetUsers).mockRejectedValue(new Error('Sheets unavailable'));
		vi.mocked(readJSON).mockReturnValue([user]);
		vi.spyOn(console, 'error').mockImplementation(() => {});

		await expect(lookupReferrer('felipe')).resolves.toEqual({
			status: 'found',
			user,
		});
	});
});
