import { getEnvValue, getSheetsClient } from './sheets';
import { saveTestimonialImage, type StoredImage } from './image-storage';
import { toZonedIso } from './datetime';
import type { Testimonial } from './types';

const SHEET_ID = getEnvValue('GOOGLE_SHEET_ID') || '';
const TESTIMONIAL_TAB = getEnvValue('GOOGLE_SHEET_TESTIMONIALS_TAB') || 'valoracion';

/** Columnas de la hoja "valoracion", en orden. */
export const TESTIMONIAL_HEADERS = [
	'id',
	'fecha',
	'usuario',
	'email',
	'nivel',
	'valoracion',
	'comentario',
	'imagen',
	'imagen_id',
	'imagen_url',
	'carpeta_drive',
	'estado',
] as const;

function normalizeHeader(header: string): string {
	return header
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.trim();
}

/** Tipos de imagen permitidos. */
export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
/** Tamaño máximo de la imagen: 5 MB. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * Guarda la imagen de un testimonio.
 *
 * En producción usa Vercel Blob (el disco de Vercel es de solo lectura) y en
 * desarrollo la deja en `public/testimonios/`.
 */
export async function uploadTestimonialImage(
	fileName: string,
	buffer: Buffer,
	mimeType: string
): Promise<StoredImage> {
	const extension = (fileName.split('.').pop() || 'jpg').toLowerCase();
	const stampedName = `testimonio_${Date.now()}.${extension === 'jpeg' ? 'jpg' : extension}`;

	return saveTestimonialImage(stampedName, buffer, mimeType);
}

/** Lee todos los testimonios visibles de la hoja "valoracion". */
export async function getTestimonials(includeHidden = false): Promise<Testimonial[]> {
	const sheets = getSheetsClient();
	const response = await sheets.spreadsheets.values.get({
		spreadsheetId: SHEET_ID,
		range: `${TESTIMONIAL_TAB}!A1:L1000`,
	});

	const rows = response.data.values || [];
	if (rows.length === 0) return [];

	// Localizar la fila de encabezados
	let headerRowIndex = -1;
	for (let i = 0; i < rows.length; i++) {
		const normalized = rows[i].map((c: unknown) => normalizeHeader(String(c)));
		if (normalized.includes('valoracion') && normalized.includes('comentario')) {
			headerRowIndex = i;
			break;
		}
	}
	if (headerRowIndex === -1) return [];

	const headers = rows[headerRowIndex].map((h: unknown) => normalizeHeader(String(h)));
	const at = (name: string) => headers.indexOf(name);

	const testimonials: Testimonial[] = [];
	for (let i = headerRowIndex + 1; i < rows.length; i++) {
		const row = rows[i];
		if (!row || row.length === 0) continue;

		const comment = at('comentario') !== -1 ? String(row[at('comentario')] || '').trim() : '';
		if (!comment) continue;

		const status = at('estado') !== -1 ? String(row[at('estado')] || 'visible').trim() : 'visible';
		if (!includeHidden && status === 'oculto') continue;

		const ratingRaw = at('valoracion') !== -1 ? Number(row[at('valoracion')]) : 0;

		testimonials.push({
			id: at('id') !== -1 ? String(row[at('id')] || '') : '',
			date: at('fecha') !== -1 ? String(row[at('fecha')] || '') : '',
			username: at('usuario') !== -1 ? String(row[at('usuario')] || '') : '',
			email: at('email') !== -1 ? String(row[at('email')] || '') : '',
			level: at('nivel') !== -1 ? String(row[at('nivel')] || '') : '',
			rating: Number.isFinite(ratingRaw) ? Math.min(5, Math.max(0, Math.round(ratingRaw))) : 0,
			comment,
			imageName: at('imagen') !== -1 ? String(row[at('imagen')] || '') : '',
			imageId: at('imagen_id') !== -1 ? String(row[at('imagen_id')] || '') : '',
			imageUrl: at('imagen_url') !== -1 ? String(row[at('imagen_url')] || '') : '',
			folderUrl: at('carpeta_drive') !== -1 ? String(row[at('carpeta_drive')] || '') : '',
			status,
		});
	}

	// Más recientes primero
	return testimonials.reverse();
}

/** Agrega un testimonio a la hoja "valoracion". */
export async function appendTestimonial(testimonial: {
	username: string;
	email: string;
	level: string;
	rating: number;
	comment: string;
	imageName?: string;
	imageId?: string;
	imageUrl?: string;
	imageFolder?: string;
}): Promise<void> {
	const sheets = getSheetsClient();

	let nextId = 1;
	try {
		const existing = await getTestimonials(true);
		if (existing.length > 0) {
			const highest = existing.reduce((max, t) => {
				const n = parseInt(t.id || '0', 10);
				return !Number.isNaN(n) && n > max ? n : max;
			}, 0);
			nextId = highest + 1;
		}
	} catch {
		nextId = Date.now();
	}

	const row = [
		String(nextId),
		// ISO 8601 con desfase: inequívoco aunque el servidor esté en UTC
		toZonedIso(),
		testimonial.username,
		testimonial.email,
		testimonial.level,
		String(testimonial.rating),
		testimonial.comment,
		testimonial.imageName || '',
		testimonial.imageId || '',
		testimonial.imageUrl || '',
		testimonial.imageFolder || '',
		'visible',
	];

	await sheets.spreadsheets.values.append({
		spreadsheetId: SHEET_ID,
		range: `${TESTIMONIAL_TAB}!A:L`,
		valueInputOption: 'USER_ENTERED',
		insertDataOption: 'INSERT_ROWS',
		requestBody: { values: [row] },
	});
}

/** Calcula la media de valoración de la metodología. */
export function averageRating(list: Testimonial[]): number {
	const rated = list.filter((t) => t.rating > 0);
	if (rated.length === 0) return 0;
	return rated.reduce((sum, t) => sum + t.rating, 0) / rated.length;
}