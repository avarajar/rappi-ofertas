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
  STATIC_ASSET_PATTERN,
  NEXT_DATA_ID,
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
  const isSafeMethod = (SAFE_METHODS as readonly string[]).includes(method.toUpperCase());

  // Leer un archivo estatico nunca muta nada, aunque su ruta diga "checkout".
  // Next.js mete el nombre de la pagina en la URL del chunk, asi que sin esta
  // excepcion tumbamos bundles legitimos y con ellos el render de la SPA.
  if (isSafeMethod && STATIC_ASSET_PATTERN.test(url)) return false;

  if (BLOCKED_URL_PATTERNS.some((pattern) => pattern.test(url))) return true;
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


/** Lo que nos interesa del estado que publica la app. */
interface AppState {
  isLoggedIn: boolean | null;
  city: string | null;
}

/**
 * Lee el estado que Rappi publica en su <script> de Next.js.
 *
 * Es la fuente primaria para sesion y ciudad: son datos de la propia app, no
 * clases CSS hasheadas que cambian con cada despliegue. Devuelve null si el
 * script no esta o no se puede parsear, y ahi el llamador cae al DOM.
 */
export async function readAppState(page: Page): Promise<AppState | null> {
  try {
    return await page.evaluate((id: string) => {
      // Next.js deja el objeto como global ademas del <script>. El global
      // sobrevive a la hidratacion, mientras que el tag a veces no esta
      // presente cuando se consulta; probar los dos evita esa carrera.
      const fromGlobal = (window as unknown as Record<string, any>).__NEXT_DATA__;
      let data: Record<string, any> | null =
        fromGlobal !== null && typeof fromGlobal === 'object' ? fromGlobal : null;

      if (data === null) {
        const el = document.getElementById(id);
        if (el === null || el.textContent === null) return null;
        data = JSON.parse(el.textContent) as Record<string, any>;
      }

      const props = data?.props?.pageProps ?? {};
      const flag = props?.commonData?.isLoggedIn ?? props?.isAuthUser ?? null;

      return {
        isLoggedIn: typeof flag === 'boolean' ? flag : null,
        city: typeof props?.location?.city === 'string' ? props.location.city : null,
      };
    }, NEXT_DATA_ID);
  } catch {
    return null;
  }
}

/**
 * Aborta si la sesion no esta claramente iniciada.
 *
 * Un estado ambiguo (ni indicador de dentro ni de fuera) tambien aborta: seguir
 * a ciegas produciria "sin ofertas" cuando en realidad no vimos nada.
 */
export async function assertLoggedIn(page: Page): Promise<void> {
  // Fuente primaria: el estado que publica la propia app.
  const state = await readAppState(page);
  if (state?.isLoggedIn === true) return;
  if (state?.isLoggedIn === false) {
    throw new SessionError(
      'Rappi reporta la sesion como cerrada (isLoggedIn=false). ' +
        'Corre `npm run login`, inicia sesion y confirma la direccion.',
    );
  }

  // Respaldo por DOM cuando el estado no se pudo leer.
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
  // Fuente primaria: la ciudad que declara la app.
  //
  // El header muestra SOLO la calle ("Cl. 00 #0-00"), sin ciudad, asi que
  // compararlo contra "Chia" daria AddressError con la direccion correcta.
  // location.city si trae la ciudad como dato.
  const state = await readAppState(page);
  if (state?.city !== null && state?.city !== undefined) {
    if (normalizeAddress(state.city).includes(normalizeAddress(expected))) return;
    throw new AddressError(
      `La ciudad activa en Rappi es "${state.city}" y esperaba "${expected}". ` +
        'No la cambio: abre el navegador con `npm run login` y cambiala tu.',
    );
  }

  // Sin estado de app no hay forma confiable de leer la ciudad: el header solo
  // muestra la calle. Antes de rendirse conviene decir por que, porque la causa
  // mas comun no es que Rappi cambiara su HTML sino que devolvio su pagina SEO,
  // que no trae ni estado ni direccion.
  const locator = await findFirst(page, ADDRESS_INDICATOR);
  if (locator === null) {
    throw new SelectorError(
      'No pude leer la ciudad activa: Rappi no expuso su estado ' +
        '(__NEXT_DATA__) y tampoco encontre la direccion en el header. ' +
        'Lo mas probable es que haya devuelto su pagina SEO sin listado en vez ' +
        'del listado personalizado; si se repite en todas las corridas, ' +
        'entonces si cambio el HTML y hay que recalibrar src/selectors.ts. ' +
        `Probe: ${ADDRESS_INDICATOR.join(', ')}.`,
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
