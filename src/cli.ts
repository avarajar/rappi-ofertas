#!/usr/bin/env node
/**
 * Orquestador. Dos comandos:
 *
 *   login  - abre el navegador visible, espera a que inicies sesion y pongas la
 *            direccion de Chia, verifica los guards y guarda la sesion.
 *   check  - el camino agendado por cron. Headless, revisa, avisa por Discord.
 *
 * Regla que manda sobre todo lo demas: un fallo NUNCA puede salir por Discord
 * pareciendo un reporte vacio normal. "Sin ofertas" solo se envia cuando el
 * scraping funciono y de verdad no habia nada >=50%.
 */

import { loadConfig, type Config } from './config.js';
import { ScrapeTimeoutError, SelectorError, toRappiError } from './errors.js';
import { launchSession, dumpDiagnostics } from './browser/session.js';
import { assertLoggedIn, assertAddressMatches, getBlockedRequestCount } from './browser/guards.js';
import { harvestRestaurants, gotoListing } from './scrape/restaurants.js';
import { parseDiscount } from './parse/discount.js';
import { parseScope } from './parse/scope.js';
import { formatReport, formatFailure } from './report/format.js';
import { sendToDiscord } from './notify/discord.js';
import { appendRun, buildRecord } from './log/runlog.js';
import { URLS } from './selectors.js';
import type { Page } from 'playwright';
import type { Offer } from './types.js';

type Session = Awaited<ReturnType<typeof launchSession>>;

const LOG_DIR = 'logs';
const MIN_PERCENT = 50;

interface Args {
  command: 'login' | 'check';
  dryRun: boolean;
  headful: boolean;
  verbose: boolean;
  help: boolean;
}

const USAGE = `
rappi-ofertas - avisa por Discord cuando hay restaurantes con >=50% de descuento.

Uso:
  node dist/cli.js login             Inicia sesion a mano y guarda el perfil.
  node dist/cli.js check [opciones]  Revisa y reporta. Este es el de cron.

Opciones:
  --dry-run    Imprime el mensaje en pantalla y no envia nada. No necesita webhook.
  --headful    Corre 'check' con el navegador visible, para depurar.
  --verbose    Log paso a paso.
  --help       Esto.

Salida: 0 si todo bien, 1 si algo fallo. Cron depende de eso.
`.trim();

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    command: 'check',
    dryRun: false,
    headful: false,
    verbose: false,
    help: false,
  };

  for (const token of argv) {
    switch (token) {
      case 'login':
      case 'check':
        args.command = token;
        break;
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--headful':
        args.headful = true;
        break;
      case '--verbose':
        args.verbose = true;
        break;
      case '--help':
      case '-h':
        args.help = true;
        break;
      default:
        throw new Error(`Opcion desconocida: ${token}`);
    }
  }

  return args;
}

function makeLogger(verbose: boolean): (message: string) => void {
  return (message: string) => {
    if (verbose) console.error(`[rappi] ${message}`);
  };
}

/** Cada cuanto se revisa si la sesion ya quedo lista, en ms. */
const LOGIN_POLL_MS = 3_000;
/** Cuanto se espera a que el usuario termine de iniciar sesion, en ms. */
const LOGIN_WAIT_MS = 5 * 60_000;
/**
 * Cuanto espera `check` a que la SPA hidrate, en ms.
 *
 * Medido en vivo: tras domcontentloaded el avatar de sesion tarda unos 4s en
 * aparecer. Verificar la sesion de inmediato es una carrera que se pierde, y se
 * perderia como SessionError en cada corrida de cron.
 */
const READY_WAIT_MS = 90_000;

/**
 * Espera a que la sesion quede REALMENTE lista: logueada y en la direccion
 * esperada.
 *
 * Antes esto esperaba un ENTER en la terminal, lo que tenia dos problemas:
 * presionarlo antes de tiempo hacia fallar la corrida, y obligaba a que
 * hubiera una persona frente al teclado. Consultar el estado real del DOM es
 * la condicion que de verdad importa, y ademas permite que el comando lo
 * dispare un agente o un script.
 */
async function waitForSessionReady(
  page: Page,
  expectedAddress: string,
  log: (msg: string) => void,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      await assertLoggedIn(page);
      await assertAddressMatches(page, expectedAddress);
      return;
    } catch (err) {
      log(`aun no listo: ${err instanceof Error ? err.message : String(err)}`);
      await page.waitForTimeout(LOGIN_POLL_MS);
    }
  }

  // Se acabo el tiempo: repetir las verificaciones sin atrapar el error, para
  // que el usuario vea el motivo exacto y no un timeout generico.
  await assertLoggedIn(page);
  await assertAddressMatches(page, expectedAddress);
}

/**
 * Corre `work` con un tope de tiempo duro.
 *
 * Sin esto una pagina colgada deja el proceso de cron vivo para siempre y las
 * corridas se van apilando.
 */
async function withTimeout<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const bell = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new ScrapeTimeoutError(`${what} paso de ${ms}ms sin terminar.`)),
      ms,
    );
  });

  try {
    return await Promise.race([work, bell]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Entrega un mensaje: a Discord, o a stdout en --dry-run.
 *
 * `config` puede ser null cuando el fallo ocurrio antes de poder cargarlo
 * (por ejemplo un ConfigError): ahi no hay a donde enviar y solo queda gritar.
 */
async function deliver(
  message: string,
  config: Config | null,
  dryRun: boolean,
): Promise<void> {
  if (dryRun || config === null || config.discordWebhookUrl === null) {
    console.log(message);
    return;
  }
  await sendToDiscord(config.discordWebhookUrl, message);
}

async function runLogin(args: Args): Promise<number> {
  const log = makeLogger(args.verbose);
  // Sin webhook: iniciar sesion no depende de que Discord ya este configurado.
  const config = loadConfig({ requireWebhook: false });

  const session = await launchSession({
    profileDir: config.browserProfileDir,
    headless: false,
  });

  try {
    log(`navegando a ${URLS.restaurants}`);
    await session.page.goto(URLS.restaurants, { waitUntil: 'domcontentloaded' });

    console.log('');
    console.log('=== Configuracion inicial de la sesion ===');
    console.log('');
    console.log('En la ventana de Chromium que se acaba de abrir:');
    console.log('  1. Inicia sesion en Rappi con tu cuenta.');
    console.log(`  2. Cambia la direccion de entrega a ${config.expectedAddress}.`);
    console.log('  3. Espera a que carguen los restaurantes.');
    console.log('');
    console.log('No cierres la ventana: se cierra sola al terminar.');
    console.log('');
    console.log('Esto detecta solo cuando la sesion quede lista. No hay que presionar nada.');
    console.log(`Tiempo de espera: ${Math.round(LOGIN_WAIT_MS / 60_000)} minutos.`);
    console.log('');

    await waitForSessionReady(session.page, config.expectedAddress, log, LOGIN_WAIT_MS);

    // El DOM real es lo unico que permite calibrar los selectores.
    await dumpDiagnostics(session.page, LOG_DIR);

    console.log('');
    console.log('Listo. Sesion iniciada y direccion correcta.');
    console.log(`El perfil quedo guardado en: ${config.browserProfileDir}`);
    console.log(`Se guardo el DOM real en ${LOG_DIR}/dom-*.html y una captura en ${LOG_DIR}/shot-*.png`);
    console.log('(sirven para calibrar src/selectors.ts si algo deja de leerse)');
    console.log('Ya puedes correr: npm run dry-run');
    return 0;
  } catch (err) {
    const error = toRappiError(err);
    console.error('');
    console.error(`No quedo lista la sesion [${error.code}]: ${error.message}`);
    if (error.selector) console.error(`Selector implicado: ${error.selector}`);
    console.error('Vuelve a correr `npm run login` e intenta de nuevo.');
    return 1;
  } finally {
    await session.close();
  }
}

async function runCheck(args: Args): Promise<number> {
  const log = makeLogger(args.verbose);
  const startedAt = Date.now();

  let config: Config | null = null;
  let cardsSeen = 0;
  let candidatesParsed = 0;
  let offers: Offer[] = [];
  // Caja mutable en vez de un `let`: la sesion se abre dentro de `scrape` y el
  // cierre vive en el `finally` de afuera, que es la unica garantia de que el
  // navegador no quede vivo si algo revienta a mitad de camino.
  const browser: { session: Session | null } = { session: null };

  try {
    // En --dry-run el webhook sobra: se puede probar todo antes de crearlo.
    config = loadConfig({ requireWebhook: !args.dryRun });

    const scrape = async (): Promise<void> => {
      log('abriendo navegador');
      const session = await launchSession({
        profileDir: config!.browserProfileDir,
        headless: !args.headful,
      });
      browser.session = session;
      const page = session.page;

      log(`navegando a ${URLS.restaurants}`);
      // Una sola navegacion: `gotoListing` ya navega y reintenta. Hacer un goto
      // extra aqui encadenaba dos cargas casi simultaneas de la misma URL, y
      // eso es justo lo que hace que Rappi devuelva su pagina SEO sin
      // tarjetas en vez del listado personalizado.
      log('verificando sesion y direccion');
      // Rappi sirve dos variantes de /restaurantes y solo una trae tarjetas,
      // asi que la navegacion con reintentos vive en gotoListing. La sesion se
      // verifica DESPUES, ya sobre la variante buena: en la pagina SEO no hay
      // ni estado de app ni avatar, y verificar ahi daria un SessionError
      // falso.
      await gotoListing(page, Date.now() + READY_WAIT_MS, log);
      await waitForSessionReady(page, config!.expectedAddress, log, READY_WAIT_MS);

      log('recolectando tarjetas');
      const cards = await harvestRestaurants(page, {
        maxScrollSteps: config!.maxScrollSteps,
        timeoutMs: config!.scrapeTimeoutMs,
        log,
      });
      cardsSeen = cards.length;
      log(`tarjetas vistas: ${cardsSeen}`);

      // Cero tarjetas donde deberia haber decenas = Rappi cambio su HTML.
      // Esto JAMAS puede salir como "sin ofertas".
      if (cardsSeen === 0) {
        throw new SelectorError(
          'No se leyo ninguna tarjeta de restaurante. Rappi probablemente cambio su HTML.',
        );
      }

      const found: Offer[] = [];
      for (const card of cards) {
        const discount = parseDiscount(`${card.badgeText} ${card.subtitleText}`);
        // Ilegible se omite, nunca se adivina.
        if (discount === null) continue;
        candidatesParsed += 1;
        if (discount.percent < MIN_PERCENT) continue;

        const { scope, deadline } = parseScope(`${card.subtitleText} ${card.badgeText}`);
        found.push({
          name: card.name,
          discount,
          scope,
          deadline,
          href: card.href,
        });
      }

      found.sort((a, b) => b.discount.percent - a.discount.percent);
      offers = found;
      log(`descuentos legibles: ${candidatesParsed}, ofertas >=${MIN_PERCENT}%: ${offers.length}`);
      log(`peticiones bloqueadas por el guard: ${getBlockedRequestCount()}`);
    };

    await withTimeout(scrape(), config.scrapeTimeoutMs, 'La revision');

    const message = formatReport(offers);
    await deliver(message, config, args.dryRun);

    appendRun(
      buildRecord({
        durationMs: Date.now() - startedAt,
        dryRun: args.dryRun,
        cardsSeen,
        candidatesParsed,
        offersMatched: offers.length,
      }),
      LOG_DIR,
    );

    return 0;
  } catch (err) {
    const error = toRappiError(err);
    console.error(`[${error.code}] ${error.message}`);
    if (error.selector) console.error(`Selector implicado: ${error.selector}`);

    // El aviso de fallo es obligatorio: el canal en silencio debe significar
    // "el job murio", no "no hubo ofertas".
    try {
      await deliver(formatFailure(error.code, error.message), config, args.dryRun);
    } catch (notifyErr) {
      const detail = notifyErr instanceof Error ? notifyErr.message : String(notifyErr);
      console.error('');
      console.error('!!! Ademas fallo el aviso del fallo. Nadie fue notificado.');
      console.error(`!!! Motivo: ${detail}`);
      console.error('!!! Revisa DISCORD_WEBHOOK_URL y logs/runs.jsonl.');
    }

    appendRun(
      buildRecord({
        durationMs: Date.now() - startedAt,
        dryRun: args.dryRun,
        cardsSeen,
        candidatesParsed,
        offersMatched: offers.length,
        error,
      }),
      LOG_DIR,
    );

    return 1;
  } finally {
    // Cerrar el navegador es limpieza: no puede cambiar el exit code.
    await browser.session?.close().catch(() => {});
  }
}

async function main(): Promise<number> {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error('');
    console.error(USAGE);
    return 1;
  }

  if (args.help) {
    console.log(USAGE);
    return 0;
  }

  return args.command === 'login' ? runLogin(args) : runCheck(args);
}

main()
  .then((code) => {
    process.exitCode = code;
    // Playwright a veces deja handles vivos; el exit explicito evita que cron
    // se quede esperando un proceso que ya termino su trabajo.
    process.exit(code);
  })
  .catch((err: unknown) => {
    console.error('Fallo no controlado:', err instanceof Error ? err.stack : String(err));
    process.exit(1);
  });
