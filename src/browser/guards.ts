/**
 * Capa de seguridad. Este es el modulo mas importante del proyecto.
 *
 * Las reglas 1 y 2 del diseno (nunca comprar, nunca mutar la cuenta) se
 * sostienen con tres barreras independientes, de modo que un error en una no
 * llegue a la red:
 *
 *   1. `installReadOnlyGuard`  - deny-list de red. Aborta la peticion HTTP.
 *   2. `safeClick`             - deny-list de texto. Se niega a hacer el clic.
 *   3. lista blanca de clics   - vive en el scraper: solo pestanas y enlaces.
 *
 * La parte pura y testeable (`isForbiddenClickText`, `normalizeAddress`) esta
 * separada a proposito de la parte que toca el navegador.
 */

import type { BrowserContext, Locator, Page } from 'playwright';
import {
  ADDRESS_INDICATOR,
  BLOCKED_URL_PATTERNS,
  FORBIDDEN_CLICK_TEXT,
  LOGGED_IN_INDICATOR,
  LOGGED_OUT_INDICATOR,
  READ_ONLY_URL_PATTERNS,
  SAFE_METHODS,
} from '../selectors.js';
import { AddressError, ForbiddenActionError, SelectorError, SessionError } from '../errors.js';

/** Tiempo maximo para leer el texto de un elemento antes de decidir el clic. */
const TEXT_READ_TIMEOUT_MS = 5_000;
/** Tiempo maximo del clic en si. */
const CLICK_TIMEOUT_MS = 10_000;

// ---------------------------------------------------------------------------
// 1. Guard de red
// ---------------------------------------------------------------------------

/** Contador de peticiones abortadas. El CLI lo reporta al final de la corrida. */
let blockedRequestCount = 0;

/** Cuantas peticiones aborto el guard en este proceso. */
export function getBlockedRequestCount(): number {
  return blockedRequestCount;
}

/**
 * ¿Hay que abortar esta peticion? Puro, sin navegador: dos strings entran, un
 * booleano sale. Aqui vive toda la decision de la capa de red.
 *
 * La deny-list esta partida en dos a proposito, y la razon no es obvia:
 *
 * - `BLOCKED_URL_PATTERNS` (carrito, checkout, orders, pagos) se aborta con
 *   CUALQUIER metodo. Nunca necesitamos leer esas rutas, asi que cerrarlas de
 *   plano no cuesta nada.
 *
 * - `READ_ONLY_URL_PATTERNS` (direccion, cuenta, ajustes, perfil) NO se puede
 *   cerrar de plano: Rappi pinta la direccion activa del header con un GET a
 *   una de esas rutas. Si lo abortaramos, el header quedaria vacio y
 *   `assertAddressMatches` fallaria en cada corrida — el guard romperia su
 *   propio chequeo de direccion. Lo que hay que impedir es la ESCRITURA, y
 *   cambiar una direccion o un ajuste siempre lo es.
 *
 * La garantia de seguridad no se afloja: leer la direccion no la cambia.
 *
 * El criterio es fail-closed: se permite lo que esta en `SAFE_METHODS`, no se
 * bloquea lo que esta en `MUTATING_METHODS`. Un metodo raro cuenta como
 * escritura y se aborta.
 */
export function shouldAbort(url: string, method: string): boolean {
  if (BLOCKED_URL_PATTERNS.some((pattern) => pattern.test(url))) return true;

  const isSafeMethod = (SAFE_METHODS as readonly string[]).includes(method.toUpperCase());
  if (isSafeMethod) return false;

  return READ_ONLY_URL_PATTERNS.some((pattern) => pattern.test(url));
}

/**
 * Instala la deny-list de red sobre el contexto entero.
 *
 * Debe llamarse ANTES de la primera navegacion: una peticion que sale antes de
 * que exista el handler no pasa por el filtro.
 *
 * OJO: no se bloquean todos los POST. Rappi carga contenido normal por
 * POST/GraphQL y bloquearlos en bloque rompe la pagina. Solo manda lo que diga
 * `shouldAbort`.
 */
export async function installReadOnlyGuard(context: BrowserContext): Promise<void> {
  await context.route('**/*', async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();

    try {
      if (shouldAbort(url, method)) {
        blockedRequestCount += 1;
        // eslint-disable-next-line no-console
        console.warn(`[guard] peticion bloqueada: ${method} ${url}`);
        await route.abort('blockedbyclient');
        return;
      }
      await route.continue();
    } catch {
      // La pagina o el contexto pueden cerrarse a mitad de la peticion.
      // Un handler que revienta no debe tumbar la corrida.
    }
  });
}

// ---------------------------------------------------------------------------
// 2. Guard de clics
// ---------------------------------------------------------------------------

/**
 * Nucleo puro del guard de clics: ¿este texto delata un boton de compra?
 *
 * Sin navegador, sin async. Aqui vive la logica riesgosa y aqui apuntan los
 * tests unitarios.
 */
export function isForbiddenClickText(text: string): boolean {
  if (text.trim() === '') return false;
  return FORBIDDEN_CLICK_TEXT.test(text);
}

/**
 * El unico camino permitido para hacer clic en este codebase.
 *
 * Lee el texto visible y el aria-label del elemento; si alguno delata una
 * accion de compra o de mutacion, tira `ForbiddenActionError` nombrando el
 * texto que se nego a tocar.
 *
 * @param label descripcion del clic para el mensaje de error. No participa en
 *   la decision: la decision se toma solo sobre lo que dice el DOM.
 */
export async function safeClick(locator: Locator, label?: string): Promise<void> {
  const innerText = await readSafely(() =>
    locator.innerText({ timeout: TEXT_READ_TIMEOUT_MS }),
  );
  const ariaLabel = await readSafely(() =>
    locator.getAttribute('aria-label', { timeout: TEXT_READ_TIMEOUT_MS }),
  );

  const combined = [innerText, ariaLabel].filter((s): s is string => !!s).join(' ');

  if (isForbiddenClickText(combined)) {
    const where = label ? ` (${label})` : '';
    throw new ForbiddenActionError(
      `Clic prohibido${where}: me negue a tocar un elemento cuyo texto es ` +
        `"${collapse(combined)}". safeClick nunca hace clic en controles de ` +
        'compra o de cambio de configuracion.',
    );
  }

  await locator.click({ timeout: CLICK_TIMEOUT_MS });
}

async function readSafely(read: () => Promise<string | null>): Promise<string | null> {
  try {
    return await read();
  } catch {
    // Elemento oculto, desprendido o inexistente. El click posterior fallara
    // con su propio error, que es mas informativo.
    return null;
  }
}

function collapse(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// 3. Guards de estado (regla 4: nunca seguir en un estado malo)
// ---------------------------------------------------------------------------

/**
 * Devuelve el primer selector de la lista con una coincidencia visible, o null.
 *
 * Lo usan los guards y el scraper: cada entrada de `selectors.ts` es una lista
 * de candidatos, y esto implementa el "prueba en orden".
 */
export async function findFirst(
  page: Page,
  selectors: readonly string[],
): Promise<Locator | null> {
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await locator.isVisible()) return locator;
    } catch {
      // Selector invalido o elemento desprendido: se prueba el siguiente.
    }
  }
  return null;
}

/**
 * Aborta si la sesion no esta claramente iniciada.
 *
 * Un estado ambiguo (ni indicador de dentro ni de fuera) tambien aborta: seguir
 * a ciegas produciria "sin ofertas" cuando en realidad no vimos nada.
 */
export async function assertLoggedIn(page: Page): Promise<void> {
  const loggedOut = await findFirst(page, LOGGED_OUT_INDICATOR);
  if (loggedOut !== null) {
    throw new SessionError(
      'La sesion de Rappi esta caida (se ve el boton de iniciar sesion). ' +
        'Corre `npm run login`, inicia sesion y confirma la direccion.',
    );
  }

  const loggedIn = await findFirst(page, LOGGED_IN_INDICATOR);
  if (loggedIn === null) {
    throw new SessionError(
      'No pude confirmar que la sesion este iniciada: no encontre ningun ' +
        `indicador de sesion (${LOGGED_IN_INDICATOR.join(', ')}) ni de logout. ` +
        'Estado ambiguo: aborto en vez de seguir. Corre `npm run login` para ' +
        'revisar la sesion y recalibrar los selectores.',
    );
  }
}

/**
 * Quita acentos, baja a minusculas y colapsa espacios.
 * "Chía,  Cundinamarca" -> "chía…" -> "chia, cundinamarca"
 */
export function normalizeAddress(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Aborta si la direccion de entrega activa no contiene la esperada.
 *
 * NUNCA intenta cambiarla (regla 2): solo lee y falla.
 *
 * Si el indicador no aparece se tira `SelectorError`, no `AddressError`: eso
 * significa que Rappi cambio su HTML, no que la direccion este mal.
 */
export async function assertAddressMatches(page: Page, expected: string): Promise<void> {
  const locator = await findFirst(page, ADDRESS_INDICATOR);
  if (locator === null) {
    throw new SelectorError(
      'No encontre el indicador de direccion en el header. Probe: ' +
        `${ADDRESS_INDICATOR.join(', ')}. Rappi cambio su HTML; hay que ` +
        'recalibrar ADDRESS_INDICATOR en src/selectors.ts (corre `npm run ' +
        'login` para volcar el DOM real a logs/).',
      ADDRESS_INDICATOR.join(', '),
    );
  }

  const shown = collapse((await locator.innerText().catch(() => '')) ?? '');
  if (shown === '') {
    throw new SelectorError(
      'Encontre el indicador de direccion pero esta vacio, asi que no puedo ' +
        `leer la direccion activa. Probe: ${ADDRESS_INDICATOR.join(', ')}.`,
      ADDRESS_INDICATOR.join(', '),
    );
  }

  if (!normalizeAddress(shown).includes(normalizeAddress(expected))) {
    throw new AddressError(
      `La direccion activa es "${shown}" y esperaba "${expected}". ` +
        'No la cambio: abro el navegador con `npm run login` y cambiala tu.',
    );
  }
}
