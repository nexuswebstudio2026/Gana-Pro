import type { APIRoute } from 'astro';

export const prerender = false;

export const GET: APIRoute = async () => {
	const GITHUB_REPO = 'nexuswebstudio2026/Gana-Pro';
	const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/commits/main`;

	const headers: Record<string, string> = {
		'Accept': 'application/vnd.github+json',
		'User-Agent': 'gana-pro-app/1.0',
	};

	// Usar token si está disponible (aumenta límite de 60 a 5000 req/hora)
	const token = process.env.GITHUB_TOKEN;
	if (token) {
		headers['Authorization'] = `Bearer ${token}`;
	}

	try {
		const resp = await fetch(GITHUB_API, {
			headers,
			signal: AbortSignal.timeout(6000),
		});

		if (!resp.ok) {
			throw new Error(`GitHub respondió con ${resp.status}: ${resp.statusText}`);
		}

		const data = await resp.json() as {
			sha: string;
			commit: {
				message: string;
				author: { name: string; date: string };
			};
		};

		// Solo la primera línea del mensaje (el título del commit)
		const message = data.commit.message.split('\n')[0].trim();
		const dateRaw = data.commit.author.date;
		const date = new Date(dateRaw).toLocaleDateString('es-ES', {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
		});

		return new Response(
			JSON.stringify({
				ok: true,
				hash: data.sha.slice(0, 7),
				message,
				author: data.commit.author.name,
				date,
				dateIso: dateRaw,
			}),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
					'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
				},
			}
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[update-info] Error al obtener commit de GitHub:', message);

		// Respuesta de fallback — el popup sigue funcionando aunque sin datos reales
		return new Response(
			JSON.stringify({
				ok: false,
				hash: 'latest',
				message: 'Update App V. 1.1.0.8',
				author: 'GANA PRO',
				date: new Date().toLocaleDateString('es-ES', {
					year: 'numeric',
					month: 'long',
					day: 'numeric',
				}),
				dateIso: new Date().toISOString(),
				error: message,
			}),
			{
				status: 200, // 200 para que el cliente no caiga en el catch
				headers: { 'Content-Type': 'application/json' },
			}
		);
	}
};
