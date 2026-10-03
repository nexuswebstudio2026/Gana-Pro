/**
 * Reglas de los pagos entre usuarios (P2P) de la matriz 5x1.
 *
 * En la matriz cada miembro hace tres movimientos distintos, y no todos valen
 * lo mismo ni se pueden hacer en cualquier momento:
 *
 *   1. Recarga inicial: monto fijo de $15.000 para activar su puesto.
 *   2. Ascenso a patrocinador: envía el 50 % de su saldo a quien lo trajo.
 *   3. Sostenimiento GanaPro: envía el 30 % de su saldo a la plataforma.
 *
 * Este archivo es deliberadamente "puro": no lee ni escribe en Google Sheets.
 * Así las reglas se pueden comprobar en los tests sin montar el cliente de
 * Sheets, que es lento y necesita credenciales. Lo que sí guarda las filas vive
 * en `p2p-payments.ts`.
 */

import { toLevelNumber } from './users';

/** Monto de la recarga inicial que activa un puesto de la matriz. */
export const RECARGA_INICIAL_AMOUNT = 15_000;

/**
 * Nivel mínimo para repartir el saldo entre/users y plataforma.
 *
 * El reparto del 50 % y del 30 % es el paso de ascenso, así que solo se habilita
 * cuando el miembro ya alcanzó el nivel máximo. Si el negocio cambia este
 * umbral, se cambia aquí y todas las pantallas lo respetan.
 */
export const P2P_MIN_LEVEL = 5;

/** Porcentaje del saldo que se envía en cada uno de los dos repartos. */
export const P2P_RATE = {
	/** Envío al patrocinador que lo trajo. */
	ascenso: 0.5,
	/** Fondo de sostenibilidad de GanaPro. */
	sostenimiento: 0.3,
} as const;

/** Los tres conceptos que se pueden reportar con un comprobante. */
export const P2P_CONCEPT = {
	recargaInicial: 'Recarga Inicial',
	ascensoPatrocinador: 'Ascenso a Patrocinador',
	sostenimientoGanaPro: 'Sostenimiento GanaPro',
} as const;

export type P2PConcept = (typeof P2P_CONCEPT)[keyof typeof P2P_CONCEPT];

/** Lista ordenada de conceptos, tal y como se muestran en el selector. */
export const P2P_CONCEPTS: readonly P2PConcept[] = [
	P2P_CONCEPT.recargaInicial,
	P2P_CONCEPT.ascensoPatrocinador,
	P2P_CONCEPT.sostenimientoGanaPro,
];

/** Estados de una solicitud, iguales a los de recargas y retiros. */
export const P2P_STATUS = {
	pendiente: 'Pendiente',
	aprobado: 'Aprobado',
	rechazado: 'Rechazado',
} as const;

export type P2PStatus = (typeof P2P_STATUS)[keyof typeof P2P_STATUS];

/**
 * Color de cada estado en la tabla de historial.
 *
 * Se devuelve una clase y no un color: el color lo decide la hoja de estilos
 * del componente, y aquí solo se declara qué estado es cuál.
 */
export const P2P_STATUS_TONE: Record<P2PStatus, 'pending' | 'approved' | 'rejected'> = {
	[P2P_STATUS.pendiente]: 'pending',
	[P2P_STATUS.aprobado]: 'approved',
	[P2P_STATUS.rechazado]: 'rejected',
};

/** Describe un concepto para el selector del formulario. */
export interface P2PConceptInfo {
	id: P2PConcept;
	/** Texto que ve el usuario. */
	label: string;
	/** Segunda línea: qué hace con el dinero. */
	detail: string;
	/** Fracción del saldo que se envía, o `null` si el monto es fijo. */
	rate: number | null;
	/** Monto fijo cuando el concepto no es un porcentaje. */
	fixedAmount: number | null;
	/** Nivel a partir del cual se puede reportar. */
	minLevel: number;
}

export const P2P_CONCEPT_INFO: Record<P2PConcept, P2PConceptInfo> = {
	[P2P_CONCEPT.recargaInicial]: {
		id: P2P_CONCEPT.recargaInicial,
		label: `Recarga Inicial ($${RECARGA_INICIAL_AMOUNT.toLocaleString('es-CO')})`,
		detail: 'Activa tu puesto en la matriz.',
		rate: null,
		fixedAmount: RECARGA_INICIAL_AMOUNT,
		minLevel: 1,
	},
	[P2P_CONCEPT.ascensoPatrocinador]: {
		id: P2P_CONCEPT.ascensoPatrocinador,
		label: `Envío de Ascenso a Patrocinador (${P2P_RATE.ascenso * 100} %)`,
		detail: 'Se envía al miembro que te trajo.',
		rate: P2P_RATE.ascenso,
		fixedAmount: null,
		minLevel: P2P_MIN_LEVEL,
	},
	[P2P_CONCEPT.sostenimientoGanaPro]: {
		id: P2P_CONCEPT.sostenimientoGanaPro,
		label: `Fondo de Sostenimiento GanaPro (${P2P_RATE.sostenimiento * 100} %)`,
		detail: 'Se envía a la cuenta de la plataforma.',
		rate: P2P_RATE.sostenimiento,
		fixedAmount: null,
		minLevel: P2P_MIN_LEVEL,
	},
};

/** ¿El texto recibido corresponde a uno de los conceptos conocidos? */
export function isP2PConcept(value: unknown): value is P2PConcept {
	return P2P_CONCEPTS.includes(String(value ?? '') as P2PConcept);
}

/**
 * ¿Este miembro puede reportar este concepto ahora mismo?
 *
 * El nivel se normaliza con `toLevelNumber`, el mismo helper que usan el panel
 * y la validación de retiros. Reutilizarlo (en vez de repetir aquí la tabla de
 * alias) evita que "Oro", "oro" o "5" se interpreten de forma distinta en cada
 * capa.
 *
 * El servidor vuelve a comprobarlo al guardar: esto es una ayuda para la
 * interfaz, no la garantía.
 */
export function canSubmitConcept(concept: P2PConcept, level: unknown): boolean {
	const info = P2P_CONCEPT_INFO[concept];
	if (!info) return false;
	return toLevelNumber(level == null ? null : String(level)) >= info.minLevel;
}

/**
 * Monto que corresponde a un concepto.
 *
 * Los porcentajes se calculan sobre el saldo que se le pasa, no sobre el saldo
 * de la hoja: así el total que ve el usuario antes de enviar es exactamente el
 * que se registra.
 */
export function conceptAmount(concept: P2PConcept, balance: number): number {
	const info = P2P_CONCEPT_INFO[concept];
	if (!info) return 0;
	const base = Number.isFinite(balance) && balance > 0 ? balance : 0;
	if (info.fixedAmount !== null) return info.fixedAmount;
	return Math.round(base * (info.rate ?? 0));
}

// --- Comprobantes -------------------------------------------------------------

/** Tipos de archivo admitidos como evidencia de un pago. */
export const RECEIPT_TYPES: readonly string[] = [
	'image/jpeg',
	'image/png',
	'application/pdf',
];

/** Tamaño máximo del comprobante: 3 MB. */
export const MAX_RECEIPT_BYTES = 3 * 1024 * 1024;

/** Longitud máxima del número de transacción que se puede anotar. */
export const RECEIPT_REFERENCE_MAX = 60;

/**
 * Valida el comprobante y devuelve el motivo del rechazo, o `null` si es válido.
 *
 * Se exporta para que el formulario y el endpoint appliquen exactamente la misma
 * regla: si solo la comprobara el servidor, el usuario subiría el archivo y se
 * le rechazaría después de esperar la carga.
 */
export function validateReceipt(
	file: { type?: string; size?: number } | null | undefined
): string | null {
	if (!file || !file.size) return 'Adjunta el comprobante del pago.';
	if (!RECEIPT_TYPES.includes(String(file.type ?? ''))) {
		return 'El comprobante debe ser JPG, PNG o PDF.';
	}
	if (file.size > MAX_RECEIPT_BYTES) {
		return 'El comprobante supera el límite de 3 MB.';
	}
	return null;
}

/** Deja la referencia de transacción lista para guardarse. */
export function normalizeReceiptReference(value: unknown): string {
	return String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, RECEIPT_REFERENCE_MAX);
}
