import { getEnvValue, getSheetsClient, SPREADSHEET_ID } from './sheets';
import { saveFile, saveTestimonialImage, type StoredImage } from './image-storage';

/** Carpeta (en el almacén) donde se guardan los documentos de identidad. */
export const DOCUMENTS_FOLDER = 'documentos';

/** Carpeta donde se guardan los RUT emitidos por la DIAN. */
export const RUTS_FOLDER = 'rut';

/** Tipos de archivo admitidos para el documento de identidad. */
export const ALLOWED_DOCUMENT_TYPES = [
	'image/jpeg',
	'image/png',
	'image/webp',
	'application/pdf',
] as const;

/** Tamaño máximo del documento: 5 MB. */
export const MAX_DOCUMENT_BYTES = 5 * 1024 * 1024;

/** Estados posibles de la revisión documental. */
export const DOCUMENT_STATUS = {
	pendiente: 'Pendiente',
	aprobado: 'Aprobado',
	rechazado: 'Rechazado',
} as const;

/** El NIT solo admite dígitos y debe tener entre 6 y 20. */
const NIT_PATTERN = /^\d{6,20}$/;

/**
 * Catálogo único de tipos de documento de identidad.
 *
 * Vive aquí y no en la página de registro para que el formulario, el endpoint y
 * cualquier pantalla que lo muestre usen la misma lista: si cada sitio escribe
 * sus propias opciones, un tipo nuevo se aplica en un lado y se olvida en otro.
 */
export const DOCUMENT_TYPES = [
	{ code: 'CC', label: 'Cédula de Ciudadanía' },
	{ code: 'TI', label: 'Tarjeta de Identidad' },
	{ code: 'CE', label: 'Cédula de Extranjería' },
	{ code: 'PEP', label: 'Permiso por Protección' },
] as const;

/** Códigos válidos, derivados del catálogo para que no se desincronicen. */
export const DOCUMENT_TYPE_CODES = DOCUMENT_TYPES.map((t) => t.code);

/**
 * Pasa un texto a una forma comparable: sin tildes, en minúsculas y sin
 * espacios repetidos.
 *
 * Se aplica a las DOS partes de la comparación. Si solo se normalizara la
 * entrada, "Cédula de Ciudadanía" nunca coincidiría con la etiqueta
 * "cédula de ciudadanía" del catálogo y el nombre completo se rechazaría.
 */
function comparable(value: string): string {
	return value
		.normalize('NFD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Normaliza el tipo de documento recibido del formulario.
 *
 * Acepta el código (`CC`), el nombre completo en cualquier capitalización
 * (`cédula de ciudadanía`, `CEDULA DE CIUDADANIA`) y devuelve siempre el
 * código, o `null` si no corresponde a ninguno del catálogo.
 */
export function normalizeDocumentType(value: string): string | null {
	const raw = (value || '').trim();
	if (!raw) return null;

	const upper = raw.toUpperCase();
	const byCode = DOCUMENT_TYPE_CODES.find((code) => code === upper);
	if (byCode) return byCode;

	// Se comparan también los nombres: el select del navegador manda el
	// código, pero un POST manual puede no traerlo y no debe acabar rechazado
	// por un detalle de formato.
	const byLabel = DOCUMENT_TYPES.find((t) => comparable(t.label) === comparable(raw));
	return byLabel ? byLabel.code : null;
}

/** Etiqueta legible de un código, o el propio código si no está en el catálogo. */
export function documentTypeLabel(code: string): string {
	const found = DOCUMENT_TYPES.find((t) => t.code === (code || '').trim().toUpperCase());
	return found ? `${found.code} — ${found.label}` : (code || '').trim();
}

/**
 * Indica si un NIT tiene un formato válido: solo números, entre 6 y 20 dígitos.
 * Lo usan el envío de documentos del miembro y el panel de administración.
 */
export function esNitValido(nit: string): boolean {
	return NIT_PATTERN.test(nit);
}

/**
 * Sube el documento de identidad de un usuario y devuelve la referencia
 * guardada (URL pública + nombre del archivo).
 *
 * El archivo se guarda como `documento_<usuario>_<timestamp>.<ext>` para que
 * sea fácil identificar de quién es y no se pisen entre sí.
 */
export async function uploadIdentityDocument(
	username: string,
	fileName: string,
	buffer: Buffer,
	mimeType: string
): Promise<StoredImage> {
	const extension = (fileName.split('.').pop() || 'jpg').toLowerCase();
	const safeUser = username.replace(/[^a-zA-Z0-9_-]/g, '');
	const stampedName = `documento_${safeUser || 'user'}_${Date.now()}.${extension}`;

	return saveFile(DOCUMENTS_FOLDER, stampedName, buffer, mimeType);
}

/**
 * Sube el RUT (Registro Único Tributario) emitido por la DIAN.
 * Se guarda en una carpeta aparte para no confundirlo con la identidad.
 */
export async function uploadRutDocument(
	username: string,
	fileName: string,
	buffer: Buffer,
	mimeType: string
): Promise<StoredImage> {
	const extension = (fileName.split('.').pop() || 'pdf').toLowerCase();
	const safeUser = username.replace(/[^a-zA-Z0-9_-]/g, '');
	const stampedName = `rut_${safeUser || 'user'}_${Date.now()}.${extension}`;

	return saveFile(RUTS_FOLDER, stampedName, buffer, mimeType);
}

import { toZonedIso } from './datetime';
import type { Testimonial } from './types';

/**
 * Se reutiliza el mismo ID que el resto de la aplicación (`sheets.ts`), que
 * además trae un valor por defecto. Antes este módulo resolvía el ID por su
 * cuenta y, si `GOOGLE_SHEET_ID` no estaba definida (por ejemplo en Vercel),
 * se quedaba con un id vacío y Google respondía "Requested entity was not
 * found", dejando los testimonios sin cargar.
 */
const SHEET_ID = SPREADSHEET_ID;
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