import { describe, expect, it } from 'vitest';
import {
	allProjections,
	CALCULATOR_LEVELS,
	COMMISSION_PER_ACTIVE_REFERRAL,
	projectLevel,
} from './matrix-calculator';
import { MAX_DIRECT_TEAM } from './user-hierarchy';
import { P2P_RATE, RECARGA_INICIAL_AMOUNT } from './p2p';

describe('projectLevel', () => {
	it('exige siempre los cinco puestos directos', () => {
		for (const level of CALCULATOR_LEVELS) {
			expect(projectLevel(level)?.requiredActiveSlots).toBe(MAX_DIRECT_TEAM);
		}
	});

	it('muestra la recarga inicial que activa la cuenta', () => {
		expect(projectLevel(3)?.activationCost).toBe(RECARGA_INICIAL_AMOUNT);
	});

	it('el nivel 2 ya exige el envío del 50 % al patrocinador', () => {
		const projection = projectLevel(2)!;
		expect(projection.ascentRate).toBe(P2P_RATE.ascenso);
		expect(projection.ascentAmount).toBe(
			Math.round(projection.grossCommission * P2P_RATE.ascenso)
		);
	});

	it('la comisión bruta sale de los cinco referidos activos', () => {
		expect(projectLevel(2)?.grossCommission).toBe(
			MAX_DIRECT_TEAM * COMMISSION_PER_ACTIVE_REFERRAL
		);
	});

	it('el 30 % de sostenimiento solo aplica en el nivel 5', () => {
		for (const level of [2, 3, 4]) {
			const projection = projectLevel(level)!;
			expect(projection.sustainabilityRate).toBe(0);
			expect(projection.sustainabilityAmount).toBe(0);
		}

		const top = projectLevel(5)!;
		expect(top.sustainabilityRate).toBe(P2P_RATE.sostenimiento);
		expect(top.sustainabilityAmount).toBe(
			Math.round(top.grossCommission * P2P_RATE.sostenimiento)
		);
	});

	it('la ganancia neta descuenta los envíos y nunca sale negativa', () => {
		for (const level of CALCULATOR_LEVELS) {
			const p = projectLevel(level)!;
			expect(p.netEarnings).toBe(
				p.grossCommission - p.ascentAmount - p.sustainabilityAmount
			);
			expect(p.netEarnings).toBeGreaterThanOrEqual(0);
		}
	});

	it('el nivel 5 retiene menos que los niveles intermedios', () => {
		// Es la consecuencia de summingar el 30 %: el botón del último nivel debe
		// ser honesto y no pintar la mejor cifra.
		const four = projectLevel(4)!.netEarnings;
		const five = projectLevel(5)!.netEarnings;
		expect(five).toBeLessThan(four);
	});

	it('acepta cualquier nivel de la escala, incluido el 1', () => {
		// El selector ofrece del 2 al 5 (`CALCULATOR_LEVELS`), pero la función
		// calcula bien el nivel 1: así un perfil ya activo puede consultarlo.
		expect(projectLevel(1)?.levelName).toBe('Bronce');
	});

	it('devuelve null para un nivel fuera de la escala', () => {
		expect(projectLevel(6)).toBeNull();
		expect(projectLevel(0)).toBeNull();
		expect(projectLevel(-2)).toBeNull();
		expect(projectLevel(Number.NaN)).toBeNull();
	});

	it('trae el nombre del nivel', () => {
		expect(projectLevel(5)?.levelName).toBe('Oro');
		expect(projectLevel(3)?.levelName).toBe('Rubi');
	});
});

describe('allProjections', () => {
	it('devuelve una entrada por nivel ofrecible', () => {
		const all = allProjections();
		expect(all).toHaveLength(CALCULATOR_LEVELS.length);
		expect(all.map((p) => p.level)).toEqual([...CALCULATOR_LEVELS]);
	});
});
