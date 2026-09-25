// @ts-check
import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
	output: 'server',
	adapter: vercel(),
	vite: {
		ssr: {
			// Workaround for https://github.com/withastro/astro/issues/15839
			// The Vercel adapter's entrypoint (@astrojs/vercel/entrypoint) is
			// incorrectly treated as external, causing:
			//   [UNRESOLVED_ENTRY] Entry module "@astrojs/vercel/entrypoint" cannot be external.
			// This was fixed upstream in PR #15670 (closed without merge) and
			// PR #15868. We apply the fix locally here.
			noExternal: ['@astrojs/vercel'],
		},
	},
});
