import type { APIRoute } from 'astro';
import { lookupReferrer, ownCodeOf } from '../../lib/referrals';

export const prerender = false;

export const GET: APIRoute = async ({ url }) => {
	const ref = (url.searchParams.get('ref') ?? '').trim().slice(0, 60);
	if (!ref) {
		return new Response(JSON.stringify({ valid: false, reason: 'empty' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}

	const lookup = await lookupReferrer(ref);
	if (lookup.status === 'found') {
		const ownCode = ownCodeOf(lookup.user) || lookup.user.username || ref;
		return new Response(
			JSON.stringify({
				valid: true,
				username: lookup.user.username,
				ownCode,
			}),
			{
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}

	return new Response(
		JSON.stringify({
			valid: false,
			reason: lookup.status,
		}),
		{
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		}
	);
};
