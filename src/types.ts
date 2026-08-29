/**
 * Modelo de datos compartido. Contrato entre scraper, parsers y reporte.
 *
 * Regla clave: `percent` existe SOLO para filtrar (>=50) y ordenar.
 * Lo que se le muestra al usuario es siempre `literal`, el texto tal cual
 * aparece en pantalla. Nunca se imprime un porcentaje que Rappi no mostro.
 */

/** Como se expresa el descuento en la tarjeta. */
export type DiscountKind =
  /** Un porcentaje plano y explicito: "50% OFF". */
  | 'exact'
  /** Un techo: "hasta 60%". Se usa el 60 pero se marca como techo. */
  | 'upto'
  /** "2x1": cuenta como 50% pero se reporta como 2x1, nunca como porcentaje. */
  | '2x1';

export interface ParsedDiscount {
  /** Solo para filtrar y ordenar. Nunca se imprime. */
  percent: number;
  /** Texto exacto en pantalla. Esto es lo que se imprime. */
  literal: string;
  kind: DiscountKind;
}

/** Alcance de la promocion, leido del texto. Nunca inferido. */
export type PromoScope =
  | 'full-menu'
  | 'selected-items'
  | 'first-order'
  | 'unknown';

export interface ParsedScope {
  scope: PromoScope;
  /** Limite de tiempo textual si aparece ("hasta el 31/08"), o null. */
  deadline: string | null;
}

/** De donde salio la tarjeta. */
export type CardSource = 'ofertas' | 'listing';

/** Una tarjeta cruda leida del DOM, sin interpretar. */
export interface RawCard {
  name: string;
  badgeText: string;
  subtitleText: string;
  href: string | null;
  source: CardSource;
}

/** Una oferta que paso el filtro >=50%. */
export interface Offer {
  name: string;
  discount: ParsedDiscount;
  scope: PromoScope;
  deadline: string | null;
  href: string | null;
}

/** Resultado de una corrida exitosa. */
export interface RunResult {
  offers: Offer[];
  /** Tarjetas totales vistas en el DOM. 0 es sospechoso, no "sin ofertas". */
  cardsSeen: number;
  /** Tarjetas con un descuento legible (haya pasado o no el filtro). */
  candidatesParsed: number;
}

/** Registro que se escribe a logs/runs.jsonl, una linea por corrida. */
export interface RunLogRecord {
  timestamp: string;
  durationMs: number;
  outcome: 'success' | 'failure';
  cardsSeen: number;
  candidatesParsed: number;
  offersMatched: number;
  dryRun: boolean;
  errorCode?: string;
  errorMessage?: string;
  /** Que selector fallo, cuando se sabe. Para diagnosticar cambios de HTML. */
  failedSelector?: string;
}
