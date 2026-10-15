// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// Vercel exposes the pushed commit title during builds. Embed its version in
// the server bundle so the footer reflects each deployment without hardcoding it.
const commitMessage = process.env.VERCEL_GIT_COMMIT_MESSAGE ?? '';
const appVersion =
	commitMessage.match(/Update App V\.\s*(\d+(?:\.\d+){2,})/i)?.[1] ??
	process.env.npm_package_version ??
	'0.0.1';

// https://astro.build/config
export default defineConfig({
	output: 'server',
	adapter: vercel(),
	vite: {
		define: {
			'import.meta.env.APP_VERSION': JSON.stringify(appVersion),
		},
	},
});
