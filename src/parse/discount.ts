/**
 * PURO: texto de una tarjeta -> ParsedDiscount | null.
 *
 * Regla que gobierna todo este archivo: NUNCA inventar ni estimar un
 * porcentaje. Devolver `null` (y descartar el restaurante) siempre es mejor que
 * adivinar. `percent` existe solo para filtrar (>=50) y ordenar; `literal` es el
 * texto verbatim de la pantalla y es lo unico que se le muestra al usuario.
 */

import type { DiscountKind, ParsedDiscount } from '../types.js';

/** Un descuento legible encontrado en el texto, con su posicion. */
export interface DiscountCandidate extends ParsedDiscount {
  /** Indice donde empieza `literal` dentro del texto original. */
  index: number;
}

/** Un 2x1 vale como 50% para filtrar, pero se reporta como 2x1. */
const DOS_X_UNO_PERCENT = 50;

/** Fuera de este rango el numero no es un descuento, es ruido. */
const MIN_PERCENT = 0; // exclusivo: 0% no es una oferta
const MAX_PERCENT = 100;

/**
 * Palabras que confirman que un numero con `%` es un descuento.
 * Se aceptan `OFF`, `dcto`, `desc`, `descuento` y la forma `de descuento`.
 */
const KEYWORD = String.raw`(?:descuento|dcto\.?|desc\.?|off)`;

/**
 * Un unico barrido de izquierda a derecha con dos ramas alternativas.
 *
 * La rama `upto` va primero para que "hasta 60%" se consuma como techo y la
 * rama plana no vuelva a ver ese mismo 60.
 *
 * `(?<![\d.,])` evita enganchar la cola de un numero mas largo (p. ej. tomar
 * "50" de "1.150%").
 */
const PERCENT_RE = new RegExp(
  [
    // Techo: "hasta 60%", "hasta un 60% OFF", "Hasta el 70% de descuento".
    String.raw`(?<upto>\bhasta\s+(?:un\s+|una\s+|el\s+|la\s+|los\s+)?` +
      String.raw`(?<![\d.,])(?<uptoNum>\d{1,3}(?:[.,]\d{1,2})?)\s*%` +
      String.raw`(?:\s*(?:de\s+)?${KEYWORD}\b)?)`,
    // Plano: "50% OFF", "50%OFF", "-50%", "50 % de descuento", "Descuento 50%".
    String.raw`(?<exact>(?:\b(?<lead>descuento|dcto\.?|desc\.?)\s*)?` +
      String.raw`(?<sign>-\s*)?` +
      String.raw`(?<![\d.,])(?<exactNum>\d{1,3}(?:[.,]\d{1,2})?)\s*%` +
      String.raw`(?:\s*(?<trail>(?:de\s+)?${KEYWORD})\b)?)`,
  ].join('|'),
  'giu',
);

/**
 * "2x1", "2X1", "2 x 1", "Lleva 2 paga 1".
 *
 * `3x2` NO entra a proposito: extrapolarlo a un porcentaje seria inventar.
 * Los `\b` evitan que "12x1" cuente como un 2x1.
 */
const DOS_X_UNO_RE = /\b2\s*[x×]\s*1\b|\blleva\s+2\s+paga\s+1\b/giu;

function toPercent(raw: string): number {
  return Number.parseFloat(raw.replace(',', '.'));
}

function inRange(percent: number): boolean {
  return Number.isFinite(percent) && percent > MIN_PERCENT && percent <= MAX_PERCENT;
}

/**
 * Encuentra todos los descuentos legibles del texto, en orden de aparicion.
 *
 * Los candidatos fuera de rango se descartan aqui: un "150% OFF" es ruido y no
 * debe impedir que se lea un "60% OFF" que venga despues en la misma tarjeta.
 */
export function findDiscountCandidates(text: string): DiscountCandidate[] {
  if (!text) return [];
  const found: DiscountCandidate[] = [];

  PERCENT_RE.lastIndex = 0;
  for (const m of text.matchAll(PERCENT_RE)) {
    const g = m.groups ?? {};
    const index = m.index ?? 0;

    if (g['upto'] !== undefined) {
      const percent = toPercent(g['uptoNum'] ?? '');
      if (inRange(percent)) {
        found.push({ percent, literal: g['upto'], kind: 'upto', index });
      }
      continue;
    }

    const literal = g['exact'];
    if (literal === undefined) continue;

    // Un `%` suelto no basta: "100% natural" no es una oferta. Se exige contexto
    // de descuento (palabra clave o signo menos) o que el badge sea SOLO el
    // porcentaje, que es como Rappi muestra un descuento plano sin sufijo.
    const hasContext =
      g['lead'] !== undefined ||
      g['sign'] !== undefined ||
      g['trail'] !== undefined ||
      text.trim() === literal.trim();
    if (!hasContext) continue;

    const percent = toPercent(g['exactNum'] ?? '');
    if (!inRange(percent)) continue;
    found.push({ percent, literal, kind: 'exact', index });
  }

  DOS_X_UNO_RE.lastIndex = 0;
  for (const m of text.matchAll(DOS_X_UNO_RE)) {
    found.push({
      percent: DOS_X_UNO_PERCENT,
      literal: m[0],
      kind: '2x1',
      index: m.index ?? 0,
    });
  }

  found.sort((a, b) => a.index - b.index);
  return found;
}

/**
 * Desempate por tipo cuando dos candidatos valen lo mismo.
 *
 * `exact` > `2x1` > `upto`: un porcentaje explicito es la afirmacion mas firme
 * y verificable; el techo es la mas debil porque el valor real puede ser menor.
 * Asi "50% OFF 2x1" se reporta como "50% OFF" de forma determinista.
 */
const KIND_RANK: Record<DiscountKind, number> = { exact: 2, '2x1': 1, upto: 0 };

/**
 * Lee el descuento de una tarjeta. `null` = ilegible, se descarta el restaurante.
 *
 * Cuando la tarjeta trae varios badges (llegan unidos por espacios) se toma el
 * porcentaje mas alto, conservando SU propio `kind` y SU propio `literal`.
 */
export function parseDiscount(text: string): ParsedDiscount | null {
  const candidates = findDiscountCandidates(text);
  if (candidates.length === 0) return null;

  let best = candidates[0] as DiscountCandidate;
  for (const c of candidates.slice(1)) {
    if (c.percent > best.percent) {
      best = c;
      continue;
    }
    if (c.percent === best.percent && KIND_RANK[c.kind] > KIND_RANK[best.kind]) {
      best = c;
    }
  }

  return { percent: best.percent, literal: best.literal, kind: best.kind };
}
