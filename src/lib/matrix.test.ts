import { describe, expect, it } from 'vitest';
import {
	NODE_STATE,
	buildMatrixNodes,
	buildMatrixView,
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
describe('buildMatrixView', () => {
	it('coloca arriba a quien trajo al usuario y abajo sus cinco puestos', () => {
		const view = buildMatrixView({
			self: { name: 'Beto', level: '2' },
			upline: { name: 'Ana', level: '3' },
			downline: [{ name: 'Cami' }, { name: 'Dani' }],
			topupsByUser: { ana: 'Aprobado' },
			level: 2,
		});

		expect(view.upline?.name).toBe('Ana');
		expect(view.upline?.level).toBe('3');
		expect(view.self.name).toBe('Beto');
		// Los cinco puestos se dibujan siempre, ocupados o no.
		expect(view.downline).toHaveLength(5);
		expect(view.downline.map((n) => n.name)).toEqual(['Cami', 'Dani', null, null, null]);
	});

	it('deja el nivel superior vacío cuando el usuario no tiene patrocinador', () => {
		// El admin es la raíz de GANA PRO: no hay nadie encima y la vista tiene
		// que decirlo, no mostrar un nombre inventado.
		const view = buildMatrixView({
			self: { name: 'GANA PRO', level: '5' },
			upline: null,
			downline: [],
			level: 5,
		});

		expect(view.upline).toBeNull();
		expect(view.self.name).toBe('GANA PRO');
		expect(view.downline.every((n) => n.state === NODE_STATE.libre)).toBe(true);
	});

	it('el estado del nivel superior sale de su propia recarga', () => {
		const verificado = buildMatrixView({
			self: { name: 'Beto' },
			upline: { name: 'Ana' },
			topupsByUser: { ana: 'Aprobado' },
			level: 1,
		});
		const pendiente = buildMatrixView({
			self: { name: 'Beto' },
			upline: { name: 'Ana' },
			topupsByUser: { ana: 'Pendiente' },
			level: 1,
		});

		expect(verificado.upline?.state).toBe(NODE_STATE.activo);
		expect(pendiente.upline?.state).toBe(NODE_STATE.registrado);
	});

	it('el avance se calcula sobre los puestos inferiores, no sobre el superior', () => {
		const view = buildMatrixView({
			self: { name: 'Beto', level: '1' },
			upline: { name: 'Ana' },
			downline: [{ name: 'Cami' }, { name: 'Dani' }, { name: 'Eva' }],
			topupsByUser: { ana: 'Aprobado', cami: 'Aprobado', dani: 'Aprobado' },
			level: 1,
		});

		// Ana (el superior) está activa, pero solo cuentan los 2 de abajo.
		expect(view.progress.active).toBe(2);
		expect(view.progress.percent).toBe(40);
		expect(view.progress.level).toBe(1);
	});
});
