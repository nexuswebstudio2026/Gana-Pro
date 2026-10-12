import nodemailer from 'nodemailer';
import { getEnvValue } from './sheets';

async function sendVerificationCode(to: string, code: string, purpose: 'reset' | 'registration'): Promise<void> {
	const user = getEnvValue('SMTP_USER')?.trim();
	const password = getEnvValue('SMTP_APP_PASSWORD')?.replace(/\s/g, '');
	const from = getEnvValue('SMTP_FROM_EMAIL')?.trim() || user;
	if (!user || !password || !from) {
		throw new Error('Faltan SMTP_USER o SMTP_APP_PASSWORD para enviar el correo.');
	}

	const transporter = nodemailer.createTransport({
		service: 'gmail',
		auth: { user, pass: password },
	});
	const registration = purpose === 'registration';
	const title = registration ? 'Verifica tu correo para crear tu cuenta' : 'Restablece tu contraseña';
	const context = registration ? 'crear tu cuenta en GANA PRO' : 'cambiar tu contraseña';
	await transporter.sendMail({
		from: `GANA PRO <${from}>`,
		to,
		subject: `Código para verificar tu correo · GANA PRO`,
		text: `Tu código para ${context} es ${code}. Vence en 10 minutos. Si no solicitaste esta acción, ignora este mensaje.`,
		html: `<div style="font-family:Arial,sans-serif;color:#172033;max-width:520px;margin:auto"><h1 style="color:#a58124">GANA PRO</h1><h2>${title}</h2><p>Ingresa este código en el sitio para continuar:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>El código vence en 10 minutos y solo se puede usar una vez.</p><p>Si no solicitaste esta acción, ignora este correo.</p></div>`,
	});
}

/** Sends password reset codes through Gmail SMTP; credentials stay server-side. */
export function sendPasswordResetCode(to: string, code: string): Promise<void> {
	return sendVerificationCode(to, code, 'reset');
}

/** Sends a one-time email ownership code before an account can be registered. */
export function sendRegistrationVerificationCode(to: string, code: string): Promise<void> {
	return sendVerificationCode(to, code, 'registration');
}
