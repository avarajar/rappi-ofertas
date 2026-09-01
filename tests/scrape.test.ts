/**
 * Pruebas de extraccion de DOM contra fixtures guardados.
 *
 * Sin red y sin sesion: `page.setContent()` sobre HTML del repo, asi que son
 * deterministas y corren en CI. Los fixtures documentan el markup esperado, y
 * cuando Rappi lo cambie el test que falle senala el selector roto.
 */

import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';

import { SelectorError } from '../src/errors.js';
import {
  dedupeByName,
  extractCardsFromPage,
  harvestRestaurants,
} from '../src/scrape/restaurants.js';
import type { RawCard } from '../src/types.js';

const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');

// Chromium puede no estar instalado todavia (postinstall). En ese caso se
// omiten las pruebas de navegador en vez de tumbar la suite entera.
let browser: Browser | null = null;
try {
  browser = await chromium.launch();
} catch {
  browser = null;
}

const withBrowser = browser === null ? describe.skip : describe;

afterAll(async () => {
  await browser?.close();
});

async function pageWith(html: string): Promise<Page> {
  const page = await browser!.newPage();
  await page.setContent(html);
  return page;
}

const byName = (cards: RawCard[], name: string): RawCard => {
  const found = cards.find((card) => card.name === name);
  if (found === undefined) {
    throw new Error(`No se extrajo la tarjeta "${name}". Extraidas: ${cards.map((c) => c.name).join(' | ')}`);
  }
  return found;
};

withBrowser('extractCardsFromPage — listado principal (data-qa)', () => {
  it('extrae las 8 tarjetas del fixture, ninguna de mas ni de menos', async () => {
    const page = await pageWith(fixture('listing-sample.html'));
    const cards = await extractCardsFromPage(page, 'listing');
    await page.close();

    expect(cards).toHaveLength(8);
    expect(cards.map((c) => c.name)).toEqual([
      'Burger Master',
      'Sushi Nikkei',
      'Pizza Roma',
      'Taco Loco',
      'Arepas del Valle',
      'Panadería Central',
      'El Corral Gourmet',
      'Wok Express',
    ]);
    expect(cards.every((c) => c.source === 'listing')).toBe(true);
  });

  it('captura el badge literal, sin normalizar ni traducir', async () => {
    const page = await pageWith(fixture('listing-sample.html'));
    const cards = await extractCardsFromPage(page, 'listing');
    await page.close();

    // El parser depende de estos strings exactos: cualquier "limpieza" aqui
    // seria inventar texto que la pantalla no mostro.
    expect(byName(cards, 'Burger Master').badgeText).toBe('50% OFF');
    expect(byName(cards, 'Sushi Nikkei').badgeText).toBe('hasta 60%');
    expect(byName(cards, 'Pizza Roma').badgeText).toBe('2x1');
    expect(byName(cards, 'El Corral Gourmet').badgeText).toBe('70% OFF');
  });

  it('conserva el 15% OFF, que se descarta despues en el parser y no aqui', async () => {
    const page = await pageWith(fixture('listing-sample.html'));
    const cards = await extractCardsFromPage(page, 'listing');
    await page.close();

    expect(byName(cards, 'Taco Loco').badgeText).toBe('15% OFF');
    expect(byName(cards, 'Arepas del Valle').badgeText).toBe('Envío gratis');
  });

  it('concatena los dos badges de una misma tarjeta en orden DOM', async () => {
    const page = await pageWith(fixture('listing-sample.html'));
    const cards = await extractCardsFromPage(page, 'listing');
    await page.close();

    expect(byName(cards, 'Wok Express').badgeText).toBe('50% OFF Envío gratis');
  });

  it('deja badgeText vacio en la tarjeta sin badge, en vez de descartarla', async () => {
    const page = await pageWith(fixture('listing-sample.html'));
    const cards = await extractCardsFromPage(page, 'listing');
    await page.close();

    const card = byName(cards, 'Panadería Central');
    expect(card.badgeText).toBe('');
    expect(card.subtitleText).toBe('Panadería · 15-25 min');
  });

  it('colapsa los espacios de un nombre repartido en nodos anidados', async () => {
    const page = await pageWith(fixture('listing-sample.html'));
    const cards = await extractCardsFromPage(page, 'listing');
    await page.close();

    const names = cards.map((c) => c.name);
    expect(names).toContain('El Corral Gourmet');
    expect(names.every((n) => n === n.trim() && !/\s{2,}/.test(n))).toBe(true);
  });

  it('lee el href de la tarjeta misma y el del enlace anidado', async () => {
    const page = await pageWith(fixture('listing-sample.html'));
    const cards = await extractCardsFromPage(page, 'listing');
    await page.close();

    expect(byName(cards, 'Burger Master').href).toBe(
      'https://www.rappi.com.co/restaurantes/900101-burger-master',
    );
    // Esta tarjeta es un <div>; el href sale del primer <a> interno.
    expect(byName(cards, 'Sushi Nikkei').href).toBe(
      'https://www.rappi.com.co/restaurantes/900102-sushi-nikkei',
    );
  });

  it('lee el subtitulo, que es de donde sale el alcance de la promo', async () => {
    const page = await pageWith(fixture('listing-sample.html'));
    const cards = await extractCardsFromPage(page, 'listing');
    await page.close();

    expect(byName(cards, 'Burger Master').subtitleText).toContain('en todo el menú');
    expect(byName(cards, 'Sushi Nikkei').subtitleText).toContain('productos seleccionados');
    expect(byName(cards, 'Pizza Roma').subtitleText).toContain('primer pedido');
  });
});

withBrowser('extractCardsFromPage — seccion de ofertas (data-testid)', () => {
  it('cae al segundo candidato de cada lista y extrae las 5 tarjetas', async () => {
    const html = fixture('offers-sample.html');
    // El markup no tiene NINGUN data-qa (los comentarios no cuentan): si aun
    // asi extrae tarjetas, fue por el segundo candidato de cada lista.
    expect(html.replace(/<!--[\s\S]*?-->/g, '')).not.toContain('data-qa');

    const page = await pageWith(html);
    const cards = await extractCardsFromPage(page, 'ofertas');
    await page.close();

    expect(cards).toHaveLength(5);
    expect(cards.map((c) => c.name)).toEqual([
      'Frisby Express',
      'Crepes & Waffles',
      'Sánduches Olímpica',
      'Juan Valdez',
      'Hamburguesas El Rodeo',
    ]);
    expect(cards.every((c) => c.source === 'ofertas')).toBe(true);
  });

  it('captura badges y subtitulos con el markup alterno', async () => {
    const page = await pageWith(fixture('offers-sample.html'));
    const cards = await extractCardsFromPage(page, 'ofertas');
    await page.close();

    expect(byName(cards, 'Frisby Express').badgeText).toBe('hasta 60%');
    expect(byName(cards, 'Crepes & Waffles').badgeText).toBe('50% OFF');
    expect(byName(cards, 'Sánduches Olímpica').badgeText).toBe('2x1');
    expect(byName(cards, 'Juan Valdez').badgeText).toBe('');
    expect(byName(cards, 'Hamburguesas El Rodeo').badgeText).toBe('55% OFF Envío gratis');

    // El subtitulo aqui llega por [class*="subtitle"], no por data-qa.
    expect(byName(cards, 'Frisby Express').subtitleText).toContain('productos seleccionados');
  });

  it('siempre devuelve un href no nulo, sea absoluto o relativo', async () => {
    const page = await pageWith(fixture('offers-sample.html'));
    const cards = await extractCardsFromPage(page, 'ofertas');
    await page.close();

    expect(byName(cards, 'Frisby Express').href).toBe(
      'https://www.rappi.com.co/restaurantes/910201-frisby-express',
    );
    const relative = byName(cards, 'Sánduches Olímpica').href;
    expect(relative).not.toBeNull();
    expect(relative).toContain('910203-sanduches-olimpica');
  });
});

withBrowser('pagina sin tarjetas', () => {
  it('extrae cero tarjetas de un documento vacio', async () => {
    const page = await pageWith('<div></div>');
    const cards = await extractCardsFromPage(page, 'listing');
    await page.close();

    expect(cards).toEqual([]);
  });

  it('descarta tarjetas sin nombre legible en vez de inventarlo', async () => {
    const page = await pageWith(
      '<div data-qa="store-card"><span data-qa="discount-badge">50% OFF</span></div>',
    );
    const cards = await extractCardsFromPage(page, 'listing');
    await page.close();

    expect(cards).toEqual([]);
  });

  it('harvestRestaurants lanza SelectorError, nunca "sin ofertas"', async () => {
    const page = await pageWith('<div></div>');
    // Se anula la navegacion: el DOM vacio se queda puesto y no se toca la red.
    (page as unknown as { goto: () => Promise<null> }).goto = async () => null;

    const promise = harvestRestaurants(page, {
      maxScrollSteps: 2,
      timeoutMs: 1_000,
      listingUrl: 'https://www.rappi.com.co/restaurantes',
    });
    await expect(promise).rejects.toBeInstanceOf(SelectorError);
    await expect(promise).rejects.toMatchObject({ code: 'SELECTOR' });
    // El mensaje debe nombrar los selectores probados, que es lo que hace
    // accionable el diagnostico cuando Rappi cambia su HTML.
    await expect(promise).rejects.toThrow(/store-card/);

    await page.close();
  });
});

describe('dedupeByName', () => {
  const card = (over: Partial<RawCard>): RawCard => ({
    name: 'X',
    badgeText: '',
    subtitleText: '',
    href: null,
    source: 'listing',
    ...over,
  });

  it('se queda con el registro mas rico ante el mismo nombre', () => {
    const result = dedupeByName([
      card({ name: 'Burger Master', badgeText: '50% OFF' }),
      card({
        name: 'burger  master',
        badgeText: '50% OFF',
        subtitleText: 'en todo el menú',
        source: 'ofertas',
      }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.subtitleText).toBe('en todo el menú');
    expect(result[0]?.source).toBe('ofertas');
  });

  it('trata nombres con y sin tilde como el mismo restaurante', () => {
    const result = dedupeByName([
      card({ name: 'Panadería Central' }),
      card({ name: 'Panaderia Central', badgeText: '50% OFF' }),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.badgeText).toBe('50% OFF');
  });

  it('no colapsa restaurantes distintos', () => {
    const result = dedupeByName([card({ name: 'A' }), card({ name: 'B' })]);
    expect(result).toHaveLength(2);
  });
});
