import {
	buildUserHierarchy,
	buildPersonalHierarchy,
	findUserNode,
	MAX_DIRECT_TEAM,
} from '../src/lib/user-hierarchy.ts';
import type { User } from '../src/lib/types.ts';

let fails = 0;
const check = (ok: boolean, msg: string) => {
	console.log(`${ok ? 'OK   ' : 'FALLA'} ${msg}`);
	if (!ok) fails++;
};

const mk = (n: number): User[] =>
	Array.from({ length: n }, (_, i) => ({
		username: `user_${i + 1}`,
		email: `user_${i + 1}@mail.com`,
		password: 'x',
	}));

const users = mk(40);

// Cada usuario ve como maximo 5 y el usuario conectado es la raiz.
for (const target of [1, 2, 6, 7, 31, 40]) {
	const me = `user_${target}`;
	const p = buildPersonalHierarchy(users, { username: me, email: `${me}@mail.com` });
	const names = p.team.map((t: any) => t.name);
	check(p.root.name === me, `${me}: la raiz es el propio usuario`);
	check(p.root.depth === 0, `${me}: la raiz esta en profundidad 0`);
	check(p.team.length <= MAX_DIRECT_TEAM, `${me}: maximo ${MAX_DIRECT_TEAM} usuarios (tiene ${p.team.length})`);
	check(!p.orphan, `${me}: se encontro en la hoja`);
	// Coincide con la rama del organigrama global.
	const globalNode = findUserNode(buildUserHierarchy(users), { username: me });
	check(
		JSON.stringify(names) === JSON.stringify((globalNode?.children || []).map((c: any) => c.name)),
		`${me}: ve la misma rama del organigrama global -> [${names.join(', ')}]`
	);
}

// Coincidencia por correo aunque el usuario no coincida.
const pMail = buildPersonalHierarchy(users, { username: 'no-existe', email: 'user_7@mail.com' });
check(pMail.root.name === 'user_7', 'localiza por correo si el usuario no coincide');
check(pMail.team.length === 5, `user_7 por correo trae ${pMail.team.length} usuarios`);

// Un usuario hoja sin equipo muestra 5 puestos vacios, no un error.
const pLeaf = buildPersonalHierarchy(users, { username: 'user_40', email: 'user_40@mail.com' });
check(pLeaf.team.length === 0, 'el ultimo usuario no tiene equipo');

// Usuario ausente de la hoja: raiz sola, sin romperse.
const pNew = buildPersonalHierarchy(users, { username: 'recien_registrado', email: 'nuevo@mail.com' });
check(pNew.orphan === true, 'usuario no sincronizado se marca huerfano');
check(pNew.root.name === 'recien_registrado', 'el huerfano conserva su nombre');

// Sin argumentos: no debe lanzar.
const pEmpty = buildPersonalHierarchy(users, {});
check(pEmpty.orphan === true, 'sin identidad no rompe la pagina');

console.log(fails === 0 ? '\nTODAS LAS COMPROBACIONES OK' : `\n${fails} FALLAS`);
process.exit(fails === 0 ? 0 : 1);
