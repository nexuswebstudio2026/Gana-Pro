import type { APIRoute } from 'astro';
import { hashPassword } from '../../lib/crypto';
import { readJSON, writeJSON } from '../../lib/store';
import {
	getGoogleSheetUsers,
	appendGoogleSheetUser,
	ensureUserProfileColumns,
} from '../../lib/sheets';
import {
	cleanText,
	isValidPhone,
	PROFILE_FIELD_LIMITS,
} from '../../lib/account-profile';
import { findReferrerByCode, ownCodeOf } from '../../lib/referrals';
import { normalizeDocumentType, esNitValido } from '../../lib/testimonials';
import type { RegistrationContact } from '../../lib/sheets';
import type { User } from '../../lib/types';

/**
 * Lee y normaliza los cinco datos de contacto del formulario de registro.
 *
 * Devuelve `null` si falta alguno: en el registro son obligatorios, porque sin
 * ellos el usuario queda sin forma de ser contacto por el negocio.
 */
function parseRegistrationContact(params: URLSearchParams): RegistrationContact | null {
	const contact: RegistrationContact = {
		address: cleanText(params.get('address'), PROFILE_FIELD_LIMITS.address),
		neighborhood: cleanText(params.get('neighborhood'), PROFILE_FIELD_LIMITS.neighborhood),
		city: cleanText(params.get('city'), PROFILE_FIELD_LIMITS.city),
		phone: cleanText(params.get('phone'), PROFILE_FIELD_LIMITS.phone),
		whatsapp: cleanText(params.get('whatsapp'), PROFILE_FIELD_LIMITS.whatsapp),
	};
	return contact.address && contact.neighborhood && contact.city && contact.phone && contact.whatsapp
		? contact
		: null;
}

// API routes must be server-rendered, not prerendered as static
export const prerender = false;

export const POST: APIRoute = async (Astro) => {
	try {
		// Parse form data from the request body
		const body = await Astro.request.text();
		const params = new URLSearchParams(body);
		const username = params.get('username')?.trim() ?? '';
		const email = params.get('email')?.trim().toLowerCase() ?? '';
		const password = params.get('password') ?? '';
		const passwordConfirm = params.get('passwordConfirm') ?? '';
		const referralInput = params.get('ref')?.trim() ?? '';
		// El formulario marca con `refFromLink` el código que vino del enlace de
		// referido. Solo ese se reenvía en la URL de error, para que el campo siga
		// precargado y bloqueado; uno escrito a mano se descarta, como ya pasaba.
		// Los errores propios del código usan `keepRef = false`: sin eso, el campo
		// quedaría bloqueado con un código que ya se sabe inválido y no habría
		// forma de corregirlo ni de registrarse sin él.
		const refFromLink = params.get('refFromLink') === '1';
		const errorParam = (msg: string, keepRef = true) => {
			const query = new URLSearchParams({ error: msg });
			if (keepRef && refFromLink && referralInput) query.set('ref', referralInput);
			return Astro.redirect('/register?' + query.toString(), 303);
		};

		// --- Validation ---
		if (!username || !email || !password) {
			return errorParam('Todos los campos son obligatorios.');
		}
		if (password !== passwordConfirm) {
			return errorParam('Las contraseñas no coinciden.');
		}
		if (password.length < 6) {
			return errorParam('La contraseña debe tener al menos 6 caracteres.');
		}

		// --- Tipo y número de documento ---
		// Se validan contra el catálogo, no contra lo que llegue: el `select` del
		// navegador se puede manipular con una petición hecha a mano.
		const tipoDocumento = normalizeDocumentType(params.get('tipoDocumento') || '');
		if (!tipoDocumento) {
			return errorParam('Selecciona un tipo de documento válido.');
		}
		const numeroDocumento = (params.get('numeroDocumento') || '').trim();
		if (!esNitValido(numeroDocumento)) {
			return errorParam('El número de documento solo admite números, entre 6 y 20 dígitos.');
		}

		// --- Datos de contacto ---
		// Se reutiliza el validador del panel en lugar de reescribir las reglas:
		// así el teléfono admite exactamente el mismo formato en los dos sitios.
		// Aquí los cinco campos son obligatorios, cuando en el panel son opcionales.
		const contact = parseRegistrationContact(params);
		if (!contact) {
			return errorParam('Completa todos los datos de contacto para crear tu cuenta.');
		}
		if (!isValidPhone(contact.phone)) {
			return errorParam(
				'El teléfono solo admite números y los signos + ( ) - (entre 7 y 15 dígitos).'
			);
		}
		if (!isValidPhone(contact.whatsapp)) {
			return errorParam(
				'El contacto de WhatsApp solo admite números y los signos + ( ) - (entre 7 y 15 dígitos).'
			);
		}

		// Check for duplicates in Google Sheets
		let sheetUsers: User[] = [];
		try {
			sheetUsers = await getGoogleSheetUsers();
		} catch (sheetErr) {
			console.error('Error fetching users from Google Sheet:', sheetErr);
		}

		// Also check local json users if any
		let localUsers: User[] = [];
		try {
			localUsers = readJSON<User[]>('users.json', []);
		} catch {
			localUsers = [];
		}

		const allUsers = [...sheetUsers, ...localUsers];

		if (allUsers.some((u) => u.username?.toLowerCase() === username.toLowerCase())) {
			return errorParam('El nombre de usuario ya está en uso.');
		}
		if (allUsers.some((u) => u.email?.toLowerCase() === email)) {
			return errorParam('El correo electrónico ya está registrado.');
		}

		// --- Código de referido (opcional) ---
		// Si viene informado debe existir: así el usuario sabe de inmediato
		// que su código no es válido en lugar de creer que seguardó la comisión.
		let referralCode = '';
		if (referralInput) {
			const referrer = await findReferrerByCode(referralInput);
			if (!referrer) {
				return errorParam(
					'El código de referido no es válido. Verifícalo o regístrate sin él.',
					false
				);
			}
			// No se permite autoreferirse
			if (
				referrer.username?.toLowerCase() === username.toLowerCase() ||
				referrer.email?.toLowerCase() === email
			) {
				return errorParam('No puedes usar tu propio código de referido.', false);
			}
			referralCode = ownCodeOf(referrer) || referrer.username || referralInput;
		}

		// --- Hash password and save ---
		const passwordHash = hashPassword(password);

		// 1. Guardar en Google Sheets
		try {
			// Si a la hoja le faltan las columnas cortas, se crean antes de
			// escribir: si no, los valores caerían en celdas que Google descarta.
			try {
				await ensureUserProfileColumns();
			} catch (err) {
				console.error('No se pudieron preparar las columnas de contacto:', err);
			}

			await appendGoogleSheetUser({
				username,
				email,
				passwordHash,
				referralCode,
				documentType: tipoDocumento,
				documentNumber: numeroDocumento,
				contact,
			});
		} catch (sheetSaveErr) {
			console.error('Error al guardar usuario en Google Sheet:', sheetSaveErr);
			return errorParam('No se pudo guardar el registro en Google Sheets. Intente de nuevo más tarde.');
		}

		// 2. Backup opcional en JSON local
		try {
			const newUser: User = {
				username,
				email,
				password: passwordHash,
				referralCode,
				ownCode: username,
				documentType: tipoDocumento,
				documentNumber: numeroDocumento,
				address: contact.address,
				neighborhood: contact.neighborhood,
				city: contact.city,
				phone: contact.phone,
				whatsapp: contact.whatsapp,
			};
			localUsers.push(newUser);
			writeJSON('users.json', localUsers);
		} catch {
			// Ignore local store error on serverless environments
		}

		// El alta NO paga comisión. La comisión se acredita a quien trajo el referido
		// cuando este hace su primera recarga aprobada (ver `api/admin/topups.ts`).
		// Aquí el código de referido solo se guarda en la columna "Código Referido",
		// que es lo que luego usa esa operación para saber a quién acreditar.

		// Redirect to login on success
		return Astro.redirect('/login?registered=1', 303);
	} catch (err) {
		// Igual que en el login: el detalle va al log del servidor y al usuario
		// solo se le devuelve un mensaje generico.
		console.error('[register] Error al registrar:', err);
		return new Response('ERROR: No se pudo completar el registro.', { status: 500 });
	}
};
