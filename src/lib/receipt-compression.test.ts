import { describe, expect, it } from 'vitest';
import {
	COMPRESS_ABOVE_BYTES,
	COMPRESSIBLE_TYPES,
	MAX_EDGE_PX,
	compressedExtension,
	fitWithin,
	planReceiptCompression,
} from './receipt-compression';

describe('planReceiptCompression', () => {
	it('rechaza un tipo que el servidor no admite', () => {
		// Comprimir no vuelve válido un archivo que el servidor iba a rechazar:
		// avisar aquí ahorra la subida inútil.
		const plan = planReceiptCompression({ type: 'application/zip', size: 9_000_000 });
		expect(plan.action).toBe('reject');
	});

	it('rechaza un comprobante vacío o sin tipo', () => {
		expect(planReceiptCompression(null).action).toBe('reject');
		expect(planReceiptCompression({ type: '', size: 0 }).action).toBe('reject');
	});

	it('un PDF se envía sin tocarlo', () => {
		// Recomprimir un comprobante bancario rompe la evidencia, y un PDF no es
		// una imagen que tenga sentido reescalar.
		const plan = planReceiptCompression({ type: 'application/pdf', size: 9_000_000 });
		expect(plan.action).toBe('passthrough');
	});

	it('una imagen que ya es pequeña no se recomprime', () => {
		// Volver a codificar una imagen de 40 KB solo degrada el color y gasta
		// CPU para no ganar nada.
		const plan = planReceiptCompression({
			type: 'image/jpeg',
			size: COMPRESS_ABOVE_BYTES - 1,
		});
		expect(plan.action).toBe('passthrough');
	});

	it('una imagen grande se comprime', () => {
		const plan = planReceiptCompression({
			type: 'image/png',
			size: 6 * 1024 * 1024,
		});
		expect(plan).toMatchObject({
			action: 'compress',
			maxEdge: MAX_EDGE_PX,
		});
	});

	it('cada formato admitido tiene una ruta válida', () => {
		for (const type of COMPRESSIBLE_TYPES) {
			expect(planReceiptCompression({ type, size: 5_000_000 }).action).toBe('compress');
		}
	});
});

describe('compressedExtension', () => {
	it('prefiere WebP cuando el navegador lo soporta', () => {
		expect(compressedExtension('image/png', true)).toBe('webp');
	});

	it('cae a JPG si no hay soporte de WebP', () => {
		// Safari y algunos navegadores antiguos no exportan a WebP: sin este
		// salto, la compresión fallaría y el comprobante iría sin optimizar.
		expect(compressedExtension('image/png', false)).toBe('jpg');
	});

	it('un PDF nunca se reexporta como imagen', () => {
		expect(compressedExtension('application/pdf', true)).toBeNull();
	});

	it('aguanta un tipo ausente o vacío', () => {
		// El comprobante llega del `<input type="file">`, que puede no traer tipo
		// si el usuario arrastra un archivo en lugar de elegirlo.
		expect(compressedExtension(null, true)).toBeNull();
		expect(compressedExtension(undefined, false)).toBeNull();
		expect(compressedExtension('', true)).toBeNull();
	});
});

describe('fitWithin', () => {
	it('reduce la imagen al lado mayor manteniendo la proporción', () => {
		const size = fitWithin(4000, 3000, 1600);
		expect(size).toEqual({ width: 1600, height: 1200 });
	});

	it('nunca agranda una imagen que ya cabe', () => {
		// Agrandarla solo gastaría bytes y no aportaría nada visible.
		expect(fitWithin(800, 600, 1600)).toEqual({ width: 800, height: 600 });
	});

	it('no llega nunca a una dimensión cero', () => {
		// Una imagen panorámica extrema (4000x1) redondeada podría dar 0, y un
		// canvas de 0 px falla al exportar.
		const size = fitWithin(4000, 1, 1600);
		expect(size.height).toBeGreaterThanOrEqual(1);
		expect(size.width).toBeGreaterThanOrEqual(1);
	});
});