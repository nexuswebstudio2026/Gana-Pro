import type { User } from './types';
import { isAdminRole } from './auth';

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

/** Identificador de la raíz del organigrama. */
export const ORGANIZATION_ROOT_ID = 'gana-pro';

/** Nombre visible de la raíz del organigrama. */
export const ORGANIZATION_ROOT_NAME = 'GANA PRO';

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
	/**
	 * Nodo que está por encima del usuario en la matriz: quien lo trajo.
	 *
	 * Es `null` para el administrador (es la raíz de GANA PRO, no tiene nadie
	 * encima) y para un usuario que todavía no aparece en la hoja.
	 */
	upline: OrganizationNode | null;
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
		id: ORGANIZATION_ROOT_ID,
		name: ORGANIZATION_ROOT_NAME,
		position: 1,
		depth: 0,
		children: [],
	};

	const orderedUsers = users.filter((user) => !isRootUser(user) && !isAdminRole(user.role));
	let position = 2;
	const nodes = orderedUsers.map((user) => createNode(user, position++, 0));
	const byName = new Map(nodes.map((node) => [normalize(node.name), node]));
	const byEmail = new Map(nodes.filter((node) => node.email).map((node) => [normalize(node.email), node]));
	const reachable = new Set<OrganizationNode>([root]);
	const assigned = new Set<OrganizationNode>();
	const rootNames = ROOT_ALIASES;

	// Si el usuario eligió líder al hacer su aporte, conservamos esa posición.
	// Se resuelven primero las relaciones cuyo padre ya está conectado a la raíz.
	let progressed = true;
	while (progressed) {
		progressed = false;
		for (let i = 0; i < orderedUsers.length; i++) {
			const user = orderedUsers[i];
			const node = nodes[i];
			if (assigned.has(node)) continue;
			const chosenParent = normalize(user.matrixParent);
			if (!chosenParent) continue;
			const parent = rootNames.has(chosenParent) ? root : byName.get(chosenParent) ?? byEmail.get(chosenParent);
			if (!parent || !reachable.has(parent) || parent.children.length >= MAX_DIRECT_TEAM) continue;
			parent.children.push(node);
			node.depth = parent.depth + 1;
			reachable.add(node);
			assigned.add(node);
			progressed = true;
		}
	}

	// Los usuarios sin líder explícito (o con un líder que ya completó sus cinco
	// puestos) conservan el llenado por orden de Google Sheets.
	const queue: OrganizationNode[] = [root, ...nodes.filter((node) => reachable.has(node))];
	for (const node of nodes) {
		if (assigned.has(node)) continue;
		while (queue.length && queue[0].children.length >= MAX_DIRECT_TEAM) queue.shift();
		const parent = queue[0];
		if (!parent) break;
		parent.children.push(node);
		node.depth = parent.depth + 1;
		assigned.add(node);
		queue.push(node);
	}

	return root;
}

export function countOrganizationUsers(node: OrganizationNode): number {
	return node.children.reduce((total, child) => total + 1 + countOrganizationUsers(child), 0);
}

/**
 * Localiza a la persona que trajo a otra: su nodo padre en el organigrama.
 *
 * Es lo que necesita el envío del 50 % para saber a quién acreditarle el
 * dinero. Se recorre el árbol llevando el padre de cada nodo, porque
 * `OrganizationNode` no guarda un puntero al suyo (serializarlo rompería la
 * estructura que ya se envía al navegador).
 *
 * Devuelve `null` si la persona no está en el árbol o si es la raíz: la raíz
 * GANA PRO no es un usuario al que se le pueda enviar saldo.
 */
export function findUserParent(
	root: OrganizationNode,
	identity: UserIdentity
): OrganizationNode | null {
	const username = normalize(identity.username);
	const email = normalize(identity.email);
	if (!username && !email) return null;

	const stack: Array<{ node: OrganizationNode; parent: OrganizationNode | null }> = [
		{ node: root, parent: null },
	];

	while (stack.length > 0) {
		const entry = stack.pop();
		if (!entry) break;
		const { node, parent } = entry;

		const matchesName = username && normalize(node.name) === username;
		const matchesEmail = email && normalize(node.email) === email;
		// La raíz no cuenta como patrocinador de nadie.
		if (parent && (matchesName || matchesEmail)) return parent;

		node.children.forEach((child) => stack.push({ node: child, parent: node }));
	}

	return null;
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

	// El administrador es la raíz de GANA PRO y, por diseño, queda FUERA del
	// árbol global (su lugar lo ocupa el nodo "GANA PRO"). Sin este caso
	// especial `findUserNode` no lo encontraba nunca y el admin veía siempre un
	// organigrama vacío: su rama es justamente el árbol entero.
	//
	// La comprobación exige `isRootUser`: con solo comparar contra la lista de
	// usuarios daría true para cualquiera, y todos verían el árbol completo.
	const identidad = (user: User): boolean =>
		(normalize(identity.username) !== '' && normalize(user.username) === normalize(identity.username)) ||
		(normalize(identity.email) !== '' && normalize(user.email) === normalize(identity.email));
	const esRaiz = users.some((user) => isRootUser(user) && identidad(user));
	if (esRaiz) {
		const root: OrganizationNode = {
			...globalRoot,
			depth: 0,
			children: globalRoot.children.slice(0, MAX_DIRECT_TEAM),
		};
		// El admin ES la raíz: no hay nadie por encima de él, así que el nivel
		// superior de su matriz queda vacío en vez de mostrar un patrocinador
		// inventado (él mismo).
		return { root, team: root.children, upline: null, orphan: false };
	}

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
			upline: null,
			orphan: true,
		};
	}

	// El nodo encontrado se convierte en la raíz de la vista personal. Ya no se
	// recorta su rama a los cinco directos: el miembro ve TODA su rama, con los
	// usuarios de sus usuarios y los de los siguientes niveles.
	const root: OrganizationNode = {
		...node,
		depth: 0,
		children: node.children,
	};

	// Al mover el nodo a la raíz hay que rebasar la profundidad de su rama: si
	// el usuario estaba en el nivel 2 del árbol global, sus hijos venían con
	// profundidad 3 y al dibujarlos como equipo directo quedarían descolgados
	// un nivel por debajo. Antes se conservaba la profundidad original y el
	// organigrama personal mostraba los niveles mal alineados.
	const rebasar = (current: OrganizationNode, depth: number): void => {
		current.depth = depth;
		current.children.forEach((child) => rebasar(child, depth + 1));
	};
	rebasar(root, 0);

	return {
		root,
		team: root.children,
		// El nivel superior se busca en el árbol GLOBAL (no en `root`, que ya
		// está rebasado): es el único sitio donde el padre del usuario sigue
		// siendo el patrocinador real y no un hijo suyo.
		upline: findUserParent(globalRoot, identity),
		orphan: false,
	};
}


