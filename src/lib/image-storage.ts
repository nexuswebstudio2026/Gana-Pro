import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { put } from '@vercel/blob';
import { getEnvValue } from './sheets';

/** Carpeta local donde se guardan las imágenes de testimonios en desarrollo. */
const LOCAL_FOLDER_NAME = 'testimonios';

export type ImageStorage = 'vercel-blob' | 'local';

/**
 * El almacenamiento no está configurado en el servidor.
 * Suele significar que falta BLOB_READ_WRITE_TOKEN en las variables de
 * entorno del proyecto (en Vercel: Settings > Environment Variables).
 */
export class ImageStorageNotConfiguredError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ImageStorageNotConfiguredError';
	}
}

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
 * Guarda un archivo en Vercel Blob (o en `public/<folder>/` en desarrollo).
 *
 * - Si hay `BLOB_READ_WRITE_TOKEN` usa Vercel Blob (obligatorio en producción,
 *   porque en Vercel el disco es de solo lectura).
 * - Si no hay token y se está en local, lo deja en `public/<folder>/` para
 *   poder verlo servido durante `astro dev`.
 */
export async function saveFile(
	folder: string,
	fileName: string,
	buffer: Buffer,
	mimeType: string
): Promise<StoredImage> {
	const name = safeFileName(fileName);
	const pathname = `${folder}/${name}`;

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
		throw new ImageStorageNotConfiguredError(
			'Falta BLOB_READ_WRITE_TOKEN en el servidor (Vercel > Settings > Environment Variables). ' +
				'Los archivos no pueden guardarse en producción.'
		);
	}

	// Desarrollo: se guarda en public/ para servirse como archivo estático
	const dir = join(process.cwd(), 'public', folder);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, name), buffer);
	return {
		id: name,
		url: `/${folder}/${name}`,
		folder: `/${folder}`,
		storage: 'local',
	};
}

/** Guarda la imagen de un testimonio en la carpeta `testimonios/`. */
export async function saveTestimonialImage(
	fileName: string,
	buffer: Buffer,
	mimeType: string
): Promise<StoredImage> {
	return saveFile(LOCAL_FOLDER_NAME, fileName, buffer, mimeType);
}
