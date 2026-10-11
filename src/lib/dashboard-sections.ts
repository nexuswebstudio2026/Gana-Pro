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
	'niveles-ascenso': {
		title: 'Niveles de Ascenso',
		eyebrow: 'Gana Pro',
		description: 'Consulta la escala de niveles y los requisitos para ascender en la organización.',
		cards: [
			{ title: 'Escala de niveles', text: 'Revisa los niveles disponibles: Bronce, Plata, Rubí, Diamante y Oro.' },
			{ title: 'Requisitos de ascenso', text: 'Consulta las condiciones que debe cumplir un miembro para subir de nivel.' },
			{ title: 'Beneficios por nivel', text: 'Mira qué operaciones habilita cada nivel dentro de la plataforma.' },
		],
	},
	recargas: {
		title: 'Solicitudes de Recarga',
		eyebrow: 'Revisión del administrador',
		description: 'Compara el monto solicitado con el comprobante y aprueba la recarga.',
	},
	retiros: {
		title: 'Solicitudes de Retiro',
		eyebrow: 'Revisión del administrador',
		description: 'Aprueba o rechaza las solicitudes de retiro enviadas por los miembros.',
	},
	ingresos: {
		title: 'Ingresos',
		eyebrow: 'Contabilidad',
		description: 'El resumen contable de ingresos aún no está conectado a un registro consolidado.',
		cards: [
			{ title: 'Resumen de ingresos', text: 'Esta sección todavía no calcula totales por período. Revisa los módulos de recargas, retiros, comisiones y pagos P2P para consultar sus operaciones.' },
			{ title: 'Historial consolidado', text: 'Aún no hay un historial contable unificado en esta vista.' },
		],
	},
	gastos: {
		title: 'Gastos',
		eyebrow: 'Contabilidad',
		description: 'El registro contable de gastos todavía no está disponible en el panel.',
		cards: [
			{ title: 'Resumen de gastos', text: 'Esta sección aún no captura ni agrupa gastos por período.' },
			{ title: 'Historial de gastos', text: 'Todavía no hay un registro de gastos conectado a esta vista.' },
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
		description: 'Esta vista aún no incluye herramientas de administración de cuentas.',
		cards: [
			{ title: 'Perfil de usuario', text: 'Consulta la información del perfil desde Información de cuenta.' },
			{ title: 'Acceso y seguridad', text: 'La gestión de credenciales y preferencias aún no está disponible en esta sección.' },
		],
	},
} as const;

export type SectionKey = keyof typeof DASHBOARD_PAGES;

export function isSectionKey(section: string): section is SectionKey {
	return section in DASHBOARD_PAGES;
}

/** ¿El rol puede ver las secciones de administración? */
export { isAdminRole } from './auth';

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
