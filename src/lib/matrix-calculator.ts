/**
 * Proyección de la matriz 5x1 para la calculadora de la portada.
 *
 * Es un módulo puro a propósito: la calculadora es lo primero que ve el
 * visitante y promete cifras concretas, así que la aritmética tiene que estar
 * comprobada en los tests y no repartida por el HTML. Si un número cambia aquí,
 * cambia en todas las pantallas a la vez.
 *
 * Todos los umbrales se importan de donde ya se definieron en la plataforma en
 * lugar de repetirlos: la recarga inicial de `p2p.ts`, los cinco puestos de
 * `user-hierarchy.ts` y la comisión de referido de `referrals.ts`. Si el negocio
 * cambia una regla, esta proyección sigue diciendo la verdad.
 */
import { P2P_RATE, RECARGA_INICIAL_AMOUNT } from './p2p';
import { MAX_DIRECT_TEAM } from './user-hierarchy';
import { COMMISSION_PER_REFERRAL, REFERRAL_COMMISSION_PAYMENTS } from './referrals';
import { LEVELS } from './users';

/** Niveles que ofrece la calculadora: del 2 (el primero al que se aspira). */
export const CALCULATOR_LEVELS: readonly number[] = [2, 3, 4, 5];

/** Comisión que genera cada referido activo (solo recarga inicial aprobada). */
export const COMMISSION_PER_ACTIVE_REFERRAL =
	COMMISSION_PER_REFERRAL * REFERRAL_COMMISSION_PAYMENTS;

/** Qué muestra la calculadora para un nivel objetivo. */
export interface LevelProjection {
	/** Nivel objetivo elegido (2..5). */
	level: number;
	/** Nombre del nivel ("Plata", "Rubi"...). */
	levelName: string;
	/** Puestos directos que hay que tener activos: siempre cinco. */
	requiredActiveSlots: number;
	/** Lo que cuesta activar la cuenta propia. */
	activationCost: number;
	/** Comisión bruta que generan los referidos activos. */
	grossCommission: number;
	/** Porcentaje que se envía al patrocinador al ascender. */
	ascentRate: number;
	/** Monto que se envía al patrocinador. */
	ascentAmount: number;
	/** Porcentaje de sostenimiento a GanaPro (solo en el nivel máximo). */
	sustainabilityRate: number;
	/** Monto del fondo de sostenibilidad. */
	sustainabilityAmount: number;
	/** Lo que el miembro conserva de lo generado. */
	netEarnings: number;
}

/**
 * Proyección para un nivel objetivo.
 *
 * El reparto sigue las reglas de la plataforma: el 50 % va al patrocinador al
 * ascender y el 30 % al fondo de sostenimiento, que solo aplica en el nivel
 * máximo. Cualquier nivel fuera de rango devuelve `null` en vez de inventar una
 * cifra.
 */
export function projectLevel(targetLevel: number): LevelProjection | null {
	const level = Math.trunc(Number(targetLevel));
	const definition = LEVELS.find((l) => l.number === level);
	if (!definition) return null;

	const grossCommission = MAX_DIRECT_TEAM * COMMISSION_PER_ACTIVE_REFERRAL;
	const ascentAmount = Math.round(grossCommission * P2P_RATE.ascenso);

	// El 30 % de sostenimiento es el paso del nivel máximo: en los anteriores
	// se muestra 0 en vez de ocultarlo, para que la comparación sea honesta.
	const sustainabilityRate = level === 5 ? P2P_RATE.sostenimiento : 0;
	const sustainabilityAmount = Math.round(grossCommission * sustainabilityRate);

	return {
		level,
		levelName: definition.name,
		requiredActiveSlots: MAX_DIRECT_TEAM,
		activationCost: RECARGA_INICIAL_AMOUNT,
		grossCommission,
		ascentRate: P2P_RATE.ascenso,
		ascentAmount,
		sustainabilityRate,
		sustainabilityAmount,
		netEarnings: grossCommission - ascentAmount - sustainabilityAmount,
	};
}

/** Todas las proyecciones de la calculadora, para pintarlas de una vez. */
export function allProjections(): LevelProjection[] {
	return CALCULATOR_LEVELS.map(projectLevel).filter((p): p is LevelProjection => p !== null);
}
