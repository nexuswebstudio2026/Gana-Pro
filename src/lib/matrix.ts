/**
 * Estado de la matriz 5x1 de un miembro.
 *
 * Cada persona de la matriz tiene exactamente cinco puestos debajo, y cada
 * puesto está en uno de tres estados:
 *
 *   - Libre: nadie lo ocupa todavía. Es la oportunidad de captar.
 *   - Registrado: hay alguien, pero su recarga inicial sigue sin verificarse,
 *     así que todavía no cuenta para el ascenso.
 *   - Activo: hay alguien Y su recarga inicial fue aprobada. Solo estos
 *     puestos cuentan para subir de nivel.
 *
 * Este módulo es puro (no toca Google Sheets) para poder comprobar en los
 * tests la regla que cuesta dinero: cuántos puestos activos hay y qué
 * porcentaje falta para el siguiente nivel.
 */

import { MAX_DIRECT_TEAM } from './user-hierarchy';

/** Los tres estados posibles de un puesto de la matriz. */
export const NODE_STATE = {
	libre: 'Libre',
	registrado: 'Registrado (Sin Recarga)',
	activo: 'Activo (Recarga Verificada)',
} as const;

export type NodeState = (typeof NODE_STATE)[keyof typeof NODE_STATE];

/**
 * Tono visual de cada estado. Lo usa la hoja de estilos del componente, para
 * que el mismo estado se pinte igual en todas partes.
 */
export const NODE_TONE: Record<NodeState, 'free' | 'pending' | 'active'> = {
	[NODE_STATE.libre]: 'free',
	[NODE_STATE.registrado]: 'pending',
	[NODE_STATE.activo]: 'active',
};

/** Un puesto concreto de la matriz. */
export interface MatrixNode {
	/** ID interno del organigrama, usado para abrir la rama de esta persona. */
	id?: string;
	/** Posición 1..5 dentro del equipo del miembro. */
	position: number;
	state: NodeState;
	/** Nombre de quien ocupa el puesto, o `null` si está libre. */
	name: string | null;
	/** Estado de recarga inicial: `aprobada`, `pendiente` o ninguna. */
	topupStatus: string | null;
}

/** Cómo va el ascenso de un miembro a partir de sus cinco puestos. */
export interface MatrixProgress {
	level: number;
	/** Puestos activos: los únicos que cuentan para ascender. */
	active: number;
	/** Puestos ocupados pero sin recarga verificada. */
	registered: number;
	/** Puestos sin ocupar. */
	free: number;
	/** 0..100, redondeado. `3` de `5` activos es `60`. */
	percent: number;
	/** Puestos activos que faltan para el siguiente nivel. */
	remaining: number;
	/** `true` cuando los cinco puestos están activos. */
	complete: boolean;
}

function normalize(value: string | null | undefined): string {
	return String(value ?? '')
		.trim()
		.toLowerCase();
}

/**
 * Estado de un puesto a partir de quién lo ocupa y el estado de su recarga.
 *
 * La comparación del nombre es la que decide si un puesto cuenta como activo:
 * así un aprobado en la hoja de recargas activa a su referido aunque el
 * organigrama lo traiga con otro formato de nombre.
 */
export function resolveNodeState(
	name: string | null | undefined,
	topupStatus: string | null | undefined
): NodeState {
	if (!normalize(name)) return NODE_STATE.libre;
	return normalize(topupStatus) === 'aprobado' ? NODE_STATE.activo : NODE_STATE.registrado;
}

/**
 * Construye los cinco puestos del miembro a partir de su equipo directo.
 *
 * `team` son las personas reales de su rama y `topupsByUser` el estado de la
 * última recarga inicial de cada una (clave: nombre normalizado). Los puestos
 * que sobran se completan como libres para que la vista siempre dibuje cinco.
 */
export function buildMatrixNodes(
	team: readonly { id?: string; name?: string | null; email?: string | null }[],
	topupsByUser: Readonly<Record<string, string>> = {}
): MatrixNode[] {
	const nodes: MatrixNode[] = [];

	for (let index = 0; index < MAX_DIRECT_TEAM; index++) {
		const member = team[index];
		const name = member?.name?.trim() || null;
		const status = name ? topupsByUser[normalize(name)] ?? null : null;
		nodes.push({
			...(member?.id ? { id: member.id } : {}),
			position: index + 1,
			state: resolveNodeState(name, status),
			name,
			topupStatus: status,
		});
	}

	return nodes;
}

/**
 * Calcula el avance hacia el siguiente nivel.
 *
 * Solo cuentan los puestos activos: los registrados no verificados no aceleran
 * el ascenso, que es justo lo que evita que se llenara la matriz de gente que
 * nunca pagó.
 */
export function computeProgress(nodes: readonly MatrixNode[], level: number): MatrixProgress {
	const active = nodes.filter((n) => n.state === NODE_STATE.activo).length;
	const registered = nodes.filter((n) => n.state === NODE_STATE.registrado).length;
	const free = nodes.length - active - registered;
	const remaining = Math.max(0, MAX_DIRECT_TEAM - active);

	return {
		level,
		active,
		registered,
		free,
		// `MAX_DIRECT_TEAM` nunca es 0, pero el redondeo se protege igual para
		// que un cambio futuro en la constante no produzca `NaN` en la barra.
		percent: MAX_DIRECT_TEAM > 0 ? Math.round((active / MAX_DIRECT_TEAM) * 100) : 0,
		remaining,
		complete: active >= MAX_DIRECT_TEAM,
	};
}

/** Una persona concreta dentro de la matriz, con su estado de recarga. */
export interface MatrixPerson {
	/** Nombre de la persona, o `null` si el nivel está vacío. */
	name: string | null;
	/** Estado de su recarga inicial, o `null` si no hay ninguna. */
	topupStatus: string | null;
	/** Estado derivado de la recarga, igual que el de un puesto. */
	state: NodeState;
	/** Nivel declarado en la hoja (`"2"`, `"Oro"`...). `null` si no tiene. */
	level: string | null;
}

/**
 * Los tres niveles que ve un miembro en su matriz.
 *
 * Arriba está quien lo trajo, en el centro el propio usuario y abajo los cinco
 * puestos de su equipo directo. El admin no tiene nivel superior (es la raíz de
 * GANA PRO), así que ahí `upline` llega `null` y la vista lo dice en pantalla en
 * vez de inventar un patrocinador.
 */
export interface MatrixView {
	/** Nivel superior: la persona que trajo al usuario conectado. */
	upline: MatrixPerson | null;
	/** Nivel central: el usuario conectado. */
	self: MatrixPerson;
	/** Nivel inferior: los cinco puestos del equipo directo. */
	downline: MatrixNode[];
	/** Avance hacia el siguiente nivel, calculado sobre los puestos de abajo. */
	progress: MatrixProgress;
}

/** Datos mínimos para dibujar a una persona dentro de la matriz. */
export interface MatrixPersonInput {
	id?: string;
	name?: string | null;
	level?: string | null;
}

/** Convierte un nodo del organigrama en una persona de la matriz. */
function toMatrixPerson(
	node: MatrixPersonInput | null | undefined,
	topupsByUser: Readonly<Record<string, string>>
): MatrixPerson {
	const name = node?.name?.trim() || null;
	const topupStatus = name ? topupsByUser[normalize(name)] ?? null : null;
	return {
		name,
		topupStatus,
		state: resolveNodeState(name, topupStatus),
		level: node?.level?.trim() || null,
	};
}

/**
 * Arma la matriz completa: nivel superior, usuario conectado y nivel inferior.
 *
 * Todo se resuelve en el servidor y en un módulo puro, como el resto de la
 * lógica de dinero del panel: el componente solo pinta lo que recibe. Así el
 * admin y cualquier miembro ven exactamente el mismo dibujo.
 */
export function buildMatrixView(params: {
	/** El usuario conectado (raíz de su organigrama personal). */
	self: MatrixPersonInput;
	/** Quien lo trajo, o `null` si no tiene (admin o usuario sin hoja). */
	upline?: MatrixPersonInput | null;
	/** Sus cinco puestos directos. */
	downline?: readonly MatrixPersonInput[];
	/** Estado de la última recarga por nombre normalizado. */
	topupsByUser?: Readonly<Record<string, string>>;
	/** Nivel del usuario conectado (para la barra de ascenso). */
	level: number;
}): MatrixView {
	const topupsByUser = params.topupsByUser ?? {};
	const downline = buildMatrixNodes(params.downline ?? [], topupsByUser);
	return {
		upline: params.upline ? toMatrixPerson(params.upline, topupsByUser) : null,
		self: toMatrixPerson(params.self, topupsByUser),
		downline,
		progress: computeProgress(downline, params.level),
	};
}
