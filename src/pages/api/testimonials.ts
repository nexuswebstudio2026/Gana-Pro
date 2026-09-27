import type { APIRoute } from 'astro';
import { validateSession } from '../../lib/session';
import {
	appendTestimonial,
	uploadTestimonialImage,
	ALLOWED_IMAGE_TYPES,
	MAX_IMAGE_BYTES,
} from '../../lib/testimonials';

export const prerender = false;

const MAX_COMMENT_LENGTH = 1200;

export const POST: APIRoute = async (Astro) => {
	try {
		// Solo usuarios con sesión activa pueden enviar testimonios
		const token = Astro.cookies.get('auth_session')?.value;
		const session = validateSession(token);
		if (!session) {
			return Astro.redirect('/#testimonios', 303);
		}

		// El formulario va multipart (para la imagen)
		const formData = await Astro.request.formData();
		const rating = Number(formData.get('rating'));
		const comment = String(formData.get('comment') || '').trim();
		const file = formData.get('image');

		// Los parámetros van ANTES del fragmento (#), si no el navegador
		// los ignora y el mensaje nunca se muestra en la página.
		const fail = (msg: string) =>
			Astro.redirect('/?error=' + encodeURIComponent(msg) + '#testimonios', 303);

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
		let imageFailed = false;

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
				imageFailed = true;
				console.error(
					'No se pudo subir la imagen del testimonio:',
					imgErr instanceof Error ? imgErr.message : String(imgErr)
				);
			}
		}

		await appendTestimonial({
			username: session.username,
			email: session.email,
			level: '1',
			rating: Math.round(rating),
			comment,
			imageName,
			imageId,
			imageUrl,
			imageFolder,
		});

		return Astro.redirect('/?ok=1' + (imageFailed ? '&imagen=error' : '') + '#testimonios', 303);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		console.error('Error al enviar testimonio:', msg);
		return Astro.redirect(
			'/?error=' +
				encodeURIComponent('No se pudo guardar tu testimonio. Inténtalo de nuevo.') +
				'#testimonios',
			303
		);
	}
};