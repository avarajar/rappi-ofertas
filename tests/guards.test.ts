/**
 * Tests de la capa de seguridad.
 *
 * Los dos primeros bloques son puros (sin navegador) y son los que cubren la
 * logica riesgosa. Los dos ultimos levantan Chromium de verdad, pero sin salir
 * a internet: el unico servidor que se toca es un `http.Server` local efimero.
 */

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { ForbiddenActionError } from '../src/errors.js';
import {
  getBlockedRequestCount,
  installReadOnlyGuard,
  isForbiddenClickText,
  normalizeAddress,
  safeClick,
  shouldAbort,
} from '../src/browser/guards.js';

// ---------------------------------------------------------------------------
// Puro: deny-list de texto
// ---------------------------------------------------------------------------

describe('isForbiddenClickText', () => {
  const forbidden = [
    'Agregar al carrito',
    'Añadir',
    'Pedir ahora',
    'Comprar',
    'Ir a pagar',
    'Cambiar dirección',
  ];

  it.each(forbidden)('se niega a "%s"', (text) => {
    expect(isForbiddenClickText(text)).toBe(true);
  });

  const allowed = ['Ver más', 'Ofertas', 'Restaurantes', 'Cerrar'];

  it.each(allowed)('permite "%s"', (text) => {
    expect(isForbiddenClickText(text)).toBe(false);
  });

  it('ignora mayusculas y espacios sobrantes', () => {
    expect(isForbiddenClickText('  AGREGAR AL CARRITO  ')).toBe(true);
  });

  it('atrapa el texto tambien cuando viene del aria-label concatenado', () => {
    // safeClick concatena innerText + aria-label; basta con que uno delate.
    expect(isForbiddenClickText('  Añadir producto')).toBe(true);
  });

  it('no se dispara con texto vacio', () => {
    expect(isForbiddenClickText('')).toBe(false);
    expect(isForbiddenClickText('   ')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Puro: normalizacion de direccion
// ---------------------------------------------------------------------------

describe('normalizeAddress', () => {
  it('quita acentos', () => {
    expect(normalizeAddress('Chía, Cundinamarca')).toContain('chia');
  });

  it('baja mayusculas', () => {
    expect(normalizeAddress('CHÍA')).toBe('chia');
  });

  it('colapsa espacios y recorta', () => {
    expect(normalizeAddress('  Chía   ,   Cundinamarca  ')).toBe('chia , cundinamarca');
  });

  it('la comparacion real (esperado contenido en lo mostrado) funciona', () => {
    const shown = normalizeAddress('Calle 5 #10-20,  CHÍA, Cundinamarca');
    expect(shown.includes(normalizeAddress('Chia'))).toBe(true);
    expect(shown.includes(normalizeAddress('Bogotá'))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Puro: deny-list de URLs. Dos listas con reglas distintas, ver shouldAbort.
// ---------------------------------------------------------------------------

describe('shouldAbort y los archivos estaticos', () => {
  // Caso real visto contra Rappi: Next.js sirve el chunk de la pagina de
  // checkout con "checkout" dentro de la URL. Bloquearlo no evita ninguna
  // compra y sí puede romper el render de la SPA.
  it('deja pasar un bundle de Next cuya ruta contiene checkout', () => {
    const url =
      'https://www.rappi.com.co/static-checkout/_next/static/chunks/pages/checkout/[storeType]-0e8ee12784c6dc6b.js';
    expect(shouldAbort(url, 'GET')).toBe(false);
  });

  it('deja pasar css, fuentes e imagenes con rutas sospechosas', () => {
    expect(shouldAbort('https://x.com/cart/styles.css', 'GET')).toBe(false);
    expect(shouldAbort('https://x.com/account/logo.svg', 'GET')).toBe(false);
    expect(shouldAbort('https://x.com/checkout/font.woff2', 'GET')).toBe(false);
  });

  it('la excepcion NO aplica a metodos de escritura', () => {
    const url = 'https://x.com/cart/whatever.js';
    expect(shouldAbort(url, 'POST')).toBe(true);
  });

  it('sigue bloqueando el API y la pagina de compra', () => {
    expect(shouldAbort('https://x.com/api/cart/add', 'POST')).toBe(true);
    expect(shouldAbort('https://x.com/api/cart', 'GET')).toBe(true);
    expect(shouldAbort('https://x.com/checkout', 'GET')).toBe(true);
    expect(shouldAbort('https://x.com/api/address/update', 'PUT')).toBe(true);
  });
});

describe('shouldAbort', () => {
  describe('rutas de compra: se abortan con cualquier metodo', () => {
    it.each([
      ['GET', 'https://www.rappi.com.co/api/cart'],
      ['POST', 'https://www.rappi.com.co/api/cart/add'],
      ['GET', 'https://www.rappi.com.co/checkout'],
      ['POST', 'https://www.rappi.com.co/api/orders'],
      ['GET', 'https://www.rappi.com.co/api/payment/methods'],
    ])('aborta %s %s', (method, url) => {
      expect(shouldAbort(url, method)).toBe(true);
    });
  });

  describe('rutas de solo lectura: leer si, escribir no', () => {
    // El caso que motivo la division: el header pinta la direccion activa con
    // un GET. Abortarlo dejaria el header vacio y assertAddressMatches fallaria
    // en cada corrida, o sea el guard rompiendo su propio chequeo.
    it.each([
      'https://www.rappi.com.co/api/address/current',
      'https://www.rappi.com.co/api/account/me',
      'https://www.rappi.com.co/api/settings',
      'https://www.rappi.com.co/api/profile',
      'https://www.rappi.com.co/api/user/preferences',
    ])('permite GET %s', (url) => {
      expect(shouldAbort(url, 'GET')).toBe(false);
    });

    it.each([
      ['POST', 'https://www.rappi.com.co/api/address/update'],
      ['PUT', 'https://www.rappi.com.co/api/address/update'],
      ['PATCH', 'https://www.rappi.com.co/api/address/1'],
      ['DELETE', 'https://www.rappi.com.co/api/address/1'],
      ['POST', 'https://www.rappi.com.co/api/account/update'],
      ['PUT', 'https://www.rappi.com.co/api/settings'],
    ])('aborta %s %s', (method, url) => {
      expect(shouldAbort(url, method)).toBe(true);
    });

    it('HEAD y OPTIONS tambien son lecturas', () => {
      expect(shouldAbort('https://www.rappi.com.co/api/address/current', 'HEAD')).toBe(false);
      expect(shouldAbort('https://www.rappi.com.co/api/address/current', 'OPTIONS')).toBe(false);
    });

    it('fail-closed: un metodo desconocido cuenta como escritura', () => {
      expect(shouldAbort('https://www.rappi.com.co/api/address/current', 'TRACE')).toBe(true);
    });

    it('no le importa el case del metodo', () => {
      expect(shouldAbort('https://www.rappi.com.co/api/address/update', 'post')).toBe(true);
      expect(shouldAbort('https://www.rappi.com.co/api/address/current', 'get')).toBe(false);
    });
  });

  describe('trafico normal: pasa', () => {
    it.each([
      ['GET', 'https://www.rappi.com.co/restaurantes'],
      // Rappi carga catalogo por POST/GraphQL. Bloquear POST en bloque romperia
      // la pagina; por eso solo manda la deny-list de URLs.
      ['POST', 'https://www.rappi.com.co/api/graphql'],
      ['POST', 'https://www.rappi.com.co/api/restaurantes/listing'],
      ['GET', 'https://images.rappi.com.co/logo.png'],
    ])('deja pasar %s %s', (method, url) => {
      expect(shouldAbort(url, method)).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Con navegador. Se salta con gracia si Chromium no esta descargado todavia.
// ---------------------------------------------------------------------------

function chromiumIsAvailable(): boolean {
  try {
    return typeof chromium.executablePath() === 'string';
  } catch {
    return false;
  }
}

const describeBrowser = chromiumIsAvailable() ? describe : describe.skip;

describeBrowser('safeClick (navegador real)', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch();
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('tira ForbiddenActionError ante un boton de agregar al carrito', async () => {
    const page = await browser.newPage();
    await page.setContent('<button id="buy">Agregar al carrito</button>');

    await expect(safeClick(page.locator('#buy'), 'boton falso')).rejects.toThrow(
      ForbiddenActionError,
    );
    // El mensaje debe nombrar el texto que se nego a tocar.
    await expect(safeClick(page.locator('#buy'))).rejects.toThrow(/Agregar al carrito/);

    await page.close();
  });

  it('tambien lo atrapa cuando la trampa esta en el aria-label', async () => {
    const page = await browser.newPage();
    await page.setContent('<button id="b" aria-label="Ir a pagar">Continuar</button>');

    await expect(safeClick(page.locator('#b'))).rejects.toThrow(ForbiddenActionError);

    await page.close();
  });

  it('hace clic normal en un control seguro', async () => {
    const page = await browser.newPage();
    await page.setContent(
      '<button id="ok" onclick="window.__clicked = true">Ver más</button>',
    );

    await safeClick(page.locator('#ok'), 'ver mas');

    expect(await page.evaluate(() => (window as any).__clicked)).toBe(true);
    await page.close();
  });
});

describeBrowser('installReadOnlyGuard (navegador real, servidor local)', () => {
  let browser: Browser;
  let server: Server;
  let base: string;
  /** Rutas que alcanzaron el servidor. Lo bloqueado nunca debe aparecer aqui. */
  const hits: string[] = [];

  beforeAll(async () => {
    browser = await chromium.launch();

    server = createServer((req, res) => {
      hits.push(req.url ?? '');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'access-control-allow-origin': '*',
      });
      res.end('<!doctype html><title>fake rappi</title><body>ok</body>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await browser?.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('aplica la deny-list de verdad sobre el trafico del navegador', async () => {
    const context = await browser.newContext();
    await installReadOnlyGuard(context);
    const page = await context.newPage();
    await page.goto(`${base}/restaurantes`);

    /** Dispara un fetch desde la pagina y dice si resolvio o lo abortaron. */
    const tryFetch = (path: string, method: string): Promise<string> =>
      page.evaluate(
        ([url, verb]) =>
          fetch(url as string, { method: verb as string })
            .then((r) => `ok:${r.status}`)
            .catch(() => 'fail'),
        [`${base}${path}`, method],
      );

    let expectedBlocks = getBlockedRequestCount();

    // Compra: abortado con cualquier metodo.
    expect(await tryFetch('/api/cart/add', 'POST')).toBe('fail');
    expect(getBlockedRequestCount()).toBe((expectedBlocks += 1));
    expect(await tryFetch('/api/cart', 'GET')).toBe('fail');
    expect(getBlockedRequestCount()).toBe((expectedBlocks += 1));

    // Direccion y cuenta: el GET tiene que pasar, si no el guard romperia el
    // chequeo de direccion. El POST/PUT no.
    expect(await tryFetch('/api/address/current', 'GET')).toBe('ok:200');
    expect(await tryFetch('/api/account/me', 'GET')).toBe('ok:200');
    expect(getBlockedRequestCount()).toBe(expectedBlocks);

    expect(await tryFetch('/api/address/update', 'POST')).toBe('fail');
    expect(getBlockedRequestCount()).toBe((expectedBlocks += 1));
    expect(await tryFetch('/api/account/update', 'PUT')).toBe('fail');
    expect(getBlockedRequestCount()).toBe((expectedBlocks += 1));

    // Contenido normal por POST: pasa.
    expect(await tryFetch('/api/restaurantes/listing', 'POST')).toBe('ok:200');
    expect(getBlockedRequestCount()).toBe(expectedBlocks);

    // Nada de lo abortado toco el servidor.
    expect(hits).toEqual(
      expect.arrayContaining([
        '/restaurantes',
        '/api/address/current',
        '/api/account/me',
        '/api/restaurantes/listing',
      ]),
    );
    for (const blocked of ['/api/cart/add', '/api/cart', '/api/address/update', '/api/account/update']) {
      expect(hits).not.toContain(blocked);
    }

    await context.close();
  });
});
