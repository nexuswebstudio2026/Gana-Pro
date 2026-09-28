import type { APIRoute } from 'astro';
import { validateSession } from '../../../lib/session';
import {
	ensureUserDocumentColumns,
	getGoogleSheetUsers,
	updateSheetUserDocument,
} from '../../../lib/sheets';
import {
	DOCUMENT_STATUS,
	uploadRutDocument,
	esNitValido,
	ALLOWED_DOCUMENT_TYPES,
	MAX_DOCUMENT_BYTES,
} from '../../../lib/testimonials';
import { ImageStorageNotConfiguredError } from '../../../lib/image-storage';

export const prerender = false;

const VALID_STATUS = [
	DOCUMENT_STATUS.aprobado,
	DOCUMENT_STATUS.rechazado,
	DOCUMENT_STATUS.pendiente,
] as const;

/** Sección del panel a la que se vuelve tras cada operación. */
const ADMIN_DOCUMENTS_URL = '/dashboard/usuarios-registrados';

export const POST: APIRoute = async (Astro) => {
	// `fail` y `done` deben vivir dentro del handler: `Astro` solo existe aquí
	const fail = (msg: string) =>
		Astro.redirect(
			`${ADMIN_DOCUMENTS_URL}?review=error&msg=` + encodeURIComponent(msg),
			303
		);
	const done = (msg: string) =>
		Astro.redirect(
			`${ADMIN_DOCUMENTS_URL}?review=ok&msg=` + encodeURIComponent(msg),
			303
		);

	try {
		const token = Astro.cookies.get('auth_session')?.value;
		const session = validateSession(token);
		if (!session) return Astro.redirect('/login', 303);

		// Solo un administrador puede aprobar, rechazar o cargar el RUT de un usuario
		const role = (session.role || '').trim().toLowerCase();
		if (role !== 'admin' && role !== 'administrator') {
			return new Response('Sin permisos', { status: 403 });
		}

		const formData = await Astro.request.formData();
		const username = String(formData.get('username') || '').trim();
		if (!username) {
			return fail('No se indicó el usuario al que aplicar el cambio.');
		}

		const existingUser = (await getGoogleSheetUsers()).find(
			(user) => user.username.trim().toLowerCase() === username.toLowerCase()
		);
		if ((existingUser?.documentStatus || '').trim() === DOCUMENT_STATUS.aprobado) {
			return fail('Este documento ya fue aprobado y no admite más cambios.');
		}

		const status = String(formData.get('status') || '').trim();
		const nit = String(formData.get('nit') || '').trim();
		const rutFile = formData.get('rut');
		const tieneRut = rutFile instanceof File && rutFile.size > 0;

		// --- 1. Carga del RUT emitido por la DIAN ---
		if (tieneRut) {
			const file = rutFile as File;
			if (!ALLOWED_DOCUMENT_TYPES.includes(file.type as (typeof ALLOWED_DOCUMENT_TYPES)[number])) {
				return fail('El RUT debe ser JPG, PNG, WEBP o PDF.');
			}
			if (file.size > MAX_DOCUMENT_BYTES) {
				return fail('El RUT supera el límite de 5 MB.');
			}
			// Si el formulario trae NIT, se valida antes de tocar nada.
			if (nit && !esNitValido(nit)) {
				return fail('El NIT solo admite números, entre 6 y 20 dígitos.');
			}

			let stored;
			try {
				stored = await uploadRutDocument(
					username,
					file.name,
					Buffer.from(await file.arrayBuffer()),
					file.type
				);
			} catch (err) {
				console.error('Error al subir el RUT desde el panel:', err);
				const reason =
					err instanceof ImageStorageNotConfiguredError
						? 'El almacenamiento de documentos no está configurado en el servidor.'
						: 'No se pudo guardar el RUT. Inténtalo de nuevo.';
				return fail(reason);
			}

			// La hoja debe tener las columnas de NIT y RUT antes de escribir: si
			// faltan, se crean aquí para que la carga del RUT no se pierda.
			try {
				await ensureUserDocumentColumns();
			} catch (err) {
				console.error('No se pudieron preparar las columnas de NIT/RUT:', err);
			}

			const updated = await updateSheetUserDocument(username, {
				rutLink: stored.url,
				scannedRut: file.name,
				...(nit ? { nit } : {}),
			});
			if (!updated) {
				return fail(
					`El RUT se guardó, pero no se encontró la fila de ${username} en Google Sheets ` +
						'(se esperaban las columnas NIT, Escaneado RUT y Enlace RUT).'
				);
			}
			return done(
				`RUT cargado para ${username}${nit ? ` · NIT ${nit}` : ''}.`
			);
		}

		// --- 2. Actualización del NIT (sin archivo adjunto) ---
		if (nit) {
			if (!esNitValido(nit)) {
				return fail('El NIT solo admite números, entre 6 y 20 dígitos.');
			}
			try {
				await ensureUserDocumentColumns();
			} catch (err) {
				console.error('No se pudieron preparar las columnas de NIT/RUT:', err);
			}
			const updated = await updateSheetUserDocument(username, { nit });
			if (!updated) {
				return fail(`No se encontró la fila de ${username} en la hoja de usuarios.`);
			}
			return done(`NIT de ${username} actualizado a ${nit}.`);
		}

		// --- 3. Aprobación / rechazo del documento de identidad ---
		if (!status) {
			return fail('Indica el NIT o adjunta el RUT que quieres guardar.');
		}
		if (!VALID_STATUS.includes(status as (typeof VALID_STATUS)[number])) {
			return fail('El estado indicado no es válido.');
		}

		const updated = await updateSheetUserDocument(username, { documentStatus: status });
		if (!updated) {
			return fail(`No se encontró el registro de ${username}.`);
		}
		return done(`Documento de ${username} marcado como ${status}.`);
	} catch (err) {
		console.error('Error al procesar la revisión documental:', err);
		return fail('No se pudo completar la operación. Inténtalo de nuevo.');
	}
};
