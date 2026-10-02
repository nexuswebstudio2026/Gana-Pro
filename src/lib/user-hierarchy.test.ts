import { describe, expect, it } from 'vitest';
import {
	buildUserHierarchy,
	buildPersonalHierarchy,
	countByLevel,
	countOrganizationUsers,
	findUserNode,
	maxOrganizationDepth,
	MAX_DIRECT_TEAM,
} from './user-hierarchy';
import type { User } from './types';

/** Usuario mínimo con la hoja de cálculo como origen. */
function user(username: string, extra: Partial<User> = {}): User {
	return { username, email: `${username}@test.com`, password: 'x', ...extra };
}

/** Nombres de todos los descendientes de un nodo, en orden de recorrido. */
function names(node: { children: { name: string; children: any[] }[] }): string[] {
	return node.children.flatMap((child) => [child.name, ...names(child)]);
}

describe('buildUserHierarchy', () => {
	it('crea la raíz GANA PRO aunque no haya usuarios', () => {
		const root = buildUserHierarchy([]);
		expect(root.name).toBe('GANA PRO');
		expect(root.depth).toBe(0);
		expect(root.children).toHaveLength(0);
		expect(countOrganizationUsers(root)).toBe(0);
	});

	it('asigna los primeros usuarios directamente a la raíz', () => {
		const root = buildUserHierarchy([user('ana'), user('beto'), user('cami')]);
		expect(root.children.map((c) => c.name)).toEqual(['ana', 'beto', 'cami']);
		expect(root.children.every((c) => c.depth === 1)).toBe(true);
	});

	it('nunca cuelga más de MAX_DIRECT_TEAM usuarios de un mismo nodo', () => {
		const root = buildUserHierarchy(Array.from({ length: 40 }, (_, i) => user(`u${i}`)));
		const visit = (node: ReturnType<typeof buildUserHierarchy>) => {
			expect(node.children.length).toBeLessThanOrEqual(MAX_DIRECT_TEAM);
			node.children.forEach(visit);
		};
		visit(root);
	});

	it('coloca a todos los usuarios exactamente una vez', () => {
		const root = buildUserHierarchy(Array.from({ length: 40 }, (_, i) => user(`u${i}`)));
		const seen = names(root);
		expect(seen).toHaveLength(40);
		expect(new Set(seen).size).toBe(40);
	});

	it('excluye de la raíz a los usuarios que son la propia raíz', () => {
		// Un usuario llamado "gana pro", o con un correo de la casa, no debe
		// aparecer dos veces: una como raíz sintética y otra como hijo suyo.
		const root = buildUserHierarchy([
			user('gana pro'),
			user('beto', { email: 'gana-pro@corp.com' }),
			user('ana'),
		]);
		const all = ['GANA PRO', ...names(root)];
		expect(all.filter((n) => n.toLowerCase() === 'gana pro')).toHaveLength(1);
		expect(names(root)).toEqual(['ana']);
	});

	it('da identificadores únicos aunque la hoja repita usuario o correo', () => {
		// Sin el prefijo de posición, dos usuarios con id vacío compartirían id
		// y el organigrama dejaría de poder navegar.
		const root = buildUserHierarchy([
			user('ana', { id: '' }),
			user('beto', { id: '' }),
			user('cami', { email: '' }),
		]);
		const ids: string[] = [];
		const visit = (node: ReturnType<typeof buildUserHierarchy>) => {
			ids.push(node.id);
			node.children.forEach(visit);
		};
		visit(root);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('numera las posiciones de forma consecutiva desde la raíz', () => {
		const root = buildUserHierarchy([user('ana'), user('beto')]);
		expect(root.position).toBe(1);
		expect(root.children.map((c) => c.position)).toEqual([2, 3]);
	});
});



describe('countByLevel y maxOrganizationDepth', () => {
	it('cuenta los nodos por profundidad, incluida la raíz', () => {
		const root = buildUserHierarchy(Array.from({ length: 6 }, (_, i) => user(`u${i}`)));
		const counts = countByLevel(root);
		// La raíz más los 6 usuarios: el sexto cuelga de un hijo porque la
		// raíz ya alcanzó su cupo de MAX_DIRECT_TEAM.
		expect(counts.reduce((sum, c) => sum + c.count, 0)).toBe(7);
		expect(counts[0]).toEqual({ level: 0, count: 1 });
	});

	it('devuelve profundidad 0 cuando no hay usuarios', () => {
		expect(maxOrganizationDepth(buildUserHierarchy([]))).toBe(0);
	});

	it('crece la profundidad al añadir usuarios', () => {
		const pocos = buildUserHierarchy(Array.from({ length: 5 }, (_, i) => user(`a${i}`)));
		const muchos = buildUserHierarchy(Array.from({ length: 15 }, (_, i) => user(`b${i}`)));
		expect(maxOrganizationDepth(muchos)).toBeGreaterThan(maxOrganizationDepth(pocos));
	});
});

describe('findUserNode', () => {
	it('localiza a un usuario por nombre o por correo, sin distinguir mayúsculas', () => {
		const root = buildUserHierarchy([user('Ana'), user('Beto')]);
		expect(findUserNode(root, { username: 'ana' })?.name).toBe('Ana');
		expect(findUserNode(root, { email: 'BETO@TEST.COM' })?.name).toBe('Beto');
	});

	it('devuelve null si no está en el árbol', () => {
		const root = buildUserHierarchy([user('ana')]);
		expect(findUserNode(root, { username: 'fantasma' })).toBeNull();
		expect(findUserNode(root, {})).toBeNull();
	});
});

describe('buildPersonalHierarchy', () => {
	it('el administrador ve el árbol en vez de una vista vacía', () => {
		// El admin es la raíz de GANA PRO y queda fuera del árbol global, así que
		// sin este caso su organigrama personal salía vacío.
		const usuarios = [user('ganapro'), user('ana'), user('beto')];
		const personal = buildPersonalHierarchy(usuarios, {
			username: 'ganapro',
			email: 'admin@test.com',
		});
		expect(personal.orphan).toBe(false);
		expect(personal.root.name).toBe('GANA PRO');
		expect(personal.team.length).toBeGreaterThan(0);
	});

	it('un miembro normal sigue viendo solo su rama', () => {
		// Regresión: si la detección de raíz no exige ser el usuario raíz, un
		// miembro normal acabaría viendo el árbol completo.
		const usuarios = [user('ganapro'), user('ana'), user('beto')];
		const personal = buildPersonalHierarchy(usuarios, {
			username: 'ana',
			email: 'ana@test.com',
		});
		expect(personal.root.name).toBe('ana');
	});

	it('el miembro ve toda su rama, no solo los usuarios directos', () => {
		// Regresión: antes la rama se recortaba al primer nivel y un miembro no
		// veía a los usuarios de sus usuarios.
		// Hacen falta muchos usuarios para que un nodo tenga nietos: la raíz
		// toma 5, sus hijos toman 5 cada uno (25), y solo entonces los nietos
		// del primero reciben los siguientes.
		const usuarios = [
			user('ganapro'),
			...Array.from({ length: 40 }, (_, i) => user(`u${i}`)),
		];
		const personal = buildPersonalHierarchy(usuarios, { username: 'u0', email: 'u0@test.com' });

		const niveles: number[] = [];
		const recorrer = (n: ReturnType<typeof buildUserHierarchy>) => {
			niveles.push(n.depth);
			n.children.forEach(recorrer);
		};
		recorrer(personal.root);

		// La rama de u0 incluye a los usuarios de sus usuarios: hay al menos
		// un nodo a dos niveles de distancia.
		expect(niveles.some((d) => d >= 2)).toBe(true);
	});

	it('marca como huérfano a un usuario que aún no está en la hoja', () => {
		const personal = buildPersonalHierarchy([user('ana')], {
			username: 'recien-registrado',
			email: 'nuevo@test.com',
		});
		expect(personal.orphan).toBe(true);
		expect(personal.root.name).toBe('recien-registrado');
		expect(personal.team).toHaveLength(0);
	});

	it('el usuario conectado es la raíz y solo ve su equipo directo', () => {
		const users = Array.from({ length: 20 }, (_, i) => user(`u${i}`));
		// u0 cuelga de la raíz y concentra el primer grupo de cinco usuarios,
		// así que sí tiene equipo: es el caso interesante.
		const personal = buildPersonalHierarchy(users, { username: 'u0' });

		expect(personal.orphan).toBe(false);
		expect(personal.root.name).toBe('u0');
		expect(personal.root.depth).toBe(0);
		expect(personal.team).toHaveLength(MAX_DIRECT_TEAM);
		// El equipo son sus hijos directos, sin nietos.
		expect(personal.team.every((node) => node.depth === 1)).toBe(true);
		expect(personal.team.every((node) => node.children.length === 0)).toBe(true);
	});

	it('un usuario sin equipo ve una raíz vacía en lugar de una página en blanco', () => {
		const users = Array.from({ length: 20 }, (_, i) => user(`u${i}`));
		const personal = buildPersonalHierarchy(users, { username: 'u19' });
		expect(personal.orphan).toBe(false);
		expect(personal.root.name).toBe('u19');
		expect(personal.team).toHaveLength(0);
	});

	it('el equipo personal coincide con la rama del organigrama global', () => {
		// La misma persona debe ver exactamente la rama que se le asignó al
		// registrarse: por eso se apoya en el árbol global y no en reglas aparte.
		const users = Array.from({ length: 20 }, (_, i) => user(`u${i}`));
		const globalRoot = buildUserHierarchy(users);
		const personal = buildPersonalHierarchy(users, { username: 'u3' });

		const globalNode = findUserNode(globalRoot, { username: 'u3' });
		expect(personal.team.map((n) => n.name)).toEqual(
			(globalNode?.children ?? []).slice(0, MAX_DIRECT_TEAM).map((n) => n.name)
		);
	});

});