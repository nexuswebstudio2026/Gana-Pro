import { describe, expect, it } from 'vitest';
import {
	ADMIN_ROLES,
	forbidden,
	isAdminApiPath,
	isAdminDashboardSection,
	isAdminRole,
	isAdminSession,
	normalizeRole,
	unauthorized,
} from './auth';
import type { Session } from './session';

function session(role?: string): Session {
	return {
		token: 't',
		username: 'u',
		email: 'u@test.com',
		role,
		expiresAt: Date.now() + 1000,
	};
}

describe('normalizeRole', () => {
	it('normaliza mayúsculas y espacios', () => {
		expect(normalizeRole('  Admin ')).toBe('admin');
		expect(normalizeRole('ADMINISTRATOR')).toBe('administrator');
	});

	it('devuelve cadena vacía cuando no hay rol', () => {
		expect(normalizeRole(undefined)).toBe('');
		expect(normalizeRole(null)).toBe('');
		expect(normalizeRole('')).toBe('');
	});
});

describe('isAdminRole', () => {
	it('acepta los roles de administrador sin importar mayúsculas ni espacios', () => {
		for (const role of ADMIN_ROLES) {
			expect(isAdminRole(role)).toBe(true);
			expect(isAdminRole(role.toUpperCase())).toBe(true);
			expect(isAdminRole(`  ${role}  `)).toBe(true);
		}
	});

	it('rechaza cualquier otro rol', () => {
		expect(isAdminRole('User')).toBe(false);
		expect(isAdminRole('usuario')).toBe(false);
		expect(isAdminRole('')).toBe(false);
		expect(isAdminRole(undefined)).toBe(false);
		expect(isAdminRole(null)).toBe(false);
	});

	it('no acepta prefijos que solo empiezan como admin', () => {
		// "admin-suspendido" no debe colarse por comparación parcial.
		expect(isAdminRole('admin-suspendido')).toBe(false);
		expect(isAdminRole('xadmin')).toBe(false);
	});
});

describe('isAdminSession', () => {
	it('exige sesión además de rol', () => {
		expect(isAdminSession(session('admin'))).toBe(true);
		expect(isAdminSession(session('User'))).toBe(false);
		expect(isAdminSession(null)).toBe(false);
		expect(isAdminSession(undefined)).toBe(false);
	});
});

describe('isAdminApiPath', () => {
	it('reconoce el prefijo de administración', () => {
		expect(isAdminApiPath('/api/admin')).toBe(true);
		expect(isAdminApiPath('/api/admin/')).toBe(true);
		expect(isAdminApiPath('/api/admin/topups')).toBe(true);
		expect(isAdminApiPath('/api/admin/admin/withdrawals')).toBe(true);
	});

	it('no confunde rutas de usuario con las de administración', () => {
		expect(isAdminApiPath('/api/balance')).toBe(false);
		expect(isAdminApiPath('/api/balance/topup')).toBe(false);
		expect(isAdminApiPath('/api/login')).toBe(false);
		// Un prefijo parecido pero distinto tampoco debe entrar.
		expect(isAdminApiPath('/api/administrador')).toBe(false);
		expect(isAdminApiPath('/api/admin-tools')).toBe(false);
	});
});

describe('isAdminDashboardSection', () => {
	it('marca las secciones reservadas al administrador', () => {
		expect(isAdminDashboardSection('organigrama-global')).toBe(true);
		expect(isAdminDashboardSection('usuarios-registrados')).toBe(true);
		expect(isAdminDashboardSection('negocio')).toBe(true);
		expect(isAdminDashboardSection('ingresos')).toBe(true);
		expect(isAdminDashboardSection('gastos')).toBe(true);
		expect(isAdminDashboardSection('niveles-ascenso')).toBe(true);
		expect(isAdminDashboardSection('usuario')).toBe(true);
	});

	it('deja fuera las páginas personales de cada miembro', () => {
		// Si estas se marcaran como admin, un usuario normal perdería su
		// propio RUT, su ubicación y su información de cuenta.
		expect(isAdminDashboardSection('rut')).toBe(false);
		expect(isAdminDashboardSection('ubicacion')).toBe(false);
		expect(isAdminDashboardSection('informacion-cuenta')).toBe(false);
		expect(isAdminDashboardSection('mi-organigrama')).toBe(false);
		expect(isAdminDashboardSection('recargas')).toBe(false);
		expect(isAdminDashboardSection('retiros')).toBe(false);
	});
});

describe('respuestas de rechazo', () => {
	it('unauthorized responde 401 con JSON', async () => {
		const res = unauthorized();
		expect(res.status).toBe(401);
		expect(res.headers.get('Content-Type')).toBe('application/json');
		expect(await res.json()).toEqual({ ok: false, message: 'Sesión no válida.' });
	});

	it('forbidden responde 403 con JSON', async () => {
		const res = forbidden();
		expect(res.status).toBe(403);
		expect(await res.json()).toEqual({ ok: false, message: 'Sin permisos.' });
	});

	it('aceptan un mensaje propio', async () => {
		expect((await unauthorized('Otro').json()).message).toBe('Otro');
		expect((await forbidden('Otro').json()).message).toBe('Otro');
	});
});
