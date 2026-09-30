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

/** Máximo de usuarios que cuelgan de cada nodo (incluida la raíz GANA PRO). */
export const MAX_DIRECT_TEAM = 5;

/** Datos mínimos para localizar a una persona dentro del organigrama. */
export interface UserIdentity {
	username?: string;
	email?: string;
}

/** Resultado del organigrama personal: la raíz es el propio usuario. */
export interface PersonalHierarchy {
	/** Nodo raíz: el usuario conectado. */
	root: OrganizationNode;
	/** Sus usuarios del segundo nivel (como máximo `MAX_DIRECT_TEAM`). */
	team: OrganizationNode[];
	/** `true` si el usuario aún no aparece en la hoja de cálculo. */
	orphan: boolean;
}

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

		for (let childIndex = 0; childIndex < MAX_DIRECT_TEAM && nextUserIndex < orderedUsers.length; childIndex++) {
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

/**
 * Localiza el nodo de una persona concreta dentro del organigrama.
 * Se compara por nombre de usuario o por correo, sin distinguir mayúsculas,
 * igual que el resto del panel. Devuelve `null` si no está en el árbol.
 */
export function findUserNode(root: OrganizationNode, identity: UserIdentity): OrganizationNode | null {
	const username = normalize(identity.username);
	const email = normalize(identity.email);
	if (!username && !email) return null;

	const stack: OrganizationNode[] = [root];
	while (stack.length > 0) {
		const node = stack.pop();
		if (!node) break;
		const matchesName = username && normalize(node.name) === username;
		const matchesEmail = email && normalize(node.email) === email;
		if (matchesName || matchesEmail) return node;
		node.children.forEach((child) => stack.push(child));
	}

	return null;
}

/**
 * Organigrama personal: el usuario conectado es la raíz y solo se muestran
 * sus usuarios del segundo nivel, como máximo cinco.
 *
 * Se apoya en la misma estructura 5x5 del organigrama global, así que cada
 * persona ve exactamente la misma rama que se le asignó al registrarse, sin
 * duplicar reglas de reparto.
 *
 * Si el usuario todavía no está en la hoja (p. ej. acaba de registrarse) se
 * devuelve una raíz sin equipo para que la página nunca quede en blanco.
 */
export function buildPersonalHierarchy(
	users: User[],
	identity: UserIdentity
): PersonalHierarchy {
	const globalRoot = buildUserHierarchy(users);
	const node = findUserNode(globalRoot, identity);

	if (!node) {
		const name = (identity.username || '').trim() || 'Mi organigrama';
		return {
			root: {
				id: 'self',
				name,
				email: identity.email,
				position: 1,
				depth: 0,
				children: [],
			},
			team: [],
			orphan: true,
		};
	}

	// El nodo encontrado se convierte en la raíz: sus hijos pasan a ser el
	// segundo nivel y se descarta el resto de la rama.
	const root: OrganizationNode = {
		...node,
		depth: 0,
		children: node.children.slice(0, MAX_DIRECT_TEAM),
	};

	return {
		root,
		team: root.children,
		orphan: false,
	};
}


