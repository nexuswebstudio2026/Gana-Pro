import type { APIRoute } from 'astro';
import { isIP } from 'node:net';
import { isValidCoordinates, saveVisitorAccess } from '../../lib/location';

export const prerender = false;

function headerValue(request: Request, ...names: string[]): string {
	for (const name of names) {
		const value = request.headers.get(name)?.trim();
		if (value) return value;
	}
	return '';
}

function decodeGeoHeader(value: string): string {
	try { return decodeURIComponent(value).slice(0, 100); }
	catch { return value.slice(0, 100); }
}

function visitorCookie(request: Request): string {
	const cookie = request.headers.get('cookie') || '';
	const value = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith('gana_visitor_id='))?.slice('gana_visitor_id='.length);
	try {
		const id = decodeURIComponent(value || '');
		return /^[\da-f-]{20,64}$/i.test(id) ? id : '';
	} catch { return ''; }
}

export const POST: APIRoute = async ({ request, locals, clientAddress }) => {
	try {
		const body = await request.json().catch(() => null) as {
			consent?: unknown;
			visitorId?: unknown;
			latitude?: unknown;
			longitude?: unknown;
			accuracy?: unknown;
		} | null;
		if (body?.consent !== true || typeof body.visitorId !== 'string' || !/^[\da-f-]{20,64}$/i.test(body.visitorId)) {
			return Response.json({ ok: false, error: 'Se requiere aceptar el acceso confidencial.' }, { status: 400 });
		}
		const hasClientCoordinates = body.latitude !== undefined || body.longitude !== undefined;
		if (hasClientCoordinates && !isValidCoordinates(body.latitude, body.longitude)) {
			return Response.json({ ok: false, error: 'No recibimos coordenadas válidas. Permite el acceso a la ubicación e inténtalo de nuevo.' }, { status: 400 });
		}

		// Vercel/Cloudflare provide the client address directly. The fallback
		// supports local development behind a conventional reverse proxy.
		const forwarded = headerValue(request, 'x-vercel-forwarded-for', 'cf-connecting-ip', 'x-real-ip', 'x-forwarded-for');
		const ip = forwarded.split(',')[0]?.trim() || clientAddress || '';
		if (!ip || !isIP(ip)) {
			return Response.json({ ok: false, error: 'No pudimos identificar la IP de esta conexión.' }, { status: 400 });
		}

		const city = decodeGeoHeader(headerValue(request, 'x-vercel-ip-city', 'cf-ipcity'));
		const region = decodeGeoHeader(headerValue(request, 'x-vercel-ip-country-region'));
		const country = headerValue(request, 'x-vercel-ip-country', 'cf-ipcountry').slice(0, 100);
		const rawHeaderLat = headerValue(request, 'x-vercel-ip-latitude');
		const rawHeaderLng = headerValue(request, 'x-vercel-ip-longitude');
		const headerLat = Number(rawHeaderLat);
		const headerLng = Number(rawHeaderLng);
		const hasHeaderCoordinates = Boolean(rawHeaderLat && rawHeaderLng) && isValidCoordinates(headerLat, headerLng);
		const latitude = hasClientCoordinates ? Number(body.latitude) : hasHeaderCoordinates ? headerLat : undefined;
		const longitude = hasClientCoordinates ? Number(body.longitude) : hasHeaderCoordinates ? headerLng : undefined;
		const accuracy = Number(body.accuracy);
		const stableVisitorId = visitorCookie(request) || body.visitorId;
		await saveVisitorAccess({
			ip, city, region, country, visitorId: stableVisitorId,
			...(latitude !== undefined && longitude !== undefined ? { latitude, longitude } : {}),
			...(Number.isFinite(accuracy) && accuracy >= 0 ? { accuracy } : {}),
			source: hasClientCoordinates ? 'GPS' : hasHeaderCoordinates ? 'IP' : 'IP sin coordenadas',
		}, locals.user ?? undefined);
		const response = Response.json({ ok: true, hasPreciseLocation: hasClientCoordinates, hasLocationEstimate: hasHeaderCoordinates });
		if (!visitorCookie(request)) {
			const secure = new URL(request.url).protocol === 'https:' ? '; Secure' : '';
			response.headers.append('Set-Cookie', `gana_visitor_id=${encodeURIComponent(stableVisitorId)}; Path=/; Max-Age=31536000; SameSite=Lax; HttpOnly${secure}`);
		}
		return response;
	} catch (error) {
		console.error('No se pudo registrar el acceso confidencial:', error);
		const cause = error as { code?: string | number; response?: { status?: number } };
		const message = error instanceof Error ? error.message : '';
		const status = Number(cause?.response?.status ?? cause?.code);
		let detail = 'Google Sheets no pudo guardar el registro. Inténtalo de nuevo.';
		if (/credenciales de google service account/i.test(message)) detail = 'Faltan las credenciales de Google Sheets en el servidor.';
		else if (status === 403) detail = 'La cuenta de servicio no tiene permiso para editar esta hoja de cálculo.';
		else if (status === 404) detail = 'No se encontró la hoja de cálculo o la pestaña Ubicacion.';
		else if (status === 400) detail = 'Google Sheets rechazó el rango o los encabezados de la pestaña Ubicacion.';
		else if (status === 429 || status >= 500) detail = 'Google Sheets no está disponible en este momento. Inténtalo de nuevo.';
		return Response.json({ ok: false, error: detail }, { status: 500 });
	}
};
