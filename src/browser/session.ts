/**
 * Arranque del navegador.
 *
 * Se usa SIEMPRE un `user-data-dir` dedicado (`.browser-profile/`), nunca el
 * Chrome diario del usuario: la sesion de Rappi vive ahi y nada mas vive ahi.
 *
 * El guard de solo-lectura se instala antes de devolver la sesion, de modo que
 * es imposible navegar sin el.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { installReadOnlyGuard } from './guards.js';

export interface BrowserSession {
  context: BrowserContext;
  page: Page;
  /** Idempotente: llamarlo dos veces no revienta. */
  close(): Promise<void>;
}

export interface LaunchOptions {
  /** Directorio del perfil persistente. Nunca el perfil real de Chrome. */
  profileDir: string;
  headless: boolean;
}

/** Escritorio corriente. Un viewport raro es una senal de automatizacion. */
const VIEWPORT = { width: 1440, height: 900 } as const;

export async function launchSession(opts: LaunchOptions): Promise<BrowserSession> {
  const context = await chromium.launchPersistentContext(opts.profileDir, {
    headless: opts.headless,
    viewport: { ...VIEWPORT },
    locale: 'es-CO',
    timezoneId: 'America/Bogota',
    // Sin User-Agent personalizado a proposito: el UA por defecto de Chromium
    // es coherente con el resto del fingerprint; inventar uno delata mas.
    args: ['--disable-blink-features=AutomationControlled'],
  });

  // ORDEN CRITICO: el guard va antes de que exista cualquier oportunidad de
  // navegar. Si esto se mueve mas abajo, la primera peticion sale sin filtro.
  await installReadOnlyGuard(context);

  // El contexto persistente suele abrir ya una pestana; reusarla evita dejar
  // un about:blank huerfano.
  const page = context.pages()[0] ?? (await context.newPage());

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    try {
      await context.close();
    } catch {
      // Ya estaba cerrado o el proceso murio. Cerrar es best-effort.
    }
  };

  return { context, page, close };
}

/**
 * Vuelca el DOM y una captura a `dir`.
 *
 * Lo usa `login` para que los selectores se puedan calibrar despues contra el
 * HTML real y autenticado, que es la unica pieza que no se puede escribir a
 * ciegas. Nunca tira: un diagnostico fallido no puede tumbar la corrida.
 */
export async function dumpDiagnostics(page: Page, dir: string): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  try {
    await mkdir(dir, { recursive: true });

    const html = await page.content();
    const htmlPath = join(dir, `dom-${stamp}.html`);
    await writeFile(htmlPath, html, 'utf8');

    const shotPath = join(dir, `shot-${stamp}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });

    console.log(`[diag] DOM en ${htmlPath}`);
    console.log(`[diag] captura en ${shotPath}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[diag] no pude volcar el diagnostico en ${dir}: ${message}`);
  }
}
