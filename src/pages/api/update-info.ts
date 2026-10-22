import type { APIRoute } from 'astro';
import { readFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

export const prerender = false;

/**
 * Tries to read the last commit information from the local git repository.
 * Falls back to a static placeholder if git is unavailable.
 */
function getLastCommitLocal(): { message: string; date: string; hash: string } | null {
	try {
		// Try using git via child_process
		const message = execSync('git log -1 --pretty=format:"%s"', { cwd: process.cwd(), timeout: 3000 })
			.toString()
			.trim()
			.replace(/^"|"$/g, '');
		const date = execSync('git log -1 --pretty=format:"%ci"', { cwd: process.cwd(), timeout: 3000 })
			.toString()
			.trim();
		const hash = execSync('git log -1 --pretty=format:"%h"', { cwd: process.cwd(), timeout: 3000 })
			.toString()
			.trim();

		return { message, date, hash };
	} catch {
		// If git CLI is not available, read from packed-refs / git objects
		try {
			const packedRefsPath = join(process.cwd(), '.git', 'packed-refs');
			const packedRefs = readFileSync(packedRefsPath, 'utf-8');
			const match = packedRefs.match(/^([a-f0-9]{40})\s+refs\/remotes\/origin\/main$/m)
				|| packedRefs.match(/^([a-f0-9]{40})\s+refs\/heads\/main$/m);
			if (match) {
				return { message: '', date: '', hash: match[1].slice(0, 7) };
			}
		} catch {
			// ignore
		}
		return null;
	}
}

export const GET: APIRoute = async () => {
	const GITHUB_REPO = 'nexuswebstudio2026/Gana-Pro';
	const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/commits/main`;

	try {
		const resp = await fetch(GITHUB_API, {
			headers: {
				'Accept': 'application/vnd.github+json',
				'User-Agent': 'gana-pro-app',
				// Add a GitHub token from env if available to avoid rate limits
				...(process.env.GITHUB_TOKEN ? { 'Authorization': `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
			},
			signal: AbortSignal.timeout(5000),
		});

		if (!resp.ok) throw new Error(`GitHub API error: ${resp.status}`);

		const data = await resp.json() as {
			sha: string;
			commit: {
				message: string;
				author: { name: string; date: string };
			};
		};

		const fullMessage = data.commit.message;
		// Use only the first line of the commit message (the title)
		const title = fullMessage.split('\n')[0].trim();
		const dateRaw = data.commit.author.date;
		const date = new Date(dateRaw);

		return new Response(JSON.stringify({
			hash: data.sha.slice(0, 7),
			message: title,
			author: data.commit.author.name,
			date: date.toLocaleDateString('es-ES', {
				year: 'numeric',
				month: 'long',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit',
			}),
			dateIso: dateRaw,
		}), {
			status: 200,
			headers: {
				'Content-Type': 'application/json',
				// Cache for 5 minutes so we don't hammer GitHub API
				'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
			},
		});
	} catch {
		// Fallback: try to read from local git
		const local = getLastCommitLocal();
		if (local && local.message) {
			return new Response(JSON.stringify({
				hash: local.hash,
				message: local.message,
				author: 'GANA PRO',
				date: local.date ? new Date(local.date).toLocaleDateString('es-ES', {
					year: 'numeric', month: 'long', day: 'numeric',
				}) : new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }),
				dateIso: local.date || new Date().toISOString(),
			}), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}

		// Final fallback
		return new Response(JSON.stringify({
			hash: local?.hash ?? 'latest',
			message: 'Última actualización disponible',
			author: 'GANA PRO',
			date: new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' }),
			dateIso: new Date().toISOString(),
		}), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}
};
