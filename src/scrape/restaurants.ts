/**
 * Cosecha de tarjetas de restaurante desde el listado de Rappi.
 *
 * Este modulo NO interpreta nada. Lee el DOM y devuelve `RawCard[]` con el
 * texto literal que la pantalla mostro. Toda la interpretacion vive en
 * `parse/`. La razon es la regla 3: si aqui se "limpiara" o se tradujera un
 * badge, el parser terminaria decidiendo sobre texto que Rappi nunca mostro.
 *
 * La regla 5 se materializa en un solo punto: cero tarjetas en AMBAS pasadas
 * (ofertas y listado) es un `SelectorError`, jamas un resultado vacio.
 */

import type { Locator, Page } from 'playwright';
import { SelectorError } from '../errors.js';
import type { CardSource, RawCard } from '../types.js';
import {
  CARD_BADGE,
  CARD_NAME,
  CARD_SUBTITLE,
  OFFERS_TAB,
  OFFERS_TAB_TEXT,
  RESTAURANT_CARD,
  URLS,
} from '../selectors.js';
import { findFirst, safeClick } from '../browser/guards.js';

/** Cada cuanto se re-cuentan las tarjetas mientras se espera al DOM. */
const POLL_INTERVAL_MS = 250;

/** Espera corta de asentamiento tras un scroll. Nunca es la unica espera. */
const SETTLE_MS = 400;

/** Techo por paso de scroll para que el conteo se estabilice. */
const STABILIZE_TIMEOUT_MS = 4_000;

/** Presupuesto de una navegacion a la pagina de detalle. */
const DETAIL_TIMEOUT_MS = 20_000;

export interface HarvestOptions {
  maxScrollSteps: number;
  timeoutMs: number;
  /** Opcional: para ver los reintentos de navegacion con --verbose. */
  log?: (msg: string) => void;
}

/** Selectores serializables que cruzan a `page.evaluate`. */
interface ExtractArgs {
  cardSelectors: string[];
  nameSelectors: string[];
  badgeSelectors: string[];
  subtitleSelectors: string[];
}

/** Lo que devuelve el evaluate: `RawCard` sin `source`. */
interface ExtractedCard {
  name: string;
  badgeText: string;
  subtitleText: string;
  href: string | null;
}

const EXTRACT_ARGS: ExtractArgs = {
  cardSelectors: [...RESTAURANT_CARD],
  nameSelectors: [...CARD_NAME],
  badgeSelectors: [...CARD_BADGE],
  subtitleSelectors: [...CARD_SUBTITLE],
};

/**
 * Cuerpo que corre dentro del navegador. Definido aparte para que sea una
 * funcion pura y serializable: no captura nada del scope de Node.
 */
function extractInPage(args: ExtractArgs): ExtractedCard[] {
  /** Colapsa espacios. Es lo unico que se toca del texto: ni traducir ni normalizar. */
  const squish = (value: string | null | undefined): string =>
    (value ?? '').replace(/\s+/g, ' ').trim();

  const queryAll = (root: ParentNode, selector: string): Element[] => {
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch {
      // Un candidato invalido no puede tumbar a los demas.
      return [];
    }
  };

  /** Primer candidato de la lista que encuentre algo. El orden es la prioridad. */
  const pickCards = (): Element[] => {
    for (const selector of args.cardSelectors) {
      const matches = queryAll(document, selector);
      if (matches.length === 0) continue;

      // Un mismo selector puede matchear una tarjeta y algo dentro de ella.
      // Solo interesan los nodos de nivel superior.
      const set = new Set(matches);
      const outermost = matches.filter((el) => {
        for (let p = el.parentElement; p !== null; p = p.parentElement) {
          if (set.has(p)) return false;
        }
        return true;
      });
      if (outermost.length > 0) return outermost;
    }
    return [];
  };

  const firstText = (card: Element, selectors: string[]): string => {
    for (const selector of selectors) {
      for (const el of queryAll(card, selector)) {
        const text = squish(el.textContent);
        if (text !== '') return text;
      }
    }
    return '';
  };

  /** Una tarjeta puede llevar mas de un badge. Se concatenan todos, en orden DOM. */
  const allBadgeText = (card: Element): string => {
    const found: Element[] = [];
    for (const selector of args.badgeSelectors) {
      for (const el of queryAll(card, selector)) {
        if (!found.includes(el)) found.push(el);
      }
    }
    // Si un badge esta dentro de otro ya recogido, su texto ya vino incluido.
    const kept = found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
    kept.sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
    return kept
      .map((el) => squish(el.textContent))
      .filter((text) => text !== '')
      .join(' ')
      .trim();
  };

  /**
   * Ultimo recurso para el nombre: la primera linea del texto propio de la
   * tarjeta, saltando lo que ya se contabilizo como badge. Sin ese salto, una
   * tarjeta sin nombre legible terminaria reportando un restaurante llamado
   * "50% OFF", que es exactamente el tipo de dato inventado que la regla 3
   * prohibe.
   */
  const firstLine = (card: Element, badgeText: string): string => {
    for (const line of (card.textContent ?? '').split('\n')) {
      const text = squish(line);
      if (text === '') continue;
      if (badgeText !== '' && badgeText.includes(text)) continue;
      return text;
    }
    return '';
  };

  const absoluteHref = (card: Element): string | null => {
    const anchor = card.matches('a[href]') ? card : card.querySelector('a[href]');
    const raw = anchor?.getAttribute('href');
    if (raw === null || raw === undefined || raw === '') return null;
    try {
      return new URL(raw, document.baseURI).href;
    } catch {
      // Documento sin base resoluble (p. ej. `setContent`): se reporta el crudo.
      return raw;
    }
  };

  const cards: ExtractedCard[] = [];
  for (const card of pickCards()) {
    const badgeText = allBadgeText(card);
    // En el DOM real de Rappi la tarjeta es un <a aria-label="Home Burgers">.
    // Es la fuente mas limpia del nombre: viene sin el badge ni el tiempo de
    // entrega pegados, que es justo lo que ensucia el texto visible.
    const ariaName = squish(card.getAttribute('aria-label'));
    const name = ariaName || firstText(card, args.nameSelectors) || firstLine(card, badgeText);
    // Una tarjeta sin nombre no se puede reportar ni deduplicar. Se descarta.
    if (name === '') continue;

    cards.push({
      name,
      badgeText,
      subtitleText: firstText(card, args.subtitleSelectors),
      href: absoluteHref(card),
    });
  }
  return cards;
}

/**
 * Nucleo de extraccion, aislado a proposito para poder probarlo offline con
 * `page.setContent()` sobre los fixtures, sin red y sin sesion.
 */
export async function extractCardsFromPage(
  page: Page,
  source: CardSource,
): Promise<RawCard[]> {
  const extracted = await page.evaluate(extractInPage, EXTRACT_ARGS);
  return extracted.map((card) => ({ ...card, source }));
}

/** Cuenta tarjetas con el mismo criterio de candidatos que la extraccion. */
async function countCards(page: Page): Promise<number> {
  return page.evaluate((selectors: string[]) => {
    for (const selector of selectors) {
      try {
        const found = document.querySelectorAll(selector);
        if (found.length > 0) return found.length;
      } catch {
        continue;
      }
    }
    return 0;
  }, [...RESTAURANT_CARD]);
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Espera a que aparezca al menos una tarjeta. Devuelve el conteo, 0 si se
 * agoto el presupuesto. No lanza: quien llama decide si el vacio es fatal.
 */
async function waitForAnyCard(page: Page, budgetMs: number): Promise<number> {
  const deadline = Date.now() + Math.max(budgetMs, 0);
  for (;;) {
    const count = await countCards(page);
    if (count > 0) return count;
    if (Date.now() >= deadline) return 0;
    await sleep(POLL_INTERVAL_MS);
  }
}

/**
 * Espera a que el conteo deje de crecer. Esto es lo que reemplaza al
 * `waitForTimeout` fijo: se espera a una condicion del DOM, y el `SETTLE_MS`
 * es solo un complemento, nunca la unica espera.
 */
async function waitForCountToSettle(page: Page, deadline: number): Promise<number> {
  const localDeadline = Math.min(deadline, Date.now() + STABILIZE_TIMEOUT_MS);
  let previous = await countCards(page);

  while (Date.now() < localDeadline) {
    await sleep(POLL_INTERVAL_MS);
    const current = await countCards(page);
    if (current === previous) return current;
    previous = current;
  }
  return previous;
}

/** Normaliza un nombre solo para deduplicar. Nunca se reporta esta forma. */
function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** A mayor texto de badge + subtitulo, mas informacion para parsear. */
function richness(card: RawCard): number {
  return `${card.badgeText} ${card.subtitleText}`.trim().length;
}

/**
 * Deduplica por nombre normalizado quedandose con el registro mas rico.
 * Exportada porque es pura y merece prueba propia.
 */
export function dedupeByName(cards: RawCard[]): RawCard[] {
  const byName = new Map<string, RawCard>();
  for (const card of cards) {
    const key = normalizeName(card.name);
    const existing = byName.get(key);
    if (existing === undefined || richness(card) > richness(existing)) {
      byName.set(key, card);
    }
  }
  return [...byName.values()];
}

/**
 * Cero tarjetas donde se esperaban tarjetas significa que Rappi cambio su
 * HTML. Se nombra cada selector probado para que la recalibracion sea una
 * sola edicion en `selectors.ts`.
 */
function throwNoCards(): never {
  const tried = RESTAURANT_CARD.join(', ');
  throw new SelectorError(
    `No se encontro ninguna tarjeta de restaurante en ${URLS.restaurants}. ` +
      `Esto NO significa que no haya ofertas: significa que Rappi cambio su HTML. ` +
      `Selectores probados: ${tried}`,
    tried,
  );
}

/** Localiza la pestana de ofertas por selector, y si no, por texto visible. */
async function findOffersTab(page: Page): Promise<Locator | null> {
  const bySelector = await findFirst(page, OFFERS_TAB);
  if (bySelector !== null) return bySelector;

  const byText = page
    .locator('a, button, [role="tab"], [role="link"]')
    .filter({ hasText: OFFERS_TAB_TEXT })
    .first();
  return (await byText.count()) > 0 ? byText : null;
}

/**
 * Pasada de ofertas. NO es fatal que la pestana no exista: Rappi la muestra de
 * forma intermitente. Solo la ausencia total de tarjetas en ambas pasadas lo es.
 */
async function harvestOffersTab(page: Page, deadline: number): Promise<RawCard[]> {
  try {
    const tab = await findOffersTab(page);
    if (tab === null) {
      console.warn('[scrape] No hay pestana de ofertas; sigo con el listado principal.');
      return [];
    }

    await safeClick(tab, 'pestana de ofertas');

    const remaining = deadline - Date.now();
    if ((await waitForAnyCard(page, Math.min(remaining, 10_000))) === 0) {
      console.warn('[scrape] La pestana de ofertas no cargo tarjetas; sigo con el listado.');
      return [];
    }
    return await extractCardsFromPage(page, 'ofertas');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[scrape] Fallo la pasada de ofertas (no fatal): ${message}`);
    return [];
  }
}

/**
 * Listado principal con scroll infinito. Se detiene cuando el conteo deja de
 * crecer en dos pasos seguidos, cuando se agotan los pasos, o cuando se acaba
 * el presupuesto de tiempo.
 */
async function harvestMainListing(
  page: Page,
  opts: HarvestOptions,
  deadline: number,
): Promise<RawCard[]> {
  if ((await waitForAnyCard(page, Math.max(deadline - Date.now(), 0))) === 0) {
    return [];
  }

  let previousCount = await countCards(page);
  let stagnantSteps = 0;

  for (let step = 0; step < opts.maxScrollSteps; step += 1) {
    if (Date.now() >= deadline) {
      console.warn(`[scrape] Presupuesto agotado en el paso de scroll ${step}.`);
      break;
    }

    await page.mouse.wheel(0, 2_000);
    await page.evaluate(() => window.scrollBy(0, window.innerHeight));
    await sleep(SETTLE_MS);

    const settled = await waitForCountToSettle(page, deadline);
    if (settled > previousCount) {
      stagnantSteps = 0;
    } else {
      stagnantSteps += 1;
      if (stagnantSteps >= 2) break;
    }
    previousCount = Math.max(previousCount, settled);
  }

  return extractCardsFromPage(page, 'listing');
}

/** Cuantas veces se reintenta obtener la variante con listado. */
const LISTING_ATTEMPTS = 5;
/** Cuanto se espera a que aparezcan tarjetas en cada intento, en ms. */
const LISTING_ATTEMPT_MS = 12_000;
/** Espera base entre reintentos de navegacion, en ms. Crece exponencialmente. */
const LISTING_BACKOFF_MS = 4_000;

/**
 * Navega al listado y REINTENTA hasta que Rappi entregue la variante buena.
 *
 * Medido en vivo: la misma URL devuelve a veces el listado personalizado (con
 * tarjetas) y a veces una pagina SEO de "Top Marcas y Cadenas" que no tiene
 * ninguna. Es no determinista y cambia entre cargas de la misma sesion.
 *
 * Sin este reintento, la mitad de las corridas de cron reportarian un fallo de
 * selector que no es tal. Con el, un cero al final sigue siendo fatal: quiere
 * decir que ninguna de las cinco cargas trajo tarjetas, y eso si es senal de
 * que el HTML cambio.
 */
export async function gotoListing(
  page: Page,
  deadline: number,
  log?: (msg: string) => void,
): Promise<number> {
  let lastCount = 0;

  for (let attempt = 1; attempt <= LISTING_ATTEMPTS; attempt += 1) {
    const remaining = Math.max(deadline - Date.now(), 0);
    if (remaining <= 0) break;

    await page.goto(URLS.restaurants, {
      waitUntil: 'domcontentloaded',
      timeout: Math.max(Math.min(remaining, 30_000), 1_000),
    });

    lastCount = await waitForAnyCard(page, Math.min(LISTING_ATTEMPT_MS, Math.max(deadline - Date.now(), 0)));
    if (lastCount > 0) return lastCount;

    // Backoff creciente antes de reintentar. Recargar de inmediato es
    // contraproducente: una rafaga de cargas identicas es justo lo que hace
    // que Rappi deje de servir el listado y devuelva su pagina estatica.
    const backoff = Math.min(LISTING_BACKOFF_MS * 2 ** (attempt - 1), 20_000);
    log?.(`intento ${attempt}: Rappi devolvio la variante sin listado; espero ${Math.round(backoff / 1000)}s y recargo`);
    if (Date.now() + backoff >= deadline) break;
    await sleep(backoff);
  }

  return lastCount;
}

/**
 * Punto de entrada del scraping. Devuelve tarjetas crudas deduplicadas.
 *
 * @throws {SelectorError} si no se leyo NINGUNA tarjeta en ninguna pasada.
 */
export async function harvestRestaurants(
  page: Page,
  opts: HarvestOptions,
): Promise<RawCard[]> {
  const deadline = Date.now() + opts.timeoutMs;

  // Un cero aqui todavia no es fatal: la pasada de ofertas puede traer
  // tarjetas por su cuenta. Solo el vacio en AMBAS pasadas significa que
  // Rappi cambio su HTML.
  await gotoListing(page, deadline, opts.log);
  const offers = await harvestOffersTab(page, deadline);

  // Volver al listado es una navegacion GET plana, nunca un boton de "atras"
  // de la app: asi no se depende del historial del SPA.
  await gotoListing(page, deadline, opts.log);

  const listing = await harvestMainListing(page, opts, deadline);

  const all = [...offers, ...listing];
  if (all.length === 0) throwNoCards();

  return dedupeByName(all);
}

/** Palabras que delatan los terminos de una promocion en la pagina de detalle. */
const PROMO_TERM_HINTS =
  'aplica|válid|valid|término|termino|condicion|condición|promoción|promocion|descuento|primer pedido|pedido mínimo|pedido minimo|hasta el|menú|menu seleccionad|productos seleccionad';

/** Tope de texto devuelto. Los terminos utiles siempre caben de sobra. */
const DETAIL_TEXT_LIMIT = 800;

/**
 * Abre la pagina de detalle con una navegacion GET plana y devuelve el texto
 * de terminos visible, o '' si no se pudo leer.
 *
 * No hace clic en NADA. La pagina de detalle es donde viven los botones de
 * compra, asi que aqui solo se lee.
 */
export async function resolveScopeFromDetail(page: Page, href: string): Promise<string> {
  if (!/^https?:\/\//i.test(href)) return '';

  try {
    await page.goto(href, {
      waitUntil: 'domcontentloaded',
      timeout: DETAIL_TIMEOUT_MS,
    });
  } catch {
    return '';
  }

  try {
    return await page.evaluate(
      (args: { hints: string; selectors: string[]; limit: number }) => {
        const squish = (value: string | null | undefined): string =>
          (value ?? '').replace(/\s+/g, ' ').trim();

        const hints = new RegExp(args.hints, 'i');
        const seen = new Set<string>();
        const parts: string[] = [];

        const push = (text: string): void => {
          if (text === '' || seen.has(text)) return;
          seen.add(text);
          parts.push(text);
        };

        // Texto propio de cada elemento (sin descendientes), para no arrastrar
        // media pagina cuando un contenedor grande menciona una palabra clave.
        for (const el of Array.from(document.querySelectorAll('p, li, span, div, section'))) {
          let own = '';
          for (const node of Array.from(el.childNodes)) {
            if (node.nodeType === 3) own += node.nodeValue ?? '';
          }
          const text = squish(own);
          if (text !== '' && hints.test(text)) push(text);
        }

        for (const selector of args.selectors) {
          try {
            for (const el of Array.from(document.querySelectorAll(selector))) {
              const text = squish(el.textContent);
              if (text !== '' && hints.test(text)) push(text);
            }
          } catch {
            continue;
          }
        }

        return parts.join(' ').slice(0, args.limit);
      },
      {
        hints: PROMO_TERM_HINTS,
        selectors: [...CARD_SUBTITLE, ...CARD_BADGE],
        limit: DETAIL_TEXT_LIMIT,
      },
    );
  } catch {
    return '';
  }
}
