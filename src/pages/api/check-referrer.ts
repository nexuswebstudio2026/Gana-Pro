import type { APIRoute } from 'astro';
import { lookupReferrer } from '../../lib/referrals';

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
		const username = lookup.user.username;
		return new Response(
			JSON.stringify({
				valid: true,
				username,
				ownCode: username,
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
