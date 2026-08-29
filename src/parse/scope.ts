/**
 * PURO: texto de una tarjeta -> alcance de la promocion + fecha limite.
 *
 * `unknown` es una respuesta legitima y honesta: el reporte la declara tal cual.
 * NUNCA se cae por defecto a `full-menu`, porque eso seria afirmar algo que la
 * pantalla no dijo.
 */

import type { ParsedScope, PromoScope } from '../types.js';

/** Minusculas y sin tildes, para comparar sin depender de como venga escrito. */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

/**
 * Patrones por alcance, del mas especifico al mas general.
 * El primero que coincide gana: "todo el menu en tu primer pedido" es
 * first-order, no full-menu.
 */
const SCOPE_RULES: ReadonlyArray<{ scope: PromoScope; patterns: RegExp[] }> = [
  {
    scope: 'first-order',
    patterns: [
      /\bprimer\s+pedido\b/u,
      /\bprimera\s+compra\b/u,
      /\bprimera\s+orden\b/u,
      /\bnuevos\s+usuarios\b/u,
    ],
  },
  {
    scope: 'selected-items',
    patterns: [
      /\bproductos\s+seleccionados\b/u,
      /\barticulos\s+seleccionados\b/u,
      /\bproductos\s+participantes\b/u,
      /\ben\s+seleccionados\b/u,
      /\ben\s+productos\b/u,
    ],
  },
  {
    scope: 'full-menu',
    patterns: [
      // "todo el men" cubre "menu", "menú" y el texto truncado por la UI.
      /\btodo\s+el\s+men/u,
      /\ben\s+toda\s+la\s+tienda\b/u,
      /\btodos\s+los\s+productos\b/u,
    ],
  },
];

/** Lee el alcance del texto. Nunca lo infiere. */
export function detectScope(text: string): PromoScope {
  const t = normalize(text);
  for (const rule of SCOPE_RULES) {
    if (rule.patterns.some((p) => p.test(t))) return rule.scope;
  }
  return 'unknown';
}

const MESES =
  '(?:enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)';
const DIAS = '(?:hoy|ma[nñ]ana|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)';
const VALIDO = String.raw`(?:v[aá]lid[oa]\s+)?`;

/**
 * Fechas limite reconocidas. Se corren contra el texto ORIGINAL (con clases de
 * caracteres tolerantes a tildes) para poder devolver la subcadena VERBATIM.
 *
 * Todas exigen que despues de "hasta" venga algo que sea claramente una fecha.
 * Asi "hasta 60% OFF" (un techo de descuento) y "Entrega hasta 30 min" no se
 * confunden con un limite de tiempo.
 */
const DEADLINE_RES: RegExp[] = [
  // "hasta el 31/08", "Válido hasta el 31-08-2026"
  new RegExp(VALIDO + String.raw`hasta\s+(?:el\s+)?\d{1,2}\s*[/-]\s*\d{1,2}(?:\s*[/-]\s*\d{2,4})?`, 'iu'),
  // "válido hasta el 31 de agosto"
  new RegExp(VALIDO + String.raw`hasta\s+(?:el\s+)?\d{1,2}\s+de\s+` + MESES, 'iu'),
  // "hasta mañana", "hasta el domingo"
  new RegExp(VALIDO + String.raw`hasta\s+(?:el\s+)?` + DIAS + String.raw`\b`, 'iu'),
  // "solo hoy", "Sólo por hoy"
  /\bs[oó]lo\s+(?:por\s+)?hoy\b/iu,
  // "termina en 2 días", "Termina en 5 horas"
  /\btermina\s+en\s+\d{1,3}\s+(?:d[ií]as?|horas?|minutos?)\b/iu,
];

/**
 * Devuelve el limite de tiempo VERBATIM tal como aparece en pantalla, o `null`.
 * No se reformatea ni se convierte a ISO: el usuario pidio lo que dice la pantalla.
 */
export function extractDeadline(text: string): string | null {
  if (!text) return null;
  for (const re of DEADLINE_RES) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

/** Alcance y fecha limite de una tarjeta. */
export function parseScope(text: string): ParsedScope {
  return { scope: detectScope(text), deadline: extractDeadline(text) };
}
