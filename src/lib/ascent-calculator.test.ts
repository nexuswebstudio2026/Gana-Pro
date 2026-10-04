import { describe, expect, it } from 'vitest';
import {
	allAscentScenarios,
	ASCENT_TOP_LEVEL,
	ascentMovements,
	PLATFORM_SHARE_TOP,
	PLATFORM_TAX_RATE,
	simulateAscent,
} from './ascent-calculator';
import { MAX_DIRECT_TEAM } from './user-hierarchy';
import { RECARGA_INICIAL_AMOUNT } from './p2p';
import { WITHDRAWAL_MIN_LEVEL } from './users';

describe('simulateAscent — la metodología real de la constelación', () => {
	it('el Nivel 2 con base completa recibe cinco aportes de $15.000', () => {
		const sim = simulateAscent(2)!;
		expect(sim.steps[1].received).toBe(MAX_DIRECT_TEAM * RECARGA_INICIAL_AMOUNT);
		expect(sim.steps[1].received).toBe(75_000);
	});

	it('el Nivel 1 es la base: aporta y no recibe nada', () => {
		const base = simulateAscent(1)!.steps[0];
		expect(base.received).toBe(0);
		expect(base.retained).toBe(0);
		expect(base.ascentAmount).toBe(0);
	});

	it('cada nivel recibe cinco veces lo que retenía el anterior', () => {
		const sim = simulateAscent(ASCENT_TOP_LEVEL)!;
		// La cascada completa: 75.000, 187.500, 468.750 y 1.171.875.
		expect(sim.steps.map((s) => s.received)).toEqual([
			0, 75_000, 187_500, 468_750, 1_171_875,
		]);
	});

	it('los niveles 2, 3 y 4 retienen la mitad de lo que reciben', () => {
		const sim = simulateAscent(ASCENT_TOP_LEVEL)!;
		expect(sim.steps[1].ascentAmount).toBe(37_500);
		expect(sim.steps[1].retained).toBe(37_500);
		expect(sim.steps[2].ascentAmount).toBe(93_750);
		expect(sim.steps[2].retained).toBe(93_750);
		expect(sim.steps[3].ascentAmount).toBe(234_375);
		expect(sim.steps[3].retained).toBe(234_375);
	});

	it('solo el Nivel 5 paga impuesto; los anteriores se quedan la mitad íntegra', () => {
		// Lo confirma el reparto de la base: 625 posiciones de Nivel 2 por $37.500
		// son $23.437.500, justo el 50 % de los $46.875.000 que aporta la base.
		const sim = simulateAscent(ASCENT_TOP_LEVEL)!;
		for (const step of sim.steps) {
			expect(step.tax).toBe(step.level === ASCENT_TOP_LEVEL ? step.tax : 0);
		}
		expect(625 * sim.steps[1].retained).toBe(23_437_500);
	});

	it('el Nivel 5 no reenvía a nadie: entrega el 35 % a GANA PRO', () => {
		const top = simulateAscent(ASCENT_TOP_LEVEL)!.steps.at(-1)!;
		expect(top.level).toBe(ASCENT_TOP_LEVEL);
		expect(top.ascentAmount).toBe(0);
		expect(top.platformShare).toBe(Math.round(top.received * PLATFORM_SHARE_TOP));
		expect(top.platformShare).toBe(410_156);
		expect(top.received - top.platformShare).toBe(761_719);
	});

	it('el 5 % de impuesto se aplica sobre lo retenido por el Nivel 5', () => {
		const top = simulateAscent(ASCENT_TOP_LEVEL)!.steps.at(-1)!;
		const grossRetained = top.received - top.platformShare;
		expect(top.tax).toBe(Math.round(grossRetained * PLATFORM_TAX_RATE));
		expect(top.tax).toBe(38_086);
		expect(top.retained).toBe(grossRetained - top.tax);
		expect(top.retained).toBe(723_633);
	});

	it('el acumulado suma los niveles anteriores más el actual', () => {
		const sim = simulateAscent(ASCENT_TOP_LEVEL)!;
		let running = 0;
		for (const step of sim.steps) {
			running += step.retained;
			expect(step.cumulative).toBe(running);
		}
		expect(sim.totalRetained).toBe(running);
		// 37.500 + 93.750 + 234.375 + 723.633
		expect(sim.totalRetained).toBe(1_089_258);
	});

	it('los totales cuadran con la suma de los peldaños', () => {
		const sim = simulateAscent(ASCENT_TOP_LEVEL)!;
		expect(sim.totalReceived).toBe(sim.steps.reduce((s, x) => s + x.received, 0));
		expect(sim.totalAscent).toBe(sim.steps.reduce((s, x) => s + x.ascentAmount, 0));
		expect(sim.totalPlatformShare).toBe(sim.steps.reduce((s, x) => s + x.platformShare, 0));
		expect(sim.totalTax).toBe(sim.steps.reduce((s, x) => s + x.tax, 0));
	});

	it('el ingreso crece al subir de nivel, nunca al revés', () => {
		const sim = simulateAscent(ASCENT_TOP_LEVEL)!;
		for (let i = 2; i < sim.steps.length; i++) {
			expect(sim.steps[i].retained).toBeGreaterThan(sim.steps[i - 1].retained);
		}
	});

	it('la barra del último peldaño es la más alta y nunca pasa de 100', () => {
		const sim = simulateAscent(ASCENT_TOP_LEVEL)!;
		const last = sim.steps.at(-1)!;
		expect(last.barPercent).toBe(100);
		for (const step of sim.steps) {
			expect(step.barPercent).toBeGreaterThanOrEqual(0);
			expect(step.barPercent).toBeLessThanOrEqual(100);
		}
	});

	it('las posiciones por debajo crecen de cinco en cinco', () => {
		const sim = simulateAscent(ASCENT_TOP_LEVEL)!;
		expect(sim.steps.map((s) => s.peopleBelow)).toEqual([1, 5, 25, 125, 625]);
		expect(sim.peopleBelow).toBe(625);
	});

	it('el aporte de la rama es el número de posiciones por $15.000', () => {
		const sim = simulateAscent(ASCENT_TOP_LEVEL)!;
		expect(sim.branchContribution).toBe(625 * RECARGA_INICIAL_AMOUNT);
		expect(sim.branchContribution).toBe(9_375_000);
	});

	it('el retorno se mide contra la activación propia', () => {
		const sim = simulateAscent(ASCENT_TOP_LEVEL)!;
		expect(sim.activationCost).toBe(RECARGA_INICIAL_AMOUNT);
		expect(sim.returnRatio).toBeCloseTo(sim.totalRetained / sim.activationCost, 10);
	});

	it('marca el retiro solo a partir del nivel que lo exige', () => {
		const sim = simulateAscent(ASCENT_TOP_LEVEL)!;
		for (const step of sim.steps) {
			expect(step.canWithdraw).toBe(step.level >= WITHDRAWAL_MIN_LEVEL);
		}
		expect(sim.canWithdraw).toBe(true);
		expect(simulateAscent(4)!.canWithdraw).toBe(false);
	});
});
describe('simulateAscent — la base tiene que estar completa', () => {
	it('con la base incompleta no entra dinero: es cero, no una estimación', () => {
		const sim = simulateAscent(ASCENT_TOP_LEVEL, false)!;
		expect(sim.totalRetained).toBe(0);
		expect(sim.totalReceived).toBe(0);
		expect(sim.totalAscent).toBe(0);
		expect(sim.steps.every((s) => s.retained === 0)).toBe(true);
	});

	it('con la base incompleta sigue mostrando la escalera y el coste', () => {
		// La estructura no desaparece: se ve el nivel que habría y lo que costaría.
		const sim = simulateAscent(ASCENT_TOP_LEVEL, false)!;
		expect(sim.steps).toHaveLength(ASCENT_TOP_LEVEL);
		expect(sim.steps.at(-1)!.level).toBe(ASCENT_TOP_LEVEL);
		expect(sim.branchContribution).toBe(625 * RECARGA_INICIAL_AMOUNT);
		expect(sim.activationCost).toBe(RECARGA_INICIAL_AMOUNT);
	});

	it('la base completa siempre gana más que la incompleta', () => {
		for (let level = 2; level <= ASCENT_TOP_LEVEL; level++) {
			const full = simulateAscent(level, true)!;
			const partial = simulateAscent(level, false)!;
			expect(full.totalRetained).toBeGreaterThan(partial.totalRetained);
		}
	});
});

describe('simulateAscent — entradas inválidas', () => {
	it('devuelve null para un nivel fuera de la escala', () => {
		expect(simulateAscent(0)).toBeNull();
		expect(simulateAscent(6)).toBeNull();
		expect(simulateAscent(-2)).toBeNull();
		expect(simulateAscent(Number.NaN)).toBeNull();
	});
});

describe('allAscentScenarios', () => {
	it('cubre cada nivel con la base completa y con la incompleta', () => {
		const scenarios = allAscentScenarios();
		// Cinco niveles por dos estados de la base.
		expect(scenarios).toHaveLength(ASCENT_TOP_LEVEL * 2);
		expect(scenarios.filter((s) => s.baseComplete)).toHaveLength(ASCENT_TOP_LEVEL);
		expect(scenarios.filter((s) => !s.baseComplete)).toHaveLength(ASCENT_TOP_LEVEL);
	});

	it('no repite el mismo escenario dos veces', () => {
		const keys = allAscentScenarios().map((s) => `${s.targetLevel}-${s.baseComplete}`);
		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe('ascentMovements — la línea de tiempo del ciclo', () => {
	const movementsOf = (level: number, baseComplete = true) =>
		ascentMovements(simulateAscent(level, baseComplete)!);

	it('empieza siempre por el registro y la recarga, antes de cualquier ascenso', () => {
		const movements = movementsOf(ASCENT_TOP_LEVEL);
		expect(movements[0].phase).toBe('registro');
		expect(movements[1].phase).toBe('recarga');
		expect(movements[0].level).toBe(1);
		expect(movements[1].level).toBe(1);
	});

	it('la recarga es el aporte completo y no se queda nada en el bolsillo', () => {
		const movements = movementsOf(ASCENT_TOP_LEVEL);
		const recharge = movements[1];
		expect(recharge.outgoing).toBe(RECARGA_INICIAL_AMOUNT);
		expect(recharge.outgoing).toBe(15_000);
		expect(recharge.remaining).toBe(0);
		expect(recharge.incoming).toBe(0);
	});

	it('el registro no mueve dinero', () => {
		const [registro] = movementsOf(ASCENT_TOP_LEVEL);
		expect(registro.incoming).toBe(0);
		expect(registro.outgoing).toBe(0);
		expect(registro.remaining).toBe(0);
	});

	it('hay un movimiento de ascenso por cada nivel por encima del 1', () => {
		const movements = movementsOf(ASCENT_TOP_LEVEL);
		const ascensos = movements.filter((m) => m.phase === 'ascenso');
		expect(ascensos).toHaveLength(ASCENT_TOP_LEVEL - 1);
		expect(ascensos.map((m) => m.level)).toEqual([2, 3, 4, 5]);
	});

	it('el ascenso al Nivel 2 muestra lo que recibe y el 50 % que envía', () => {
		const ascent = movementsOf(ASCENT_TOP_LEVEL).find((m) => m.id === 'ascenso-2')!;
		expect(ascent.incoming).toBe(75_000);
		expect(ascent.outgoing).toBe(37_500);
		expect(ascent.remaining).toBe(37_500);
		expect(ascent.outgoingLabel).toContain('50');
	});

	it('en cada ascenso lo que entra menos lo que sale es lo que queda', () => {
		for (const movement of movementsOf(ASCENT_TOP_LEVEL)) {
			if (movement.phase !== 'ascenso') continue;
			expect(movement.incoming - movement.outgoing).toBe(movement.remaining);
		}
	});

	it('el Nivel 5 envía a GANA PRO y paga impuesto en vez de reenviar', () => {
		const top = movementsOf(ASCENT_TOP_LEVEL).find((m) => m.id === 'ascenso-5')!;
		expect(top.incoming).toBe(1_171_875);
		expect(top.outgoing).toBe(410_156 + 38_086);
		expect(top.remaining).toBe(723_633);
		expect(top.outgoingLabel).toContain('GANA PRO');
		expect(top.outgoingLabel).toContain('impuesto');
	});

	it('cuenta cuántas posiciones hacen falta por debajo en cada movimiento', () => {
		const ascensos = movementsOf(ASCENT_TOP_LEVEL).filter((m) => m.phase === 'ascenso');
		expect(ascensos.map((m) => m.peopleBelow)).toEqual([5, 25, 125, 625]);
	});

	it('con el objetivo en Nivel 1 solo hay registro y recarga', () => {
		const movements = movementsOf(1);
		expect(movements).toHaveLength(2);
		expect(movements.some((m) => m.phase === 'ascenso')).toBe(false);
	});

	it('con la base incompleta no inventa ascensos: los deja todos en cero', () => {
		const movements = movementsOf(ASCENT_TOP_LEVEL, false);
		for (const movement of movements) {
			expect(movement.incoming).toBe(0);
			expect(movement.remaining).toBe(0);
		}
		// Los ascensos se listan igual, para que se vea a qué se aspiraría.
		expect(movements.filter((m) => m.phase === 'ascenso')).toHaveLength(
			ASCENT_TOP_LEVEL - 1
		);
	});

	it('los ids no se repiten, para poder enlazar cada movimiento', () => {
		const ids = movementsOf(ASCENT_TOP_LEVEL).map((m) => m.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});