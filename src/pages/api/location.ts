import type { APIRoute } from 'astro';
import { validateSession } from '../../lib/session';
import { saveUserLocation, isValidCoordinates } from '../../lib/location';

export const prerender = false;

/**
 * Recibe la ubicación del usuario (enviada por el navegador) y la guarda.
 * Se llama en cada inicio de sesión para tener siempre la última posición.
 */
export const POST: APIRoute = async (Astro) => {
	try {
		const token = Astro.cookies.get('auth_session')?.value;
		const session = validateSession(token);
		if (!session) {
			return new Response(JSON.stringify({ ok: false, error: 'Sin sesión' }), { status: 401 });
		}

		const body = await Astro.request.json().catch(() => null);
		if (!body) {
			return new Response(JSON.stringify({ ok: false, error: 'Datos inválidos' }), { status: 400 });
		}

		const { lat, lng, accuracy, source } = body as {
			lat?: unknown;
			lng?: unknown;
			accuracy?: unknown;
			source?: unknown;
		};

		if (!isValidCoordinates(lat, lng)) {
			return new Response(
				JSON.stringify({ ok: false, error: 'Coordenadas no válidas' }),
				{ status: 400 }
			);
		}

		await saveUserLocation(session.username, session.email, {
			lat: Number(lat),
			lng: Number(lng),
			accuracy: accuracy !== undefined ? Number(accuracy) : undefined,
			source: typeof source === 'string' ? source.slice(0, 20) : 'gps',
		});

		return new Response(JSON.stringify({ ok: true }), { status: 200 });
	} catch (err) {
		console.error('Error al guardar la ubicación:', err);
		return new Response(JSON.stringify({ ok: false, error: 'Error del servidor' }), {
			status: 500,
		});
	}
};
