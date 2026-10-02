import type { APIRoute } from 'astro';
import {
	appendTestimonial,
	uploadTestimonialImage,
	ALLOWED_IMAGE_TYPES,
	MAX_IMAGE_BYTES,
} from '../../lib/testimonials';
import { ImageStorageNotConfiguredError } from '../../lib/image-storage';
import { getUserLevel } from '../../lib/users';


export const prerender = false;

/**
 * Caracteres que se eliminan del texto antes de guardarlo.
 *
 * Se quitan los de control (nulos, ESC de ANSI) y los bidireccionales, que
 * pueden hacer que un texto parezca decir lo contrario de lo que dice. No es
 * una defensa contra XSS -Astro escapa al pintar- : es para que la hoja no se
 * llene de basura que nadie puede leer ni moderar.
 */
const CONTROL_CHARS = /[\u0000-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

/** Limpia el texto: quita lo anterior, aplana el espacio y recorta. */
function sanitizeText(value: string): string {
	return value.replace(CONTROL_CHARS, '').replace(/\s+/g, ' ').trim();
}

const MAX_COMMENT_LENGTH = 1200;

export const POST: APIRoute = async (Astro) => {
	try {
		// Solo usuarios con sesión activa pueden enviar testimonios
		const session = Astro.locals.user;
		if (!session) {
			return Astro.redirect('/valoraciones', 303);
		}

		// El formulario va multipart (para la imagen)
		const formData = await Astro.request.formData();
		const rating = Number(formData.get('rating'));
		const comment = sanitizeText(String(formData.get('comment') || ''));
		const file = formData.get('image');

		// Los parámetros van ANTES del fragmento (#), si no el navegador
		// los ignora y el mensaje nunca se muestra en la página.
		const fail = (msg: string) =>
			Astro.redirect('/valoraciones?error=' + encodeURIComponent(msg), 303);

		if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
			return fail('Selecciona una valoración entre 1 y 5 estrellas.');
		}

		if (comment.length < 10) {
			return fail('El testimonio debe tener al menos 10 caracteres.');
		}
		if (comment.length > MAX_COMMENT_LENGTH) {
			return fail(`El testimonio no puede superar los ${MAX_COMMENT_LENGTH} caracteres.`);
		}

		// --- Imagen opcional ---
		let imageName = '';
		let imageId = '';
		let imageUrl = '';
		let imageFolder = '';
		/** Motivo por el que no se pudo guardar la imagen ('' = todo correcto). */
		let imageProblem: 'config' | 'upload' | '' = '';

		if (file instanceof File && file.size > 0) {
			if (!ALLOWED_IMAGE_TYPES.includes(file.type as (typeof ALLOWED_IMAGE_TYPES)[number])) {
				return fail('Formato de imagen no permitido. Usa JPG, PNG, WEBP o GIF.');
			}
			if (file.size > MAX_IMAGE_BYTES) {
				return fail('La imagen supera el límite de 5 MB.');
			}

			const buffer = Buffer.from(await file.arrayBuffer());
			try {
				const stored = await uploadTestimonialImage(file.name, buffer, file.type);
				imageName = file.name;
				imageId = stored.id;
				imageUrl = stored.url;
				imageFolder = stored.folder;
			} catch (imgErr) {
				// La imagen es opcional: si falla el almacenamiento se publica
				// el testimonio igual y se avisa al usuario.
				imageProblem =
					imgErr instanceof ImageStorageNotConfiguredError ? 'config' : 'upload';
				console.error(
					'No se pudo subir la imagen del testimonio:',
					imgErr instanceof Error ? imgErr.message : String(imgErr)
				);
			}
		}

		// El testimonio guarda el nivel que tiene el usuario en este momento
		const level = await getUserLevel(session.username, session.email);

		await appendTestimonial({
			username: session.username,
			email: session.email,
			level,
			rating: Math.round(rating),
			comment,
			imageName,
			imageId,
			imageUrl,
			imageFolder,
		});

		return Astro.redirect(
			'/valoraciones?ok=1' + (imageProblem ? `&imagen=${imageProblem}` : ''),
			303
		);

	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('Error al enviar testimonio:', msg);
		return Astro.redirect(
			'/valoraciones?error=' +
				encodeURIComponent('No se pudo guardar tu testimonio. Inténtalo de nuevo.'),
			303
		);
	}
};