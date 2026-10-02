/**
 * Validación del tipo y el número de billetera que declara el usuario en
 * "Información de la cuenta".
 *
 * Vive aparte de `account-profile` porque, a diferencia de los datos de
 * contacto, estos dos se usan para pagarle: un valor mal escrito tiene
 * consecuencias de dinero, así que se validan con reglas propias y no como
 * un campo de texto más.
 */

/** Tipos de billetera más usados en Colombia, como sugerencias del formulario. */
export const WALLET_TYPE_SUGGESTIONS = [
	'Nequi',
	'Daviplata',
	'Bre-B',
	'Bancolombia',
	'PSE',
	'Tigo Money',
	'PayPal',
] as const;

/** Longitud máxima del tipo de billetera. */
export const WALLET_TYPE_MAX = 30;

/** Longitud máxima del número o alias de billetera. */
export const WALLET_NUMBER_MAX = 40;

/** Longitud mínima: por debajo es ruido, no una billetera. */
const WALLET_NUMBER_MIN = 4;

/** El tipo admite letras, dígitos y separadores habituales ("Bre-B"). */
const WALLET_TYPE_ALLOWED = /^[A-Za-zÁÉÍÓÚÑáéíóúñ0-9 ._-]+$/;

/**
 * El número admite letras, dígitos y los signos de un alias: un Nequi es solo
 * un número, pero un Bre-B empieza por `@` y un alias puede llevar `+` y `-`.
 */
const WALLET_NUMBER_ALLOWED = /^[A-Za-zÁÉÍÓÚÑáéíóúñ0-9 @._+-]+$/;

/** Colapsa espacios y recorta, igual que en el resto de campos de texto. */
function clean(value: unknown): string {
	return String(value ?? '')
		.replace(/\s+/g, ' ')
		.trim();
}

/** Deja el tipo de billetera listo para guardarse (trim y sin espacios de más). */
export function normalizeWalletType(value: unknown): string {
	return clean(value).slice(0, WALLET_TYPE_MAX);
}

/** Deja el número de billetera listo para guardarse. */
export function normalizeWalletNumber(value: unknown): string {
	return clean(value).slice(0, WALLET_NUMBER_MAX);
}

/** ¿El tipo de billetera tiene un formato válido? Vacío es válido (opcional). */
export function isValidWalletType(value: string): boolean {
	if (!value) return true;
	return WALLET_TYPE_ALLOWED.test(value);
}

/** ¿El número de billetera tiene un formato válido? Vacío es válido (opcional). */
export function isValidWalletNumber(value: string): boolean {
	if (!value) return true;
	return (
		WALLET_NUMBER_ALLOWED.test(value) &&
		value.length >= WALLET_NUMBER_MIN &&
		value.length <= WALLET_NUMBER_MAX
	);
}