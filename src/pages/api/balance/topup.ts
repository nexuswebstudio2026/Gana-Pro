import type { APIRoute } from 'astro';
import { validateSession } from '../../../lib/session';
import { getGoogleSheetUsers, parseSheetBalance } from '../../../lib/sheets';
import { getUserBalance } from '../../../lib/users';
import { saveFile } from '../../../lib/image-storage';
import { createTopup } from '../../../lib/topups';

export const prerender = false;

/** Tipos de comprobante que se aceptan. */
const RECEIPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

/** Tamaño máximo del comprobante: 5 MB. */
const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;

/** Carpeta donde se guardan los comprobantes de recarga. */
const RECEIPTS_FOLDER = 'comprobantes';

const MAX_AMOUNT = 100_000_000;

function json(payload: { ok: boolean; message: string; [k: string]: unknown }, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

const fmt = (v: number) => `$${Math.round(v).toLocaleString('es-CO')}`;

/** Billetera del administrador: es la cuenta a la que deben transferir. */
async function getAdminWallet(): Promise<{ walletType: string; walletNumber: string } | null> {
	const users = await getGoogleSheetUsers();
	const admin = users.find((u) => {
		const role = String(u.role ?? '').trim().toLowerCase();
		return role === 'admin' || role === 'administrator';
	});
	if (!admin) return null;
	return {
		walletType: String(admin.paymentMethod ?? '').trim(),
		walletNumber: String(admin.walletNumber ?? '').trim(),
	};
}

/**
 * Consulta los datos de la recarga: billetera del admin y saldo del usuario.
 * Alimenta el formulario antes de que el usuario escriba nada.
 */
export const GET: APIRoute = async (Astro) => {
	const session = validateSession(Astro.cookies.get('auth_session')?.value);
	if (!session) return json({ ok: false, message: 'Sesión no válida.' }, 401);

	try {
		const [wallet, balance] = await Promise.all([
			getAdminWallet(),
			getUserBalance(session.username, session.email),
		]);

		return json({
			ok: true,
			message: '',
			walletType: wallet?.walletType || '',
			walletNumber: wallet?.walletNumber || '',
			balance: parseSheetBalance(balance),
		});
	} catch (err) {
		console.error('Error al cargar los datos de recarga:', err);
		return json({ ok: false, message: 'No se pudieron cargar los datos de la recarga.' }, 500);
	}
};

/**
 * Solicitud de recarga de saldo.
 *
 * El usuario indica el monto y adjunta el comprobante. **El saldo NO se
 * acredita aquí**: queda pendiente hasta que el administrador compare el monto
 * con la imagen y lo apruebe.
 */
export const POST: APIRoute = async (Astro) => {
	try {
		const session = validateSession(Astro.cookies.get('auth_session')?.value);
		if (!session) return json({ ok: false, message: 'Sesión no válida.' }, 401);

		const formData = await Astro.request.formData();
		const amount = Number(formData.get('amount'));
		const file = formData.get('receipt');

		if (!Number.isFinite(amount) || amount <= 0) {
			return json({ ok: false, message: 'El monto debe ser un número mayor que cero.' }, 400);
		}
		if (amount > MAX_AMOUNT) {
			return json({ ok: false, message: 'El monto supera el máximo permitido.' }, 400);
		}

		if (!(file instanceof File) || file.size === 0) {
			return json({ ok: false, message: 'Adjunta el comprobante de la transferencia.' }, 400);
		}
		if (!RECEIPT_TYPES.includes(file.type)) {
			return json({ ok: false, message: 'El comprobante debe ser JPG, PNG, WEBP o PDF.' }, 400);
		}
		if (file.size > MAX_RECEIPT_BYTES) {
			return json({ ok: false, message: 'El comprobante supera el límite de 5 MB.' }, 400);
		}

		const buffer = Buffer.from(await file.arrayBuffer());

		// 1) Guardar el comprobante: es la evidencia que revisará el admin.
		const safeUser = session.username.replace(/[^a-zA-Z0-9_-]/g, '') || 'user';
		const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
		const stored = await saveFile(
			RECEIPTS_FOLDER,
			`recarga_${safeUser}_${Date.now()}.${ext}`,
			buffer,
			file.type
		);

		// 2) Registrar la solicitud pendiente de aprobación. El comprobante ya
		//    está guardado arriba: el admin lo revisa a ojo y decide.
		const request = await createTopup({
			username: session.username,
			email: session.email,
			amount,
			receiptUrl: stored.url,
			receiptName: file.name || `comprobante.${ext}`,
		});

		return json({
			ok: true,
			message:
				`Tu solicitud de recarga por ${fmt(amount)} fue enviada. ` +
				'El administrador comparará el monto con tu comprobante y lo aprobará. ' +
				`Referencia: recarga #${request.id}.`,
			requestId: request.id,
		});
	} catch (err) {
		console.error('Error en la solicitud de recarga:', err);
		return json({ ok: false, message: 'Error del servidor. Inténtalo de nuevo.' }, 500);
	}
};
