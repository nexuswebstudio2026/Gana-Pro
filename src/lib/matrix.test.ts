import { describe, expect, it } from 'vitest';
import {
	NODE_STATE,
	buildMatrixNodes,
	computeProgress,
	resolveNodeState,
} from './matrix';

describe('resolveNodeState', () => {
	it('un puesto sin nombre está libre', () => {
		expect(resolveNodeState(null, null)).toBe(NODE_STATE.libre);
		expect(resolveNodeState('', null)).toBe(NODE_STATE.libre);
		expect(resolveNodeState('   ', 'aprobado')).toBe(NODE_STATE.libre);
	});

	it('con persona y recarga aprobada está activo', () => {
		expect(resolveNodeState('Ana', 'Aprobado')).toBe(NODE_STATE.activo);
		expect(resolveNodeState('Ana', '  aprobado ')).toBe(NODE_STATE.activo);
	});

	it('con persona pero sin recarga verificada está registrado', () => {
		expect(resolveNodeState('Ana', null)).toBe(NODE_STATE.registrado);
		expect(resolveNodeState('Ana', 'Pendiente')).toBe(NODE_STATE.registrado);
		// Una recarga rechazada no habilita el puesto.
		expect(resolveNodeState('Ana', 'Rechazado')).toBe(NODE_STATE.registrado);
	});
});

describe('buildMatrixNodes', () => {
	it('devuelve siempre los cinco puestos', () => {
		const nodes = buildMatrixNodes([], {});
		expect(nodes).toHaveLength(5);
		expect(nodes.map((n) => n.position)).toEqual([1, 2, 3, 4, 5]);
		expect(nodes.every((n) => n.state === NODE_STATE.libre)).toBe(true);
	});

	it('marca activo a quien tiene recarga aprobada', () => {
		const nodes = buildMatrixNodes(
			[{ name: 'Ana' }, { name: 'Beto' }],
			{ ana: 'Aprobado' }
		);
		expect(nodes[0].state).toBe(NODE_STATE.activo);
		expect(nodes[1].state).toBe(NODE_STATE.registrado);
		expect(nodes[2].state).toBe(NODE_STATE.libre);
	});

	it('el estado approved no habilita a un puesto libre', () => {
		// La clave existe pero no hay nadie en el puesto: importaría que se
		// ignorara, porque si no, un puesto vacío se contaría como activo.
		const nodes = buildMatrixNodes([], { ana: 'Aprobado' });
		expect(nodes[0].state).toBe(NODE_STATE.libre);
	});

	it('ignora a los miembros que sobran del equipo', () => {
		const team = Array.from({ length: 7 }, (_, i) => ({ name: `U${i + 1}` }));
		const nodes = buildMatrixNodes(team, {});
		expect(nodes).toHaveLength(5);
		expect(nodes[4].name).toBe('U5');
	});
});

describe('computeProgress', () => {
	const build = (states: string[]) =>
		states.map((state, i) => ({
			position: i + 1,
			state: state as (typeof NODE_STATE)[keyof typeof NODE_STATE],
			name: `U${i + 1}`,
			topupStatus: null,
		}));

	it('cuenta solo los puestos activos', () => {
		// 3 activos + 1 registrado + 1 libre: los registrados no cuentan.
		const nodes = buildMatrixNodes(
			[{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }],
			{ a: 'Aprobado', b: 'Aprobado', c: 'Aprobado', d: 'Pendiente' }
		);
		const progress = computeProgress(nodes, 2);
		expect(progress.active).toBe(3);
		expect(progress.registered).toBe(1);
		expect(progress.free).toBe(1);
		expect(progress.percent).toBe(60);
		expect(progress.remaining).toBe(2);
		expect(progress.complete).toBe(false);
	});

	it('marca completo cuando los cinco están activos', () => {
		const team = Array.from({ length: 5 }, (_, i) => ({ name: `U${i + 1}` }));
		const statuses = Object.fromEntries(
			team.map((m) => [m.name.toLowerCase(), 'Aprobado'])
		);
		const progress = computeProgress(buildMatrixNodes(team, statuses), 5);
		expect(progress.active).toBe(5);
		expect(progress.percent).toBe(100);
		expect(progress.remaining).toBe(0);
		expect(progress.complete).toBe(true);
	});

	it('una matriz vacía no divide por cero', () => {
		const progress = computeProgress([], 1);
		expect(progress.percent).toBe(0);
		expect(progress.active).toBe(0);
		expect(Number.isNaN(progress.percent)).toBe(false);
	});

	it('conserva el nivel en el resumen', () => {
		expect(computeProgress([], 4).level).toBe(4);
	});
});
