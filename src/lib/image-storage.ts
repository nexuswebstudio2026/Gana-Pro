import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { put } from '@vercel/blob';
import { getEnvValue } from './sheets';

/** Carpeta local donde se guardan las imágenes cuando se desarrolla en local. */
const LOCAL_FOLDER_NAME = 'testimonios';
const LOCAL_UPLOAD_DIR = join(process.cwd(), 'public', LOCAL_FOLDER_NAME);

export type ImageStorage = 'vercel-blob' | 'local';

export interface StoredImage {
	/** Nombre/ruta del recurso almacenado. */
	id: string;
	/** URL pública con la que se muestra la imagen. */
	url: string;
	/** Referencia de la carpeta que la contiene. */
	folder: string;
	/** Dónde quedó guardada realmente. */
	storage: ImageStorage;
}

/** Indica si hay un Blob Store configurado. */
export function isBlobConfigured(): boolean {
	return Boolean(getEnvValue('BLOB_READ_WRITE_TOKEN'));
}

/**
 * Normaliza el nombre de archivo: solo extensión y base sin caracteres raros.
 * `foo/bar;.png` -> `foo_bar.png`
 */
function safeFileName(fileName: string): string {
	const ext = (fileName.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
	const base = (fileName.split('.').slice(0, -1).join('.') || 'testimonio')
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.replace(/[^a-zA-Z0-9_-]/g, '_')
		.slice(0, 60);
	return `${base}.${ext}`;
}

/**
 * Guarda la imagen de un testimonio.
 *
 * - Si hay `BLOB_READ_WRITE_TOKEN` usa Vercel Blob (obligatorio en producción,
 *   porque en Vercel el disco es de solo lectura).
 * - Si no hay token y se está en local, la deja en `public/testimonios/`
 *   para poder verla servida durante `astro dev`.
 */
export async function saveTestimonialImage(
	fileName: string,
	buffer: Buffer,
	mimeType: string
): Promise<StoredImage> {
	const name = safeFileName(fileName);
	const pathname = `${LOCAL_FOLDER_NAME}/${name}`;

	const token = getEnvValue('BLOB_READ_WRITE_TOKEN');
	if (token) {
		const blob = await put(pathname, buffer, {
			access: 'public',
			token,
			contentType: mimeType,
			// El nombre ya incluye un timestamp: no hace falta sufijo aleatorio.
			addRandomSuffix: false,
		});
		return {
			id: name,
			url: blob.url,
			folder: new URL(blob.url).origin,
			storage: 'vercel-blob',
		};
	}

	if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
		throw new Error(
			'Falta BLOB_READ_WRITE_TOKEN: crea un Blob Store en Vercel para poder guardar imágenes en producción.'
		);
	}

	// Desarrollo: se guarda en public/ para servirse como archivo estático
	await mkdir(LOCAL_UPLOAD_DIR, { recursive: true });
	await writeFile(join(LOCAL_UPLOAD_DIR, name), buffer);
	return {
		id: name,
		url: `/${LOCAL_FOLDER_NAME}/${name}`,
		folder: `/${LOCAL_FOLDER_NAME}`,
		storage: 'local',
	};
}
