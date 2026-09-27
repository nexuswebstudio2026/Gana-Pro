import type { APIRoute } from 'astro';
import { validateSession } from '../../lib/session';
import { ensureUserDocumentColumns, updateSheetUserDocument } from '../../lib/sheets';
import {
	uploadIdentityDocument,
	uploadRutDocument,
	esNitValido,
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
		const nit = String(formData.get('nit') || '').trim();
		const rutFile = formData.get('rut');

		// El RUT es opcional: si no se adjunta, solo se procesa el documento.
		const tieneRut = rutFile instanceof File && rutFile.size > 0;

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
		if (!nit) {
			return fail('Escribe tu NIT.');
		}
		if (!esNitValido(nit)) {
			return fail('El NIT solo admite números, entre 6 y 20 dígitos.');
		}
		if (tieneRut) {
			const tipoRut = (rutFile as File).type;
			if (!ALLOWED_DOCUMENT_TYPES.includes(tipoRut as (typeof ALLOWED_DOCUMENT_TYPES)[number])) {
				return fail('El RUT debe ser JPG, PNG, WEBP o PDF.');
			}
			if ((rutFile as File).size > MAX_DOCUMENT_BYTES) {
				return fail('El RUT supera el límite de 5 MB.');
			}
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

		// El RUT se guarda aparte; si falla, el documento principal no se pierde.
		let rutLink = '';
		let scannedRut = '';
		if (tieneRut) {
			try {
				const f = rutFile as File;
				const rutBuffer = Buffer.from(await f.arrayBuffer());
				const storedRut = await uploadRutDocument(session.username, f.name, rutBuffer, f.type);
				rutLink = storedRut.url;
				scannedRut = f.name;
			} catch (err) {
				console.error('Error al subir el RUT:', err);
				return Astro.redirect(
					'/dashboard?doc=error&msg=' +
						encodeURIComponent('El documento se guardó, pero el RUT no pudo subirse. Inténtalo de nuevo.'),
					303
				);
			}
		}

		// La hoja debe tener las columnas de NIT y RUT antes de escribir: si
		// faltan, se crean aquí para que la carga del RUT no se pierda.
		try {
			await ensureUserDocumentColumns();
		} catch (err) {
			console.error('No se pudieron preparar las columnas de NIT/RUT:', err);
		}

		const updated = await updateSheetUserDocument(session.username, {
			documentType: documentType || 'Cédula',
			documentNumber,
			// Cada nueva subida vuelve a quedar pendiente de revisión
			documentStatus: DOCUMENT_STATUS.pendiente,
			documentLink: stored.url,
			scannedDocument: file.name,
			nit,
			...(tieneRut ? { rutLink, scannedRut } : {}),
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
