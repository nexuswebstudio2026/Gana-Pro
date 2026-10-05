/**
 * Optimización de comprobantes antes de subirlos a Vercel Blob.
 *
 * Una captura de Nequi o Daviplata suele pesar 4-8 MB en PNG, pero se ve
 * igual de bien en 200 KB. Como el comprobante va a almacenamiento de pago y el
 * admin tiene que abrirlo para approvinglo, conviene que llegue ligero.
 *
 * Este módulo es puro: decide **qué hacer** con el archivo y con cuánto se
 * comprime, pero el trabajo real de `canvas` ocurre en el navegador. Esa
 * separación es la que permite probar en Node los números que cuestan dinero —
 * que un comprobante nunca pase de 3 MB, que un PDF no se degrade— sin montar
 * un DOM.
 *
 * La compresión es solo una optimización: si el navegador no la soporta, el
 * archivo original se sube tal cual. Nunca se pierde evidencia por optimizarla
 * de más.
 */

/** Tipos que se pueden recomprimir en el navegador. */
export const COMPRESSIBLE_TYPES: readonly string[] = [
	'image/jpeg',
	'image/png',
	'image/webp',
];

/** Tipos que se subirán tal cual, sin tocar un byte. */
export const PASSTHROUGH_TYPES: readonly string[] = ['application/pdf'];

/** Calidad con la que se reexporta el canvas. */
export const RECEIPT_QUALITY = 0.82;

/**
 * Lado mayor máximo del comprobante, en píxeles.
 *
 * 1600 px es de sobra para que el admin lea un monto en un celular, y es el
 * punto donde seguir bajando la resolución ya no aporta nada visible. Es la
 * regla que evita subir una foto de 12 MP que pesa 9 MB.
 */
export const MAX_EDGE_PX = 1600;

/** Tamaño a partir del cual compensa comprimir. */
export const COMPRESS_ABOVE_BYTES = 220 * 1024;

/** Error cuando el archivo no está entre los tipos admitidos. */
export type CompressionOutcome =
	| { action: 'reject'; reason: string }
	| { action: 'passthrough'; reason: string }
	| { action: 'compress'; maxEdge: number; quality: number };

/**
 * Decide qué hacer con un comprobante, a partir de su tipo y su tamaño.
 *
 * Las reglas, en orden de importancia:
 *
 *   1. Si el tipo no está admitido, se rechaza. Comprimir no vuelve válido un
 *      archivo que el servidor iba a rechazar igual.
 *   2. Un PDF se sube tal cual: recomprimir un comprobante bancario rompe la
 *      evidencia y no es una imagen que tenga sentido reescalar.
 *   3. Una imagen pequeña se sube tal cual: volver a codificarla solo degrada
 *      la imagen y gasta CPU para ganar nada.
 *   4. El resto se comprime.
 */
export function planReceiptCompression(file: {
	type?: string | null;
	size?: number | null;
} | null): CompressionOutcome {
	const type = String(file?.type ?? '').trim().toLowerCase();
	const size = Number(file?.size ?? 0);

	if (!type || !size) {
		return { action: 'reject', reason: 'Adjunta el comprobante del pago.' };
	}

	if (!COMPRESSIBLE_TYPES.includes(type) && !PASSTHROUGH_TYPES.includes(type)) {
		return { action: 'reject', reason: 'El comprobante debe ser JPG, PNG, WebP o PDF.' };
	}

	if (PASSTHROUGH_TYPES.includes(type)) {
		return { action: 'passthrough', reason: 'El PDF se envía sin modificar.' };
	}

	if (size <= COMPRESS_ABOVE_BYTES) {
		return {
			action: 'passthrough',
			reason: 'La imagen ya es pequeña: se envía sin comprimir.',
		};
	}

	return { action: 'compress', maxEdge: MAX_EDGE_PX, quality: RECEIPT_QUALITY };
}

/**
 * Qué formato se elige al recomprimir.
 *
 * Se.exporta WebP cuando el navegador lo soporta, porque pesa del orden de un
 * 30 % menos que el JPEG equivalente. Si no lo soporta se cae a JPEG, que es
 * universal: por eso el resultado es `null` cuando no hay nada mejor que hacer,
 * y quien llama decide.
 */
export function compressedExtension(
	originalType: string | null | undefined,
	supportsWebP: boolean
): 'webp' | 'jpg' | null {
	const type = String(originalType ?? '').toLowerCase();
	if (!COMPRESSIBLE_TYPES.includes(type)) return null;
	return supportsWebP ? 'webp' : 'jpg';
}

/**
 * Redimensiona las dimensiones de la imagen al lado mayor indicado.
 *
 * Se exporta aparte porque es la parte que se puede comprobar sin navegador:
 * mantiene la proporción, nunca agranda una imagen que ya es menor que el tope
 * (agrandarla solo gasta bytes) y cae a `1` para que no se llegue a un tamaño
 * cero con imágenes muy panorámicas.
 */
export function fitWithin(width: number, height: number, maxEdge: number): { width: number; height: number } {
	const safeWidth = Math.max(1, Math.round(width) || 1);
	const safeHeight = Math.max(1, Math.round(height) || 1);
	const longest = Math.max(safeWidth, safeHeight);

	if (longest <= maxEdge) {
		return { width: safeWidth, height: safeHeight };
	}

	const ratio = maxEdge / longest;
	return {
		width: Math.max(1, Math.round(safeWidth * ratio)),
		height: Math.max(1, Math.round(safeHeight * ratio)),
	};
}