/**
 * Simulador de ascensos de la constelación 5x1, con la metodología real.
 *
 * Es un módulo puro a propósito. Esta pantalla promete cifras concretas a quien
 * está a punto de poner dinero, así que la aritmética tiene que estar comprobada
 * en los tests y no repartida por el HTML.
 *
 * ---- La metodología que simula ----
 *
 * La constelación no reparte comisiones por referido: reparte el aporte de la
 * base. El dinero sube por la pirámide y cada nivel se queda la mitad.
 *
 *   1. Cada posición de Nivel 1 aporta `RECARGA_INICIAL_AMOUNT` a la posición de
 *      Nivel 2 que la trajo, así que una posición de Nivel 2 con la base
 *      completa recibe 5 x $15.000 = $75.000.
 *   2. Los niveles 2, 3 y 4 reenvían el 50 % de lo recibido a su patrocinador y
 *      retienen el otro 50 %. El Nivel 5 no tiene nivel superior al que reenviar:
 *      entrega el 35 % a GANA PRO y retiene el 65 %.
 *   3. Sobre lo retenido se aplica el 5 % de impuesto de plataforma.
 *
 *      Nivel 2  recibe    $75.000  retiene  $37.500
 *      Nivel 3  recibe   $187.500  retiene  $93.750
 *      Nivel 4  recibe   $468.750  retiene $234.375
 *      Nivel 5  recibe $1.171.875  retiene $761.719, menos 5 % de impuesto
 *
 * Cada nivel recibe cinco veces lo que retenía el anterior: de ahí que el ingreso
 * crezca de forma geométrica al subir, y ese es justo lo que el simulador deja
 * ver.
 *
 * La regla que más se salta la gente: la base tiene que estar **completa**. Con
 * menos de cinco puestos activos no hay ascenso, no entra dinero y se pierden los
 * $15.000 aportados. Por eso `simulateAscent` acepta `baseComplete` y devuelve ese
 * caso con todo en cero, en vez de interpolar una cifra que la plataforma nunca
 * pagaría.
 *
 * Lo que el simulador NO hace, a propósito: no inventa plazos ni tasas de
 * conversión. Si una regla no está en la plataforma, aquí tampoco aparece.
 */
import { P2P_RATE, RECARGA_INICIAL_AMOUNT } from './p2p';
import { MAX_DIRECT_TEAM } from './user-hierarchy';
import { LEVELS, WITHDRAWAL_MIN_LEVEL } from './users';

/** Nivel más alto de la constelación, tomado de la escala real. */
export const ASCENT_TOP_LEVEL = LEVELS.reduce(
	(max, level) => Math.max(max, level.number),
	0
);

/**
 * Parte que el Nivel 5 entrega a GANA PRO (el 35 % de lo que recibe).
 *
 * Ojo: `P2P_RATE.sostenimiento`, en `p2p.ts`, dice 30 %. Son dos reglas
 * distintas que hoy no coinciden en el código. Aquí manda la metodología de la
 * constelación —la que describe el flujo de fondos y de la que salen el 65 % y
 * el 5 % de impuesto—, y no la del pago entre usuarios. Mezclarlas daría cifras
 * que no corresponden a ninguna de las dos.
 */
export const PLATFORM_SHARE_TOP = 0.35;

/** Impuesto por uso de la plataforma, que se aplica sobre lo retenido. */
export const PLATFORM_TAX_RATE = 0.05;

/** Un peldaño de la escalera: lo que ocurre en un nivel concreto. */
export interface AscentStep {
	/** Número de nivel (1..5). */
	level: number;
	/** Nombre del nivel ("Bronce", "Plata"...). */
	levelName: string;
	/** Posiciones que hay que tener debajo para llegar a este nivel. */
	peopleBelow: number;
	/** Lo que esta posición recibe de sus cinco posiciones inferiores. */
	received: number;
	/** Lo que reenvía a su patrocinador al ascender (solo niveles 2 a 4). */
	ascentAmount: number;
	/** Lo que entrega a GANA PRO (solo en el nivel máximo). */
	platformShare: number;
	/** Impuesto de plataforma sobre lo retenido (solo en el nivel máximo). */
	tax: number;
	/** Lo que la posición conserva de este nivel, después de impuestos. */
	retained: number;
	/** Suma de todos los niveles anteriores más este. */
	cumulative: number;
	/** `true` si en este nivel ya se puede retirar saldo. */
	canWithdraw: boolean;
	/**
	 * Altura de la barra, en porcentaje (0-100).
	 *
	 * Se calcula aquí y no en el navegador para que el gráfico se dibuje siempre
	 * con la misma regla que el resto de cifras: el único trabajo del `<script>`
	 * del componente es cambiar de panel.
	 */
	barPercent: number;
}

/** Simulación completa de una posición que sube hasta `targetLevel`. */
export interface AscentSimulation {
	/** Nivel máximo simulado. */
	targetLevel: number;
	/**
	 * `true` si los cinco puestos directos están activos y verificados.
	 *
	 * En `false` todos los importes son cero: es el resultado real de quedarse
	 * con menos de cinco, no un caso intermedio que se haya omitido.
	 */
	baseComplete: boolean;
	/** Un peldaño por nivel, del 1 al objetivo. */
	steps: AscentStep[];
	/** Suma de lo que entra en la posición a lo largo de todos los niveles. */
	totalReceived: number;
	/** Total reenviado a los patrocinadores al ascender. */
	totalAscent: number;
	/** Total entregado a GANA PRO. */
	totalPlatformShare: number;
	/** Total de impuesto de plataforma. */
	totalTax: number;
	/** Lo que la posición conserva, después de impuestos, sumando los niveles. */
	totalRetained: number;
	/** Lo que el miembro aporta para activar su propio puesto. */
	activationCost: number;
	/** Aporte total de las posiciones de su rama, en una constelación completa. */
	branchContribution: number;
	/** `totalRetained` sobre `activationCost` (72,6 equivale a 7.260 %). */
	returnRatio: number;
	/** Posiciones por debajo necesarias para llegar al nivel objetivo. */
	peopleBelow: number;
	/** `true` si el nivel alcanzado ya habilita retiros. */
	canWithdraw: boolean;
}

/**
 * Simula el ascenso desde el Nivel 1 hasta `targetLevel` con la metodología real
 * de la constelación.
 *
 * `baseComplete` decide si los cinco puestos directos están activos. Un nivel
 * fuera de la escala devuelve `null` en vez de inventar una cifra, igual que hace
 * `projectLevel`.
 */
export function simulateAscent(
	targetLevel: number,
	baseComplete: boolean = true
): AscentSimulation | null {
	const level = Math.trunc(Number(targetLevel));
	if (!LEVELS.some((definition) => definition.number === level)) return null;

	const steps: AscentStep[] = [];

	let cumulative = 0;
	let totalReceived = 0;
	let totalAscent = 0;
	let totalPlatformShare = 0;
	let totalTax = 0;

	// Lo que envía hacia arriba la posición del nivel anterior. En el Nivel 1 esa
	// cantidad es el aporte completo de $15.000: la base no se queda nada.
	let forwardedByPreviousLevel = RECARGA_INICIAL_AMOUNT;

	for (const definition of LEVELS) {
		if (definition.number > level) break;

		const peopleBelow = Math.pow(MAX_DIRECT_TEAM, definition.number - 1);

		// El Nivel 1 es la base: aporta y no recibe, así que entra en cero.
		const isBase = definition.number === 1;
		const isTop = definition.number === ASCENT_TOP_LEVEL;

		const received = isBase
			? 0
			: baseComplete
				? forwardedByPreviousLevel * MAX_DIRECT_TEAM
				: 0;

		// Los niveles 2, 3 y 4 reenvían la mitad a su patrocinador. El Nivel 5 no
		// tiene nivel superior, así que su parte va a la plataforma.
		const ascentAmount = isBase || isTop ? 0 : Math.round(received * P2P_RATE.ascenso);
		const platformShare = isTop ? Math.round(received * PLATFORM_SHARE_TOP) : 0;

		// Lo retenido antes de impuestos, y lo que queda después.
		//
		// El impuesto es solo del cierre del ciclo: se aplica al Nivel 5, que es el
		// que reparte con GANA PRO. Los niveles 2, 3 y 4 se quedan la mitad íntegra,
		// que es lo que confirma el reparto de la base (625 posiciones x $37.500 =
		// $23.437.500, el 50 % exacto).
		const grossRetained = received - ascentAmount - platformShare;
		const tax = isTop ? Math.round(grossRetained * PLATFORM_TAX_RATE) : 0;
		const retained = grossRetained - tax;

		cumulative += retained;
		totalReceived += received;
		totalAscent += ascentAmount;
		totalPlatformShare += platformShare;
		totalTax += tax;

		// Lo que esta posición enviará al nivel siguiente es la mitad de lo que
		// recibió: así el nivel de arriba vive de lo que este retiene.
		//
		// La base queda fuera a propósito. No recibe nada, así que si su aporte
		// entrara en la cuenta se borraría y con él toda la cascada. El Nivel 5
		// tampoco, porque ya no hay nivel por encima que le escuche.
		if (!isBase && !isTop) forwardedByPreviousLevel = received - ascentAmount;

		steps.push({
			level: definition.number,
			levelName: definition.name,
			peopleBelow,
			received,
			ascentAmount,
			platformShare,
			tax,
			retained,
			cumulative,
			canWithdraw: definition.number >= WITHDRAWAL_MIN_LEVEL,
			// Se rellena al final, cuando ya se sabe cuál es el peldaño más alto.
			barPercent: 0,
		});
	}

	// La barra se mide contra el peldaño más alto de la propia simulación: así la
	// escalera siempre ocupa el mismo alto y los niveles se comparan de un vistazo.
	const peak = steps.reduce((max, step) => Math.max(max, step.cumulative), 0);
	for (const step of steps) {
		step.barPercent = peak > 0 ? Math.round((step.cumulative / peak) * 100) : 0;
	}

	// Lo que el miembro aporta para activar su puesto. Lo aporta una sola vez, al
	// entrar: no depende de cuántos referidos tenga ni del nivel al que llegue.
	const activationCost = RECARGA_INICIAL_AMOUNT;
	const peopleBelow = Math.pow(MAX_DIRECT_TEAM, level - 1);

	return {
		targetLevel: level,
		baseComplete,
		steps,
		totalReceived,
		totalAscent,
		totalPlatformShare,
		totalTax,
		totalRetained: cumulative,
		activationCost,
		branchContribution: peopleBelow * RECARGA_INICIAL_AMOUNT,
		returnRatio: activationCost > 0 ? cumulative / activationCost : 0,
		peopleBelow,
		canWithdraw: level >= WITHDRAWAL_MIN_LEVEL,
	};
}

/**
 * Un escenario por nivel objetivo, con la base completa y con la base incompleta.
 *
 * El componente pinta un panel por escenario y solo muestra el elegido: todas las
 * cifras viajan ya calculadas en el HTML, así que el navegador no puede
 * inventarse un número que el servidor no haya mandado.
 */
export function allAscentScenarios(): AscentSimulation[] {
	const scenarios: AscentSimulation[] = [];
	for (const definition of LEVELS) {
		for (const baseComplete of [true, false]) {
			const scenario = simulateAscent(definition.number, baseComplete);
			if (scenario) scenarios.push(scenario);
		}
	}
	return scenarios;
}

/** En qué momento del ciclo ocurre un movimiento. */
export type MovementPhase = 'registro' | 'recarga' | 'ascenso';

/**
 * Un movimiento concreto: algo que pasa en un momento dado y mueve dinero.
 *
 * La escalera de niveles dice cuánto se gana; esto dice *qué pasa y cuándo*, que
 * es la pregunta que de verdad se hace alguien que va a entrar: cuánto pone en
 * el bolsillo, cuánto le devuelven y a quién se le queda cada parte.
 */
export interface AscentMovement {
	/** Identificador estable, para enlazar el movimiento con su panel. */
	id: string;
	/** Momento del ciclo. */
	phase: MovementPhase;
	/** Nivel en el que se queda la posición tras este movimiento. */
	level: number;
	/** Nombre de ese nivel. */
	levelName: string;
	/** Qué ocurre, en una línea. */
	title: string;
	/** Quién recibe y quién paga, explicado sin rodeos. */
	detail: string;
	/** Dinero que entra en la posición. */
	incoming: number;
	/** Dinero que sale de la posición. */
	outgoing: number;
	/** A quién se le va ese dinero que sale. */
	outgoingLabel: string;
	/** Lo que queda en la posición después del movimiento. */
	remaining: number;
	/** Posiciones que hacen falta por debajo para llegar a este punto. */
	peopleBelow: number;
}

/**
 * Los movimientos del ciclo, en orden, hasta el nivel objetivo.
 *
 * Se derivan de `simulation.steps` en vez de recalcular la cascada: así la
 * línea de tiempo no puede contradecir a la escalera ni a los totales, porque
 * salen de los mismos números.
 *
 * El invariante `incoming - outgoing === remaining` se cumple en los ascensos.
 * En la recarga no aplica, y a propósito: el $15.000 sale del bolsillo del
 * miembro, no de lo que ya tenía registrado en la plataforma, así que se
 * muestra como aporte y no como pérdida sobre un saldo que nunca existió.
 */
export function ascentMovements(simulation: AscentSimulation): AscentMovement[] {
	const baseLevel = simulation.steps[0];
	if (!baseLevel) return [];

	const movements: AscentMovement[] = [
		{
			id: 'registro',
			phase: 'registro',
			level: 1,
			levelName: baseLevel.levelName,
			title: 'Te registras',
			detail:
				'Creas tu cuenta y recibes tu código de referido. Todavía no se mueve dinero: ' +
				'estás en la base, en espera.',
			incoming: 0,
			outgoing: 0,
			outgoingLabel: 'Todavía no pagas nada',
			remaining: 0,
			peopleBelow: 1,
		},
		{
			id: 'recarga',
			phase: 'recarga',
			level: 1,
			levelName: baseLevel.levelName,
			title: `Recargas ${fmtMoney(simulation.activationCost)}`,
			detail:
				`Ese aporte es lo que activa tu puesto. No se queda en tu mano: sube entero a la ` +
				`posición de Nivel 2 que te trajo, y es ese dinero el que te devolverá cuando asciendas.`,
			incoming: 0,
			outgoing: simulation.activationCost,
			outgoingLabel: 'Aporte a tu posición superior',
			remaining: 0,
			peopleBelow: 1,
		},
	];

	for (const step of simulation.steps) {
		// El Nivel 1 ya está cubierto por el registro y la recarga.
		if (step.level === 1) continue;

		const isTop = step.level === ASCENT_TOP_LEVEL;
		const outgoing = step.ascentAmount + step.platformShare + step.tax;
		const outgoingLabel = isTop
			? `${Math.round(PLATFORM_SHARE_TOP * 100)} % a GANA PRO y ${Math.round(
					PLATFORM_TAX_RATE * 100
				)} % de impuesto`
			: `${Math.round(P2P_RATE.ascenso * 100)} % al patrocinador que te trajo`;

		movements.push({
			id: `ascenso-${step.level}`,
			phase: 'ascenso',
			level: step.level,
			levelName: step.levelName,
			title: `Asciendes a ${step.levelName}`,
			detail: isTop
				? `Recibes el aporte de tus ${step.peopleBelow} posiciones. Ya no hay nivel por encima, ` +
					`así que en lugar de reenviar reparte con GANA PRO y paga el impuesto de plataforma.`
				: `Tus ${step.peopleBelow} posiciones completan su aporte y confirmas la estructura. ` +
					`Recibes el total y reenvías la mitad para subir.`,
			incoming: step.received,
			outgoing,
			outgoingLabel,
			remaining: step.retained,
			peopleBelow: step.peopleBelow,
		});
	}

	return movements;
}

/** Formatea un importe como pesos colombianos, sin decimales. */
function fmtMoney(value: number): string {
	return `$${Math.round(value).toLocaleString('es-CO')}`;
}