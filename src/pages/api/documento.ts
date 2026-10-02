import type { APIRoute } from 'astro';
import { ensureUserDocumentColumns, updateSheetUserDocument } from '../../lib/sheets';
import {
  uploadRutDocument,
  esNitValido,
  normalizeDocumentType,
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  DOCUMENT_STATUS,
} from '../../lib/testimonials';
import { ImageStorageNotConfiguredError } from '../../lib/image-storage';

export const prerender = false;

/** Página a la que se vuelve tras cada operación. */
const DOCUMENT_URL = '/dashboard/documento';

/**
 * Documento de identidad del usuario conectado (cédula CC/TI/CE o permiso PEP).
 *
 * Es distinto del RUT de la DIAN, que solo declara el administrador y va en su
 * propio endpoint (`/api/rut`). Aquí no se toca la columna del NIT: cada quien
 * se identifica con su documento, no con el dato tributario del negocio.
 */
export const POST: APIRoute = async (Astro) => {
  const fail = (msg: string) =>
    Astro.redirect(`${DOCUMENT_URL}?doc=error&msg=` + encodeURIComponent(msg), 303);

  try {
    const session = Astro.locals.user;
    if (!session) {
      return Astro.redirect('/login', 303);
    }

    const formData = await Astro.request.formData();
    const rawFile = formData.get('documento') ?? formData.get('rut');
    const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;

    const tipo = normalizeDocumentType(String(formData.get('tipoDocumento') || ''));
    if (!tipo) {
      return fail('Selecciona un tipo de documento valido.');
    }
    const numero = String(formData.get('numeroDocumento') || '').trim();
    if (!esNitValido(numero)) {
      return fail('El numero de documento solo admite numeros, entre 6 y 20 digitos.');
    }

    if (!file) {
      return fail('Selecciona el archivo de tu documento para subir.');
    }
    const allowed = ALLOWED_DOCUMENT_TYPES as readonly string[];
    if (!allowed.includes(file.type)) {
      return fail('Formato no permitido. Usa JPG, PNG, WEBP o PDF.');
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      return fail('El documento supera el limite de 5 MB.');
    }

    let stored;
    try {
      stored = await uploadRutDocument(
        session.username,
        file.name,
        Buffer.from(await file.arrayBuffer()),
        file.type
      );
    } catch (err) {
      const reason =
        err instanceof ImageStorageNotConfiguredError
          ? 'El almacenamiento de documentos no esta configurado en el servidor.'
          : 'No se pudo guardar el archivo. Intentalo de nuevo.';
      console.error('Error al subir el documento de identidad:', err);
      return Astro.redirect(
        `${DOCUMENT_URL}?doc=` + (err instanceof ImageStorageNotConfiguredError ? 'config' : 'error') +
          '&msg=' + encodeURIComponent(reason),
        303
      );
    }

    try {
      await ensureUserDocumentColumns();
    } catch (err) {
      console.error('No se pudieron preparar las columnas de documento:', err);
    }

    const updated = await updateSheetUserDocument(session.username, {
      documentType: tipo,
      documentNumber: numero,
      documentStatus: DOCUMENT_STATUS.pendiente,
      documentLink: stored.url,
      scannedDocument: file.name,
      rutLink: stored.url,
      scannedRut: file.name,
    });

    if (!updated) {
      return fail('No se encontro tu registro para guardar el documento.');
    }

    return Astro.redirect(`${DOCUMENT_URL}?doc=ok`, 303);
  } catch (err) {
    console.error('Error al procesar el documento de identidad:', err);
    return Astro.redirect(
      `${DOCUMENT_URL}?doc=error&msg=` +
        encodeURIComponent('No se pudo guardar tu documento. Intentalo de nuevo.'),
      303
    );
  }
};