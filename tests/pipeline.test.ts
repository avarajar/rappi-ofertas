/**
 * Test de integracion del pipeline completo.
 *
 * Los modulos de este proyecto se escribieron en paralelo y a ciegas unos de
 * otros. Los tests unitarios prueban cada pieza por separado; este prueba que
 * COMPONEN: DOM real (fixture) -> extraccion -> parseo -> filtro -> orden ->
 * mensaje final. Es la unica prueba que atrapa un desacople de contratos.
 *
 * Sin red: usa page.setContent sobre los fixtures.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import { extractCardsFromPage, dedupeByName } from '../src/scrape/restaurants.js';
import { parseDiscount } from '../src/parse/discount.js';
import { parseScope } from '../src/parse/scope.js';
import { formatReport, EMPTY_REPORT } from '../src/report/format.js';
import type { Offer, RawCard } from '../src/types.js';

const MIN_PERCENT = 50;
/** La ciudad ya no esta fija en el formateador: se le pasa. */
const CITY = 'Chía';

/** Replica exactamente la cadena de cli.ts sobre un set de tarjetas. */
function buildOffers(cards: RawCard[]): Offer[] {
  const found: Offer[] = [];
  for (const card of cards) {
    const discount = parseDiscount(`${card.badgeText} ${card.subtitleText}`);
    if (discount === null) continue;
    if (discount.percent < MIN_PERCENT) continue;
    const { scope, deadline } = parseScope(`${card.subtitleText} ${card.badgeText}`);
    found.push({ name: card.name, discount, scope, deadline, href: card.href });
  }
  found.sort((a, b) => b.discount.percent - a.discount.percent);
  return found;
}

let browser: Browser | undefined;
try {
  chromium.executablePath();
} catch {
  browser = undefined;
}

describe('pipeline completo sobre fixtures', () => {
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch();
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  });

  async function load(fixture: string) {
    const html = readFileSync(resolve(process.cwd(), 'fixtures', fixture), 'utf8');
    await page.setContent(html);
    return extractCardsFromPage(page, 'listing');
  }

  it('produce un mensaje coherente desde el listado principal', async () => {
    const cards = await load('listing-sample.html');
    const offers = buildOffers(dedupeByName(cards));
    const message = formatReport(offers, CITY);

    console.log('\n--- MENSAJE GENERADO (listing) ---\n' + message + '\n---\n');

    // Ordenado de mayor a menor.
    const percents = offers.map((o) => o.discount.percent);
    expect(percents).toEqual([...percents].sort((a, b) => b - a));

    // Nada por debajo del umbral se cuela.
    expect(percents.every((p) => p >= MIN_PERCENT)).toBe(true);

    // El 15% y el "Envio gratis" del fixture no aparecen.
    expect(message).not.toContain('15%');
    expect(message.toLowerCase()).not.toContain('gratis');
  });

  it('nunca reescribe 2x1 ni "hasta X%" como porcentaje plano', async () => {
    const cards = await load('listing-sample.html');
    const offers = buildOffers(dedupeByName(cards));
    const message = formatReport(offers, CITY);

    for (const offer of offers) {
      // Lo que se imprime es SIEMPRE el texto literal de pantalla.
      expect(message).toContain(offer.discount.literal);

      if (offer.discount.kind === '2x1') {
        // Un 2x1 cuenta como 50 para filtrar, pero no puede aparecer
        // anunciado como "50%", que es un numero que Rappi nunca mostro.
        const line = message.split('\n').find((l) => l.includes(offer.name)) ?? '';
        expect(line).toContain('2x1');
        expect(line).not.toMatch(/\b50\s*%/);
      }
    }
  });

  it('marca explicitamente el alcance que no es menu completo', async () => {
    const cards = await load('listing-sample.html');
    const offers = buildOffers(dedupeByName(cards));
    const message = formatReport(offers, CITY);

    for (const offer of offers) {
      if (offer.scope === 'full-menu') continue;
      const line = message.split('\n').find((l) => l.includes(offer.name)) ?? '';
      // Un descuento parcial jamas puede leerse como uno de menu completo.
      expect(line).toContain('⚠️');
      expect(line).not.toContain('todo el menú');
    }
  });

  it('el fixture con data-testid tambien atraviesa el pipeline', async () => {
    const html = readFileSync(resolve(process.cwd(), 'fixtures', 'offers-sample.html'), 'utf8');
    await page.setContent(html);
    const cards = await extractCardsFromPage(page, 'ofertas');
    expect(cards.length).toBeGreaterThan(0);

    const message = formatReport(buildOffers(dedupeByName(cards)), CITY);
    console.log('\n--- MENSAJE GENERADO (ofertas) ---\n' + message + '\n---\n');
    expect(message.length).toBeGreaterThan(0);
  });

  it('una pagina sin ofertas >=50% da el texto exacto pedido', async () => {
    await page.setContent(`
      <div data-qa="store-card">
        <a href="/restaurantes/x"><h3 data-qa="store-name">Solo Barato</h3></a>
        <span data-qa="discount-badge">15% OFF</span>
      </div>`);
    const cards = await extractCardsFromPage(page, 'listing');
    expect(cards).toHaveLength(1);

    const message = formatReport(buildOffers(cards), CITY);
    expect(message).toBe('Sin ofertas ≥50% hoy.');
    expect(message).toBe(EMPTY_REPORT);
  });

  it('el mensaje cabe en el limite de Discord', async () => {
    const cards = await load('listing-sample.html');
    const message = formatReport(buildOffers(dedupeByName(cards)), CITY);
    expect(message.length).toBeLessThanOrEqual(2000);
  });
});
