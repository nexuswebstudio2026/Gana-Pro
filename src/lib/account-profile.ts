/**
 * Validación y formato de los datos de contacto y residencia que el usuario
 * edita en "Información de la cuenta" (dirección, barrio, ciudad, teléfono y
 * WhatsApp). Se usa tanto por el formulario como por el endpoint que los guarda.
 */
import type { UserProfileFields } from './sheets';
import {
	WALLET_NUMBER_MAX,
	WALLET_TYPE_MAX,
	isValidWalletNumber,
	isValidWalletType,
	normalizeWalletNumber,
	normalizeWalletType,
} from './account-wallet';

/** Perfil de contacto con todos los campos presentes (pueden ir vacíos). */
export type AccountProfile = Required<
	Pick<
		UserProfileFields,
		| 'address'
		| 'neighborhood'
		| 'city'
		| 'phone'
		| 'whatsapp'
		| 'walletType'
		| 'walletNumber'
	>
>;

/** Longitud máxima de cada campo, para no desbordar la celda de la hoja. */
export const PROFILE_FIELD_LIMITS: Record<keyof AccountProfile, number> = {
	address: 160,
	neighborhood: 80,
	city: 80,
	phone: 30,
	whatsapp: 30,
	walletType: WALLET_TYPE_MAX,
	walletNumber: WALLET_NUMBER_MAX,
};

/** Etiqueta de cada campo, en el orden en que se muestran. */
export const PROFILE_FIELD_LABELS: Record<keyof AccountProfile, string> = {
	address: 'Dirección de residencia',
	neighborhood: 'Barrio',
	city: 'Ciudad de residencia',
	phone: 'Teléfono de contacto',
	whatsapp: 'Contacto de WhatsApp',
	walletType: 'Tipo de billetera',
	walletNumber: 'Número de billetera',
};

/** Los cinco campos del perfil, en el orden de la hoja. */
export const PROFILE_FIELDS = Object.keys(PROFILE_FIELD_LABELS) as (keyof AccountProfile)[];

/** Perfil sin ningún dato: el usuario todavía no ha registrado su contacto. */
export function isProfileEmpty(profile: AccountProfile): boolean {
	return PROFILE_FIELDS.every((key) => !profile[key]);
}

/** Cuántos de los cinco campos tienen valor (para el resumen "3 de 5"). */
export function filledProfileCount(profile: AccountProfile): number {
	return PROFILE_FIELDS.filter((key) => Boolean(profile[key])).length;
}

/** Un teléfono solo admite dígitos y los separadores habituales. */
const PHONE_ALLOWED = /^[0-9+()\s.-]+$/;

/** Mínimo de dígitos de un teléfono válido (en Colombia son 10). */
const PHONE_MIN_DIGITS = 7;

/** Máximo de dígitos de un teléfono válido (E.164 admite 15). */
const PHONE_MAX_DIGITS = 15;

/** Colapsa espacios y recorta, para no guardar celdas con relleno. */
export function cleanText(value: unknown, maxLength: number): string {
	return String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maxLength);
}

/** ¿El teléfono tiene un formato válido? Solo dígitos y separadores. */
export function isValidPhone(value: string): boolean {
	if (!PHONE_ALLOWED.test(value)) return false;
	const digits = value.replace(/\D/g, '');
	return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS;
}

/**
 * Enlace de WhatsApp a partir del número guardado (solo dígitos, con prefijo 57
 * para Colombia). Devuelve una cadena vacía si no hay un número utilizable.
 */
export function whatsappLink(number: string | undefined): string {
	const digits = String(number ?? '').replace(/\D/g, '');
	if (digits.length < PHONE_MIN_DIGITS) return '';
	const international = digits.startsWith('57') ? digits : `57${digits}`;
	return `https://wa.me/${international}`;
}

/** Texto tal y como se muestra en pantalla, o `null` si no hay dato. */
export function displayValue(value: string | undefined): string | null {
	const text = String(value ?? '').trim();
	return text || null;
}

/** Resultado de validar el formulario de contacto. */
export interface ProfileParseResult {
	profile?: AccountProfile;
	/** Mensaje para el usuario. */
	error?: string;
	/** Campo que originó el error, para marcar solo ese input. */
	field?: keyof AccountProfile;
}

/**
 * Valida y normaliza los datos enviados por el formulario de la cuenta.
 *
 * Todos los campos son opcionales (se pueden dejar vacíos o borrar), pero si se
 * escriben deben tener un formato válido.
 */
export function parseProfileForm(formData: FormData): ProfileParseResult {
	const address = cleanText(formData.get('address'), PROFILE_FIELD_LIMITS.address);
	const neighborhood = cleanText(formData.get('neighborhood'), PROFILE_FIELD_LIMITS.neighborhood);
	const city = cleanText(formData.get('city'), PROFILE_FIELD_LIMITS.city);
	const phone = cleanText(formData.get('phone'), PROFILE_FIELD_LIMITS.phone);
	const whatsapp = cleanText(formData.get('whatsapp'), PROFILE_FIELD_LIMITS.whatsapp);
	const walletType = normalizeWalletType(formData.get('walletType'));
	const walletNumber = normalizeWalletNumber(formData.get('walletNumber'));

	const phoneHelp = 'solo admite números y los signos + ( ) - (7 a 15 dígitos).';
	if (phone && !isValidPhone(phone)) {
		return { field: 'phone', error: `El teléfono ${phoneHelp}` };
	}
	if (whatsapp && !isValidPhone(whatsapp)) {
		return { field: 'whatsapp', error: `El contacto de WhatsApp ${phoneHelp}` };
	}
	if (!isValidWalletType(walletType)) {
		return { field: 'walletType', error: 'El tipo de billetera solo admite letras y los signos . - _' };
	}
	if (!isValidWalletNumber(walletNumber)) {
		return {
			field: 'walletNumber',
			error: `El número de billetera solo admite letras, números y los signos @ + - . (entre 4 y ${PROFILE_FIELD_LIMITS.walletNumber} caracteres)`,
		};
	}

	return {
		profile: { address, neighborhood, city, phone, whatsapp, walletType, walletNumber },
	};
}

/** Valores iniciales del formulario a partir del registro del usuario. */
export function profileToFormValues(user: UserProfileFields): AccountProfile {
	return {
		address: String(user.address ?? '').trim(),
		neighborhood: String(user.neighborhood ?? '').trim(),
		city: String(user.city ?? '').trim(),
		phone: String(user.phone ?? '').trim(),
		whatsapp: String(user.whatsapp ?? '').trim(),
		// La billetera vive en las columnas "Método de Pago" y "Número de
		// Billetera" de la hoja, de ahí los nombres históricos del tipo `User`.
		walletType: String(
			user.walletType ?? (user as { paymentMethod?: string }).paymentMethod ?? ''
		).trim(),
		walletNumber: String(user.walletNumber ?? '').trim(),
	};
}