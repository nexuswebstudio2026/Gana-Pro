import type { APIRoute } from 'astro';
import { ensureUserDocumentColumns, updateSheetUserDocument } from '../../lib/sheets';
import {
  uploadRutDocument,
  esNitValido,
  ALLOWED_DOCUMENT_TYPES,
  MAX_DOCUMENT_BYTES,
  DOCUMENT_STATUS,
} from '../../lib/testimonials';
import { isAdminRole } from '../../lib/auth';
import { ImageStorageNotConfiguredError } from '../../lib/image-storage';

export const prerender = false;

/** Página a la que se vuelve tras cada operación. */
const RUT_URL = '/dashboard/rut';

/**
 * RUT emitido por la DIAN.
 *
 * Solo lo declara el administrador: es el dato tributario del negocio, no el
 * documento de identidad de un miembro (eso va en `/api/documento`). Por eso el
 * endpoint comprueba el rol en vez de fiarse de lo que llegue el formulario.
 */
export const POST: APIRoute = async (Astro) => {
  const fail = (msg: string) =>
    Astro.redirect(`${RUT_URL}?doc=error&msg=` + encodeURIComponent(msg), 303);

  try {
    const session = Astro.locals.user;
    if (!session) {
      return Astro.redirect('/login', 303);
    }
    if (!isAdminRole(session.role)) {
      // Un miembro no tiene NIT: se le manda a su documento de identidad.
      return Astro.redirect('/dashboard/documento', 303);
    }

    const formData = await Astro.request.formData();
    const rawFile = formData.get('rut') ?? formData.get('documento');
    const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;

    const nit = String(formData.get('nit') || '').trim();
    if (!nit) {
      return fail('Escribe el NIT del negocio.');
    }
    if (!esNitValido(nit)) {
      return fail('El NIT solo admite numeros, entre 6 y 20 digitos.');
    }

    if (!file) {
      return fail('Selecciona el archivo del RUT para subir.');
    }
    const allowed = ALLOWED_DOCUMENT_TYPES as readonly string[];
    if (!allowed.includes(file.type)) {
      return fail('Formato no permitido. Usa JPG, PNG, WEBP o PDF.');
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      return fail('El RUT supera el limite de 5 MB.');
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
      console.error('Error al subir el RUT:', err);
      return Astro.redirect(
        `${RUT_URL}?doc=` + (err instanceof ImageStorageNotConfiguredError ? 'config' : 'error') +
          '&msg=' + encodeURIComponent(reason),
        303
      );
    }

    try {
      await ensureUserDocumentColumns();
    } catch (err) {
      console.error('No se pudieron preparar las columnas del RUT:', err);
    }

    const updated = await updateSheetUserDocument(session.username, {
      documentType: 'NIT',
      documentNumber: nit,
      documentStatus: DOCUMENT_STATUS.pendiente,
      documentLink: stored.url,
      scannedDocument: file.name,
      nit,
      rutLink: stored.url,
      scannedRut: file.name,
    });

    if (!updated) {
      return fail('No se encontro tu registro para guardar el RUT.');
    }

    return Astro.redirect(`${RUT_URL}?doc=ok`, 303);
  } catch (err) {
    console.error('Error al procesar el RUT:', err);
    return Astro.redirect(
      `${RUT_URL}?doc=error&msg=` +
        encodeURIComponent('No se pudo guardar el RUT. Intentalo de nuevo.'),
      303
    );
  }
};