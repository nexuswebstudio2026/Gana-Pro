/**
 * Endpoint de pagos entre usuarios (P2P).
 *
 * `GET` devuelve el historial del miembro: lo que ve la tabla de movimientos.
 * `POST` registra un comprobante nuevo, que queda **pendiente** hasta que el
 * administrador lo aprueba. El saldo no se mueve aquí.
 *
 * La protección no se repite aquí: `src/middleware.ts` ya exige sesión en todo
 * `/api/*`. Aun así se comprueba `Astro.locals.user` porque es la única capa
 * que no se puede saltar desde el navegador, y este endpoint mueve plata.
 */
import type { APIRoute } from 'astro';
import { getSheetUserLevel, getUserBalance } from '../../../lib/users';
import { parseSheetBalance } from '../../../lib/sheets';
import { saveFile } from '../../../lib/image-storage';
import {
	P2P_CONCEPT_INFO,
	P2P_CONCEPTS,
	canSubmitConcept,
	conceptAmount,
	isP2PConcept,
	normalizeReceiptReference,
	validateReceipt,
} from '../../../lib/p2p';
import { createP2PPayment, listP2PPayments, type P2PPayment } from '../../../lib/p2p-payments';

export const prerender = false;

/** Carpeta donde se guardan los comprobantes P2P. */
const RECEIPTS_FOLDER = 'comprobantes-p2p';

/** Tope de seguridad por operación, por si el monto llega manipulado. */
const MAX_AMOUNT = 100_000_000;

function json(payload: Record<string, unknown>, status = 200) {
	return new Response(JSON.stringify(payload), {
		status,
		headers: { 'Content-Type': 'application/json' },
	});
}

const fmt = (value: number) => `$${Math.round(value).toLocaleString('es-CO')}`;

/** Saldo del miembro, tal y como lo ve la hoja. */
async function currentBalance(username: string, email: string): Promise<number> {
	return parseSheetBalance(await getUserBalance(username, email));
}

/** Historial del miembro, con el saldo ya calculado para el formulario. */
export const GET: APIRoute = async (Astro) => {
	const session = Astro.locals.user;
	if (!session) return json({ ok: false, message: 'Sesión no válida.' }, 401);

	try {
		const level = await getSheetUserLevel(session.username, session.email);
		const balance = await currentBalance(session.username, session.email);

		// Si la hoja no responde, el historial llega vacío y la tabla muestra su
		// estado vacío, en vez de romper la página entera.
		let payments: P2PPayment[] = [];
		try {
			payments = await listP2PPayments(session.username);
		} catch (error) {
			console.error('No se pudo leer el historial P2P:', error);
		}

		return json({
			ok: true,
			message: '',
			balance,
			level: level ?? '',
			payments,
			// El selector se arma en el servidor para que el formulario y las
			// reglas de `canSubmitConcept` no puedan separarse.
			concepts: P2P_CONCEPTS.map((id) => ({
				...P2P_CONCEPT_INFO[id],
				amount: conceptAmount(id, balance),
				enabled: canSubmitConcept(id, level),
			})),
		});
	} catch (error) {
		console.error('Error al cargar los datos P2P:', error);
		return json({ ok: false, message: 'No se pudieron cargar tus movimientos.' }, 500);
	}
};

/**
 * Registra un comprobante de pago P2P.
 *
 * Acepta `multipart/form-data` con `concept`, `receipt` y, opcionalmente,
 * `reference`. El monto **no** lo envía el formulario: lo calcula el servidor
 * desde el concepto y el saldo, para que nadie pueda reportar $1 cuando le
 * corresponde el 50 %.
 */
export const POST: APIRoute = async (Astro) => {
	const session = Astro.locals.user;
	if (!session) return json({ ok: false, message: 'Sesión no válida.' }, 401);

	try {
		const formData = await Astro.request.formData();
		const concept = String(formData.get('concept') ?? '');
		const file = formData.get('receipt');

		if (!isP2PConcept(concept)) {
			return json({ ok: false, message: 'Selecciona un concepto válido.' }, 400);
		}

		// El nivel se relee de la hoja: el del formulario solo es una ayuda.
		const level = await getSheetUserLevel(session.username, session.email);
		if (!canSubmitConcept(concept, level)) {
			return json(
				{
					ok: false,
					message:
						`Aún no puedes reportar "${P2P_CONCEPT_INFO[concept].label}". ` +
						'Este movimiento se habilita al alcanzar el nivel Oro.',
				},
				403
			);
		}

		const receiptError = validateReceipt(
			file instanceof File ? { type: file.type, size: file.size } : null
		);
		if (receiptError) return json({ ok: false, message: receiptError }, 400);

		const balance = await currentBalance(session.username, session.email);
		const amount = conceptAmount(concept, balance);
		if (!(amount > 0) || amount > MAX_AMOUNT) {
			return json(
				{
					ok: false,
					message:
						'No se puede calcular el monto de este envío. ' +
						'Revisa tu saldo o contacta a soporte.',
				},
				400
			);
		}

		const upload = file as File;
		const buffer = Buffer.from(await upload.arrayBuffer());
		const safeUser = session.username.replace(/[^a-zA-Z0-9_-]/g, '') || 'user';
		const ext = (upload.name.split('.').pop() || 'jpg').toLowerCase();
		const stored = await saveFile(
			RECEIPTS_FOLDER,
			`p2p_${concept}_${safeUser}_${Date.now()}.${ext}`,
			buffer,
			upload.type
		);

		const request = await createP2PPayment({
			username: session.username,
			email: session.email,
			concept,
			amount,
			receiptUrl: stored.url,
			receiptName: upload.name || `comprobante.${ext}`,
			reference: normalizeReceiptReference(formData.get('reference')),
		});

		return json({
			ok: true,
			message:
				`Reporte de ${P2P_CONCEPT_INFO[concept].label} por ${fmt(amount)} recibido. ` +
				'El administrador verificará tu comprobante. ' +
				`Referencia: movimiento #${request.id}.`,
			requestId: request.id,
		});
	} catch (error) {
		console.error('Error al registrar el pago P2P:', error);
		return json({ ok: false, message: 'Error del servidor. Inténtalo de nuevo.' }, 500);
	}
};
