/**
 * Zona horaria de la plataforma.
 *
 * Los servidores (Vercel) se ejecutan en UTC, así que sin una conversión
 * explícita las fechas se guardan y se muestran con el desfase del servidor
 * (p. ej. publicar a las 22:38 en Colombia se guardaba como 03:38 del día
 * siguiente).
 */
export const APP_TIME_ZONE = 'America/Bogota';

/** Desfase de la zona horaria respecto a UTC, en minutos, para una fecha dada. */
function timeZoneOffsetMinutes(date: Date, timeZone: string): number {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	}).formatToParts(date);

	const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
	const hour = get('hour') % 24; // con hour12:false la medianoche puede venir como 24
	const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), hour, get('minute'), get('second'));

	return Math.round((asUtc - date.getTime()) / 60000);
}

/**
 * Fecha actual como ISO 8601 con su desfase, por ejemplo
 * `2026-09-27T22:38:52-05:00`. Es inequívoca: se puede volver a leer
 * en cualquier servidor sin depender de su zona horaria.
 */
export function toZonedIso(date: Date = new Date()): string {
	const offset = timeZoneOffsetMinutes(date, APP_TIME_ZONE);
	const sign = offset >= 0 ? '+' : '-';
	const abs = Math.abs(offset);
	const hh = String(Math.floor(abs / 60)).padStart(2, '0');
	const mm = String(abs % 60).padStart(2, '0');

	// se adelanta la fecha para escribir la hora local y luego se añade el desfase
	const localWallClock = new Date(date.getTime() + offset * 60000).toISOString().slice(0, 19);
	return `${localWallClock}${sign}${hh}:${mm}`;
}

/**
 * Interpreta los formatos de fecha que pueden venir de la hoja de cálculo.
 *
 * - ISO 8601 (`2026-09-27T22:38:52-05:00`): se respeta su desfase.
 * - Formato antiguo `27/9/2026, 3:38:52`: se generó en el servidor en UTC,
 *   así que se interpreta como UTC para recuperar la hora real.
 */
export function parseDateValue(value: string): Date | null {
	const raw = String(value ?? '').trim();
	if (!raw) return null;

	if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) {
		const iso = new Date(raw.replace(' ', 'T'));
		if (!Number.isNaN(iso.getTime())) return iso;
	}

	const legacy = raw.match(
		/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/
	);
	if (legacy) {
		const [, day, month, year, hour, minute, second] = legacy;
		// El formato antiguo salía de un servidor en UTC.
		return new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +(second || 0)));
	}

	const fallback = new Date(raw);
	return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** Muestra una fecha en la zona horaria de la plataforma. */
export function formatAppDateTime(value: string): string {
	const date = parseDateValue(value);
	if (!date) return String(value ?? '');

	return new Intl.DateTimeFormat('es-CO', {
		timeZone: APP_TIME_ZONE,
		dateStyle: 'medium',
		timeStyle: 'short',
	}).format(date);
}
