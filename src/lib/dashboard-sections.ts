import type { BusinessSettings } from './business-settings';
import type { User } from './types';
import { DOCUMENT_STATUS } from './testimonials';

/** Configuración estática de cada sección del panel. */
export const DASHBOARD_PAGES = {
	'organigrama-global': {
		title: 'Organigrama Global de Usuarios',
		eyebrow: 'Gana Pro',
		description: 'Consulta la estructura general de usuarios y sus relaciones dentro de la organización.',
	},
	'usuarios-registrados': {
		title: 'Usuarios Registrados',
		eyebrow: 'Gana Pro',
		description: 'Administra la información de las cuentas registradas en la plataforma.',
	},
	retiros: {
		title: 'Solicitudes de Retiro',
		eyebrow: 'Revisión del administrador',
		description: 'Aprueba o rechaza las solicitudes de retiro enviadas por los miembros.',
	},
	ingresos: {
		title: 'Ingresos',
		eyebrow: 'Contabilidad',
		description: 'Centraliza el seguimiento de los ingresos del negocio.',
		cards: [
			{ title: 'Resumen de ingresos', text: 'Consulta los ingresos registrados por período.' },
			{ title: 'Historial', text: 'Revisa el detalle de los movimientos de ingresos.' },
		],
	},
	gastos: {
		title: 'Gastos',
		eyebrow: 'Contabilidad',
		description: 'Centraliza el seguimiento de los gastos del negocio.',
		cards: [
			{ title: 'Resumen de gastos', text: 'Consulta los gastos registrados por período.' },
			{ title: 'Historial', text: 'Revisa el detalle de los movimientos de gastos.' },
		],
	},
	negocio: {
		title: 'Negocio',
		eyebrow: 'Configuración',
		description: 'Administra la configuración general de Gana Pro.',
	},
	usuario: {
		title: 'Usuario',
		eyebrow: 'Configuración',
		description: 'Administra tu cuenta y la información de acceso al panel.',
		cards: [
			{ title: 'Perfil de usuario', text: 'Consulta la información asociada a tu cuenta.' },
			{ title: 'Acceso y seguridad', text: 'Gestiona las preferencias de acceso al panel.' },
		],
	},
} as const;

export type SectionKey = keyof typeof DASHBOARD_PAGES;

export function isSectionKey(section: string): section is SectionKey {
	return section in DASHBOARD_PAGES;
}

/** ¿El rol puede ver las secciones de administración? */
export function isAdminRole(role: string | undefined): boolean {
	const normalized = (role || '').trim().toLowerCase();
	return normalized === 'admin' || normalized === 'administrator';
}

/** Mensaje de confirmación tras guardar el NIT/RUT empresarial. */
export function getBusinessFeedback(params: URLSearchParams): { result: string; message: string } {
	const result = params.get('business') || '';
	const message = params.get('msg') || '';
	return { result, message };
}

/** Mensaje de confirmación tras revisar documentos de usuarios. */
export function getDocumentsFeedback(params: URLSearchParams): { review: string; reviewMessage: string } {
	const review = params.get('review') || '';
	const reviewMessage = params.get('msg') || '';
	return { review, reviewMessage };
}

/** Mensaje de confirmación tras el CRUD de datos de contacto (admin). */
export function getContactFeedback(params: URLSearchParams): { contact: string; contactMessage: string } {
	const contact = params.get('contact') || '';
	const contactMessage = params.get('msg') || '';
	return { contact, contactMessage };
}

export interface UserRowView {
	user: User;
	nit: string;
	documentPdf: boolean;
	approvedDocumentLink: string;
	hasDocument: boolean;
	isApproved: boolean;
}

/** Enriquece cada usuario con el estado de su documento para la tabla. */
export function toUserRowViews(users: User[], settings: BusinessSettings | null): UserRowView[] {
	return users.map((user) => {
		const nit = (user.nit || user.documentNumber || '').trim();
		const documentPdf = (user.scannedRut || user.scannedDocument || '').toLowerCase().endsWith('.pdf');
		const approvedDocumentLink =
			user.documentStatus === DOCUMENT_STATUS.aprobado
				? (user.rutLink || user.documentLink || '').trim()
				: '';
		const hasDocument = Boolean((user.rutLink || user.documentLink || '').trim());
		return {
			user,
			nit,
			documentPdf,
			approvedDocumentLink,
			hasDocument,
			isApproved: user.documentStatus === DOCUMENT_STATUS.aprobado,
		};
	});
}

/** Tarjeta genérica de las secciones sin panel propio (ingresos, gastos, usuario). */
export interface ModuleCard {
	title: string;
	text: string;
}

/** Devuelve las tarjetas de la sección, o lista vacía si no tiene. */
export function getModuleCards(section: SectionKey): readonly ModuleCard[] {
	const entry = DASHBOARD_PAGES[section] as { cards?: readonly ModuleCard[] };
	return entry.cards ?? [];
}
