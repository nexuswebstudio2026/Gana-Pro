import type { User } from './types';

export interface OrganizationNode {
	id: string;
	name: string;
	email?: string;
	position: number;
	/** Profundidad en el árbol (raíz = 0). */
	depth: number;
	role?: string;
	level?: string;
	status?: string;
	children: OrganizationNode[];
}

const ROOT_ALIASES = new Set(['gana pro', 'ganapro', 'gana-pro']);

function normalize(value: string | undefined): string {
	return (value || '').trim().toLowerCase();
}

function isRootUser(user: User): boolean {
	const username = normalize(user.username);
	const email = normalize(user.email);
	return ROOT_ALIASES.has(username) || ROOT_ALIASES.has(email) || email.startsWith('gana-pro@');
}

function createNode(user: User, position: number, depth: number): OrganizationNode {
	return {
		// El `id` es único por posición porque el organigrama navega por él
		// (buscador, migas de pan y botón "Ver ›"). La hoja puede traer el ID,
		// el correo o el usuario vacíos o repetidos, así que no sirve como
		// identificador por sí solo: sin el prefijo, dos usuarios distintos
		// comparten id y el que se indexa último deja de responder.
		id: `${position}-${user.id || user.email || user.username || 'user'}`,
		name: user.username?.trim() || `Usuario ${position}`,
		email: user.email,
		position,
		depth,
		role: user.role?.trim(),
		level: user.level?.trim(),
		status: user.documentStatus?.trim(),
		children: [],
	};
}

/**
 * Construye el organigrama usando el orden de registro recibido.
 * La raíz recibe los primeros cinco usuarios y cada nodo siguiente
 * recibe el siguiente bloque de cinco usuarios disponibles.
 */
export function buildUserHierarchy(users: User[]): OrganizationNode {
	const root: OrganizationNode = {
		id: 'gana-pro',
		name: 'GANA PRO',
		position: 1,
		depth: 0,
		children: [],
	};

	const orderedUsers = users.filter((user) => !isRootUser(user));
	const queue: OrganizationNode[] = [root];
	let nextUserIndex = 0;
	let position = 2;

	while (nextUserIndex < orderedUsers.length) {
		const parent = queue.shift();
		if (!parent) break;

		for (let childIndex = 0; childIndex < 5 && nextUserIndex < orderedUsers.length; childIndex++) {
			const child = createNode(orderedUsers[nextUserIndex], position, parent.depth + 1);
			position++;
			nextUserIndex++;
			parent.children.push(child);
			queue.push(child);
		}
	}

	return root;
}

export function countOrganizationUsers(node: OrganizationNode): number {
	return node.children.reduce((total, child) => total + 1 + countOrganizationUsers(child), 0);
}

/** Profundidad máxima del árbol (raíz = 0). */
export function maxOrganizationDepth(node: OrganizationNode): number {
	if (node.children.length === 0) return node.depth;
	return node.children.reduce((max, child) => Math.max(max, maxOrganizationDepth(child)), node.depth);
}

/** Conteo de nodos directos + descendientes por cada nivel. */
export function countByLevel(node: OrganizationNode): { level: number; count: number }[] {
	const counts = new Map<number, number>();
	const visit = (current: OrganizationNode) => {
		counts.set(current.depth, (counts.get(current.depth) || 0) + 1);
		current.children.forEach(visit);
	};
	visit(node);
	return [...counts.entries()]
		.map(([level, count]) => ({ level, count }))
		.sort((a, b) => a.level - b.level);
}

