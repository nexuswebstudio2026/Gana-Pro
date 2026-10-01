/// <reference types="astro/client" />

declare namespace App {
	interface Locals {
		/**
		 * Sesión del usuario que hace la petición, resuelta una sola vez en
		 * `src/middleware.ts`. Es `null` cuando no hay cookie válida, de modo
		 * que las páginas y endpoints no repitan el parseo del token.
		 */
		user: import('./lib/session').Session | null;
	}
}
