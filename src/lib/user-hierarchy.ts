import type { User } from './types';

export interface OrganizationNode {
	id: string;
	name: string;
	email?: string;
	position: number;
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

function createNode(user: User, position: number): OrganizationNode {
	return {
		id: user.id || user.email || user.username || `user-${position}`,
		name: user.username?.trim() || `Usuario ${position}`,
		email: user.email,
		position,
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
			const child = createNode(orderedUsers[nextUserIndex], position);
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

