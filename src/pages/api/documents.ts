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
import { isAdminRole } from '../../lib/auth';
import { ImageStorageNotConfiguredError } from '../../lib/image-storage';

export const prerender = false;

// El NIT (Identificación Tributaria DIAN) es un dato del negocio y solo lo
// declara el administrador. El resto de miembros se identifica con su
// documento de identidad: tipo (CC/TI/CE/PEP) y número.
// El campo `nit` conserva su nombre histórico porque es el nombre de la
// columna en la hoja; se admite el campo antiguo 'documento' como archivo.
export const POST: APIRoute = async (Astro) => {
  const fail = (msg: string) =>
    Astro.redirect('/dashboard/rut?doc=error&msg=' + encodeURIComponent(msg), 303);

  try {
    const session = Astro.locals.user;
    if (!session) {
      return Astro.redirect('/login', 303);
    }

    const formData = await Astro.request.formData();
    const rawFile = formData.get('rut') ?? formData.get('documento');
    const file = rawFile instanceof File && rawFile.size > 0 ? rawFile : null;

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

    // Qué dato identifica a esta persona depende de su rol. Un miembro normal
    // nunca escribe NIT y el administrador sí, así que la rama se decide por
    // rol y no por lo que venga en el formulario.
    const esAdmin = isAdminRole(session.role);
    let tipoDocumento: string;
    let numeroDocumento: string;
    let nit = '';

    if (esAdmin) {
      nit = String(formData.get('nit') || '').trim();
      if (!nit) {
        return fail('Escribe el NIT del negocio.');
      }
      if (!esNitValido(nit)) {
        return fail('El NIT solo admite numeros, entre 6 y 20 digitos.');
      }
      // El NIT hace las veces de tipo y número en la fila del administrador.
      tipoDocumento = 'NIT';
      numeroDocumento = nit;
    } else {
      const tipo = normalizeDocumentType(String(formData.get('tipoDocumento') || ''));
      if (!tipo) {
        return fail('Selecciona un tipo de documento valido.');
      }
      const numero = String(formData.get('numeroDocumento') || '').trim();
      if (!esNitValido(numero)) {
        return fail('El numero de documento solo admite numeros, entre 6 y 20 digitos.');
      }
      tipoDocumento = tipo;
      numeroDocumento = numero;
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
        '/dashboard/rut?doc=' + (err instanceof ImageStorageNotConfiguredError ? 'config' : 'error') +
          '&msg=' + encodeURIComponent(reason),
        303
      );
    }

    try {
      await ensureUserDocumentColumns();
    } catch (err) {
      console.error('No se pudieron preparar las columnas de NIT/RUT:', err);
    }

    const updated = await updateSheetUserDocument(session.username, {
      documentType: tipoDocumento,
      documentNumber: numeroDocumento,
      documentStatus: DOCUMENT_STATUS.pendiente,
      documentLink: stored.url,
      scannedDocument: file.name,
      // Solo el administrador tiene NIT: para el resto se deja la columna como
      // estaba, sin sobrescribirla con el número de cédula.
      ...(nit ? { nit } : {}),
      rutLink: stored.url,
      scannedRut: file.name,
    });

    if (!updated) {
      return fail('No se encontro tu registro para guardar el documento.');
    }

    return Astro.redirect('/dashboard/rut?doc=ok', 303);
  } catch (err) {
    console.error('Error al procesar el RUT:', err);
    return Astro.redirect(
      '/dashboard/rut?doc=error&msg=' +
        encodeURIComponent('No se pudo guardar tu RUT. Intentalo de nuevo.'),
      303
    );
  }
};
