import type { APIRoute } from 'astro';
import { validateSession } from '../../lib/session';
import { updateSheetUserDocument } from '../../lib/sheets';
import {
	uploadIdentityDocument,
	ALLOWED_DOCUMENT_TYPES,
	MAX_DOCUMENT_BYTES,
	DOCUMENT_STATUS,
} from '../../lib/testimonials';
import { ImageStorageNotConfiguredError } from '../../lib/image-storage';

export const prerender = false;

export const POST: APIRoute = async (Astro) => {
	// `fail` debe vivir dentro del handler: `Astro` solo existe en este ámbito
	const fail = (msg: string) =>
		Astro.redirect('/dashboard?doc=error&msg=' + encodeURIComponent(msg), 303);

	try {
		const token = Astro.cookies.get('auth_session')?.value;
		const session = validateSession(token);
		if (!session) {
			return Astro.redirect('/login', 303);
		}

		const formData = await Astro.request.formData();
		const file = formData.get('documento');
		const documentType = String(formData.get('tipoDocumento') || '').trim();
		const documentNumber = String(formData.get('numeroDocumento') || '').trim();

		if (!(file instanceof File) || file.size === 0) {
			return fail('Selecciona un archivo para subir.');
		}
		if (!ALLOWED_DOCUMENT_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_TYPES)[number])) {
			return fail('Formato no permitido. Usa JPG, PNG, WEBP o PDF.');
		}
		if (file.size > MAX_DOCUMENT_BYTES) {
			return fail('El documento supera el límite de 5 MB.');
		}
		if (documentNumber.length < 5) {
			return fail('Escribe el número de documento (mínimo 5 caracteres).');
		}

		const buffer = Buffer.from(await file.arrayBuffer());

		let stored;
		try {
			stored = await uploadIdentityDocument(
				session.username,
				file.name,
				buffer,
				file.type
			);
		} catch (err) {
			const reason =
				err instanceof ImageStorageNotConfiguredError
					? 'El almacenamiento de documentos no está configurado en el servidor.'
					: 'No se pudo guardar el archivo. Inténtalo de nuevo.';
			console.error('Error al subir el documento:', err);
			return Astro.redirect(
				'/dashboard?doc=' + (err instanceof ImageStorageNotConfiguredError ? 'config' : 'error') +
					'&msg=' + encodeURIComponent(reason),
				303
			);
		}

		const updated = await updateSheetUserDocument(session.username, {
			documentType: documentType || 'Cédula',
			documentNumber,
			// Cada nueva subida vuelve a quedar pendiente de revisión
			documentStatus: DOCUMENT_STATUS.pendiente,
			documentLink: stored.url,
			scannedDocument: file.name,
		});

		if (!updated) {
			return fail('No se encontró tu registro para guardar el documento.');
		}

		return Astro.redirect('/dashboard?doc=ok', 303);
	} catch (err) {
		console.error('Error al procesar el documento:', err);
		return Astro.redirect(
			'/dashboard?doc=error&msg=' +
				encodeURIComponent('No se pudo guardar tu documento. Inténtalo de nuevo.'),
			303
		);
	}
};
