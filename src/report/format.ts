/**
 * PURO: Offer[] -> mensaje de Discord.
 *
 * Dos reglas mandan aqui:
 * 1. Solo se imprime `literal`, el texto verbatim de la pantalla. `percent` sirve
 *    para ordenar y jamas se imprime.
 * 2. El alcance se declara SIEMPRE. Un descuento sobre productos seleccionados o
 *    sobre el primer pedido nunca puede leerse como un descuento de todo el menu.
 */

import type { Offer, PromoScope } from '../types.js';

/** Tope duro de un mensaje de Discord. */
export const DISCORD_LIMIT = 2000;

/**
 * Texto exacto del estado vacio. Requisito literal del usuario, incluido el
 * caracter `≥` y el punto final. Se envia en cada corrida sin ofertas, de modo
 * que el silencio del canal signifique siempre que el job murio.
 */
export const EMPTY_REPORT = 'Sin ofertas ≥50% hoy.';

const SEP = ' — ';

/** Como se nombra cada alcance. La advertencia es parte del texto, no decoracion. */
const SCOPE_LABEL: Record<PromoScope, string> = {
  'full-menu': 'todo el menú',
  'selected-items': '⚠️ solo productos seleccionados',
  'first-order': '⚠️ solo primer pedido',
  unknown: '⚠️ alcance no confirmado',
};

/**
 * El literal, mas la aclaracion minima que impide leerlo como un porcentaje plano.
 * Un techo se marca como techo; un 2x1 se muestra como 2x1 y nunca como "50%".
 */
function renderDiscount(offer: Offer): string {
  const { literal, kind } = offer.discount;
  if (kind === 'upto') return `${literal} (tope, puede ser menos)`;
  if (kind === '2x1' && !/2\s*[x×]\s*1/iu.test(literal)) return `${literal} (2x1)`;
  return literal;
}

function renderLine(offer: Offer): string {
  const parts = [`- ${offer.name}`, renderDiscount(offer), SCOPE_LABEL[offer.scope]];
  if (offer.deadline) parts.push(offer.deadline);
  return parts.join(SEP);
}

/**
 * Orden determinista: porcentaje descendente y, en empate, nombre alfabetico.
 * La comparacion cae a una comparacion cruda si el locale considera dos nombres
 * equivalentes, para que el resultado no dependa del ICU disponible.
 */
function byRank(a: Offer, b: Offer): number {
  if (b.discount.percent !== a.discount.percent) {
    return b.discount.percent - a.discount.percent;
  }
  const byName = a.name.localeCompare(b.name, 'es');
  if (byName !== 0) return byName;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function omittedLine(count: number): string {
  return `… y ${count} más (recortado por el límite de Discord).`;
}

/** Arma el mensaje del reporte. `[]` produce el estado vacio exacto. */
export function formatReport(offers: Offer[]): string {
  if (offers.length === 0) return EMPTY_REPORT;

  const sorted = [...offers].sort(byRank);
  // El encabezado cuenta el total encontrado, no el total mostrado.
  const header = `Ofertas Rappi ≥50% — Chía (${sorted.length})`;
  const lines = sorted.map(renderLine);

  const full = [header, ...lines].join('\n');
  if (full.length <= DISCORD_LIMIT) return full;

  // Se recorta desde el final (las ofertas mas bajas) hasta que el mensaje, con
  // su propia linea de aviso, quepa en el limite.
  let shown = lines.length;
  while (shown > 0) {
    const candidate = [header, ...lines.slice(0, shown), omittedLine(lines.length - shown)].join('\n');
    if (candidate.length <= DISCORD_LIMIT) return candidate;
    shown -= 1;
  }
  return [header, omittedLine(lines.length)].join('\n');
}

/** Que hacer con cada tipo de fallo. El objetivo es que la corrida sea reparable. */
const FAILURE_HINT: Record<string, string> = {
  CONFIG: 'Falta o esta mal una variable de entorno. Revisa el archivo `.env` contra `.env.example`.',
  SESSION: 'La sesion de Rappi parece cerrada. Ejecuta `npm run login` e inicia sesion de nuevo.',
  ADDRESS:
    'La direccion activa no es Chia. Ejecuta `npm run login` y confirma la direccion; el job nunca la cambia solo.',
  SELECTOR:
    'Rappi probablemente cambio su HTML. Recalibra los selectores en `src/selectors.ts` (el volcado del DOM queda en `logs/`).',
  TIMEOUT: 'Rappi tardo demasiado en cargar. Reintenta; si se repite, revisa la conexion o sube el timeout.',
  NOTIFY: 'Fallo el envio a Discord. Revisa que el webhook siga vivo en la configuracion.',
  FORBIDDEN_ACTION:
    'El scraper intento una accion prohibida y se aborto. Esto es un bug del scraper, no de Rappi: revisa `src/browser/guards.ts`.',
};

const DEFAULT_HINT = 'Fallo no clasificado. Revisa `logs/runs.jsonl` para el detalle de la corrida.';

/**
 * Mensaje de fallo. Empieza con ⚠️ y dice FALLO en el encabezado para que sea
 * imposible confundirlo con un reporte normal: un selector roto NO es
 * "no hay ofertas".
 */
export function formatFailure(code: string, message: string): string {
  const hint = FAILURE_HINT[code] ?? DEFAULT_HINT;
  const head = `⚠️ rappi-ofertas FALLO — ${code}`;
  const tail = `\n${hint}\n(No se pudo revisar Rappi: esto NO significa que no haya ofertas.)`;
  // El mensaje del error puede venir de Playwright y ser enorme: se recorta.
  const room = DISCORD_LIMIT - head.length - tail.length - 1;
  const detail = message.length > room ? `${message.slice(0, Math.max(0, room - 1))}…` : message;
  return `${head}\n${detail}${tail}`;
}
