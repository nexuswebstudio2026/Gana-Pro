import nodemailer from 'nodemailer';
import { getEnvValue } from './sheets';

/** Sends password reset codes through Gmail SMTP; credentials stay server-side. */
export async function sendPasswordResetCode(to: string, code: string): Promise<void> {
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
	await transporter.sendMail({
		from: `GANA PRO <${from}>`,
		to,
		subject: 'Código para restablecer tu contraseña · GANA PRO',
		text: `Tu código de verificación es ${code}. Vence en 10 minutos. Si no solicitaste restablecer tu contraseña, ignora este mensaje.`,
		html: `<div style="font-family:Arial,sans-serif;color:#172033;max-width:520px;margin:auto"><h1 style="color:#a58124">GANA PRO</h1><p>Usa este código para cambiar tu contraseña:</p><p style="font-size:32px;font-weight:700;letter-spacing:8px">${code}</p><p>El código vence en 10 minutos y solo se puede usar una vez.</p><p>Si no solicitaste este cambio, ignora este correo.</p></div>`,
	});
}
