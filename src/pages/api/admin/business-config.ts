import type { APIRoute } from 'astro';
import { validateSession } from '../../../lib/session';
import { getBusinessSettings, saveBusinessSettings } from '../../../lib/business-settings';
import {
	ALLOWED_DOCUMENT_TYPES,
	MAX_DOCUMENT_BYTES,
	esNitValido,
} from '../../../lib/testimonials';
import { ImageStorageNotConfiguredError, saveFile } from '../../../lib/image-storage';

export const prerender = false;

const BUSINESS_SETTINGS_URL = '/dashboard/negocio';

export const POST: APIRoute = async (Astro) => {
	const fail = (message: string) =>
		Astro.redirect(`${BUSINESS_SETTINGS_URL}?business=error&msg=${encodeURIComponent(message)}`, 303);
	const done = (message: string) =>
		Astro.redirect(`${BUSINESS_SETTINGS_URL}?business=ok&msg=${encodeURIComponent(message)}`, 303);

	try {
		const session = validateSession(Astro.cookies.get('auth_session')?.value);
		if (!session) return Astro.redirect('/login', 303);

		const role = (session.role || '').trim().toLowerCase();
		if (role !== 'admin' && role !== 'administrator') {
			return new Response('Sin permisos', { status: 403 });
		}

		const formData = await Astro.request.formData();
		const nit = String(formData.get('nit') || '').trim();
		const rawFile = formData.get('rut');
		const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;

		if (!esNitValido(nit)) {
			return fail('El NIT debe tener solo números y entre 6 y 20 dígitos.');
		}

		const existingSettings = await getBusinessSettings();
		if (!file && !existingSettings) {
			return fail('Selecciona el archivo del RUT empresarial.');
		}

		let rutLink = existingSettings?.rutLink || '';
		let rutFileName = existingSettings?.rutFileName || '';
		let mimeType = existingSettings?.mimeType || '';

		if (file) {
			if (!(ALLOWED_DOCUMENT_TYPES as readonly string[]).includes(file.type)) {
				return fail('El RUT debe ser JPG, PNG, WEBP o PDF.');
			}
			if (file.size > MAX_DOCUMENT_BYTES) {
				return fail('El RUT supera el límite de 5 MB.');
			}

			try {
				const stored = await saveFile(
					'business-docs',
					`rut_empresarial_${Date.now()}_${file.name}`,
					Buffer.from(await file.arrayBuffer()),
					file.type
				);
				rutLink = stored.url;
				rutFileName = file.name;
				mimeType = file.type;
			} catch (error) {
				console.error('Error al guardar el RUT empresarial:', error);
				return fail(
					error instanceof ImageStorageNotConfiguredError
						? 'El almacenamiento de documentos empresariales no está configurado en el servidor.'
						: 'No se pudo guardar el RUT empresarial. Inténtalo de nuevo.'
				);
			}
		}

		await saveBusinessSettings({ nit, rutLink, rutFileName, mimeType });
		return done('NIT y RUT empresarial guardados correctamente.');
	} catch (error) {
		console.error('Error al guardar la configuración del negocio:', error);
		return fail('No se pudo guardar la configuración. Verifica el acceso a Google Sheets e inténtalo de nuevo.');
	}
};
