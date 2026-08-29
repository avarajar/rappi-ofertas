import { describe, expect, it } from 'vitest';
import { formatReport, formatFailure, DISCORD_LIMIT } from '../src/report/format.js';
import type { Offer, ParsedDiscount, PromoScope } from '../src/types.js';

function offer(
  name: string,
  discount: ParsedDiscount,
  scope: PromoScope = 'full-menu',
  deadline: string | null = null,
): Offer {
  return { name, discount, scope, deadline, href: null };
}

const exact = (p: number, literal = `${p}% OFF`): ParsedDiscount => ({
  percent: p,
  literal,
  kind: 'exact',
});

describe('formatReport: estado vacio', () => {
  it('devuelve EXACTAMENTE el texto acordado, sin nada mas', () => {
    expect(formatReport([])).toBe('Sin ofertas ≥50% hoy.');
  });

  it('no tiene espacios al principio ni al final', () => {
    const out = formatReport([]);
    expect(out).toBe(out.trim());
  });

  it('usa el caracter ≥ real, no ">="', () => {
    const out = formatReport([]);
    expect(out).toContain('≥');
    expect(out).not.toContain('>=');
  });

  it('es una sola linea', () => {
    expect(formatReport([]).split('\n')).toHaveLength(1);
  });
});

describe('formatReport: encabezado', () => {
  it('incluye la cantidad de ofertas', () => {
    const out = formatReport([offer('A', exact(60)), offer('B', exact(55))]);
    expect(out.split('\n')[0]).toContain('(2)');
  });

  it('el encabezado no se confunde con el estado vacio', () => {
    const out = formatReport([offer('A', exact(60))]);
    expect(out).not.toContain('Sin ofertas');
  });
});

describe('formatReport: orden', () => {
  it('ordena por porcentaje descendente', () => {
    const out = formatReport([
      offer('Bajo', exact(50)),
      offer('Alto', exact(90)),
      offer('Medio', exact(70)),
    ]);
    const lines = out.split('\n').slice(1);
    expect(lines.map((l) => l.split(' — ')[0])).toEqual(['- Alto', '- Medio', '- Bajo']);
  });

  it('desempata por nombre alfabetico para que la salida sea determinista', () => {
    const out = formatReport([
      offer('Zeta', exact(60)),
      offer('Alfa', exact(60)),
      offer('Mika', exact(60)),
    ]);
    const lines = out.split('\n').slice(1);
    expect(lines.map((l) => l.split(' — ')[0])).toEqual(['- Alfa', '- Mika', '- Zeta']);
  });

  it('no muta el arreglo de entrada', () => {
    const offers = [offer('Bajo', exact(50)), offer('Alto', exact(90))];
    formatReport(offers);
    expect(offers.map((o) => o.name)).toEqual(['Bajo', 'Alto']);
  });

  it('dos llamadas con el mismo insumo dan el mismo texto', () => {
    const offers = [offer('B', exact(60)), offer('A', exact(60)), offer('C', exact(80))];
    expect(formatReport(offers)).toBe(formatReport([...offers].reverse()));
  });
});

describe('formatReport: literal verbatim', () => {
  it('imprime el literal tal cual, nunca un porcentaje reconstruido', () => {
    const out = formatReport([offer('Sushi Uno', exact(60, 'Hasta 60 % dcto'))]);
    expect(out).toContain('Hasta 60 % dcto');
  });

  it('un 2x1 se muestra como 2x1 y nunca como porcentaje', () => {
    // Se inspecciona la linea de la oferta: el encabezado lleva el "≥50%" del filtro.
    const line = formatReport([
      offer('Burger Dos', { percent: 50, literal: '2x1', kind: '2x1' }),
    ]).split('\n')[1];
    expect(line).toContain('2x1');
    expect(line).not.toMatch(/\d+\s*%/);
  });

  it('un 2x1 escrito en palabras tambien se marca como 2x1', () => {
    const line = formatReport([
      offer('Burger Dos', { percent: 50, literal: 'Lleva 2 paga 1', kind: '2x1' }),
    ]).split('\n')[1];
    expect(line).toContain('Lleva 2 paga 1');
    expect(line).toContain('2x1');
    expect(line).not.toMatch(/\d+\s*%/);
  });

  it('un techo se marca como techo y no como descuento plano', () => {
    const out = formatReport([
      offer('Pizza Tres', { percent: 60, literal: 'hasta 60%', kind: 'upto' }),
    ]);
    expect(out).toContain('hasta 60%');
    expect(out).toMatch(/tope/i);
  });
});

describe('formatReport: alcance explicito', () => {
  it('menu completo se muestra sin advertencia', () => {
    const out = formatReport([offer('A', exact(60), 'full-menu')]);
    expect(out).toContain('todo el menú');
    expect(out).not.toContain('⚠️');
  });

  it('productos seleccionados se marca con advertencia', () => {
    const out = formatReport([offer('A', exact(60), 'selected-items')]);
    expect(out).toContain('⚠️ solo productos seleccionados');
    expect(out).not.toContain('todo el menú');
  });

  it('primer pedido se marca con advertencia', () => {
    const out = formatReport([offer('A', exact(60), 'first-order')]);
    expect(out).toContain('⚠️ solo primer pedido');
    expect(out).not.toContain('todo el menú');
  });

  it('alcance desconocido se declara, nunca se asume menu completo', () => {
    const out = formatReport([offer('A', exact(60), 'unknown')]);
    expect(out).toContain('⚠️ alcance no confirmado');
    expect(out).not.toContain('todo el menú');
  });

  it('cada linea lleva su propio alcance', () => {
    const out = formatReport([
      offer('A', exact(90), 'full-menu'),
      offer('B', exact(80), 'selected-items'),
      offer('C', exact(70), 'first-order'),
      offer('D', exact(60), 'unknown'),
    ]);
    const lines = out.split('\n').slice(1);
    expect(lines[0]).toContain('todo el menú');
    expect(lines[1]).toContain('⚠️ solo productos seleccionados');
    expect(lines[2]).toContain('⚠️ solo primer pedido');
    expect(lines[3]).toContain('⚠️ alcance no confirmado');
  });
});

describe('formatReport: fecha limite', () => {
  it('agrega la fecha verbatim cuando existe', () => {
    const out = formatReport([
      offer('A', exact(60), 'selected-items', 'válido hasta el 31 de agosto'),
    ]);
    expect(out).toContain('válido hasta el 31 de agosto');
  });

  it('no agrega nada cuando no hay fecha', () => {
    const out = formatReport([offer('A', exact(60), 'full-menu', null)]);
    expect(out.split('\n')[1]).toBe('- A — 60% OFF — todo el menú');
  });
});

describe('formatReport: limite de 2000 caracteres de Discord', () => {
  const many = (n: number): Offer[] =>
    Array.from({ length: n }, (_, i) =>
      offer(
        `Restaurante con nombre bastante largo numero ${String(i).padStart(3, '0')}`,
        exact(99 - (i % 40)),
        'selected-items',
        'válido hasta el 31 de agosto',
      ),
    );

  it('un mensaje corto no se recorta', () => {
    const out = formatReport(many(3));
    expect(out.length).toBeLessThanOrEqual(DISCORD_LIMIT);
    expect(out).not.toMatch(/más/);
  });

  it('un mensaje largo se recorta por debajo del limite', () => {
    const out = formatReport(many(200));
    expect(out.length).toBeLessThanOrEqual(DISCORD_LIMIT);
  });

  it('dice cuantas ofertas se omitieron y el numero cuadra', () => {
    const total = 200;
    const out = formatReport(many(total));
    const lines = out.split('\n');
    const last = lines[lines.length - 1] ?? '';
    const match = /y (\d+) más/.exec(last);
    expect(match).not.toBeNull();
    const omitted = Number(match?.[1]);
    const shown = lines.length - 2; // sin encabezado ni linea de recorte
    expect(shown + omitted).toBe(total);
    expect(omitted).toBeGreaterThan(0);
  });

  it('el encabezado sigue reportando el total real, no el mostrado', () => {
    const out = formatReport(many(200));
    expect(out.split('\n')[0]).toContain('(200)');
  });

  it('conserva las ofertas de mayor porcentaje al recortar', () => {
    const out = formatReport(many(200));
    expect(out.split('\n')[1]).toContain('99% OFF');
  });
});

describe('formatFailure', () => {
  it('empieza con ⚠️ para que no se confunda con un reporte normal', () => {
    expect(formatFailure('SELECTOR', 'no se encontraron tarjetas').startsWith('⚠️')).toBe(true);
  });

  it('nunca se parece al reporte vacio ni al encabezado normal', () => {
    for (const code of ['CONFIG', 'SESSION', 'ADDRESS', 'SELECTOR', 'TIMEOUT', 'NOTIFY']) {
      const out = formatFailure(code, 'algo se rompio');
      expect(out).not.toContain('Sin ofertas ≥50% hoy.');
      expect(out).not.toContain('Ofertas Rappi');
    }
  });

  it('nombra el codigo y el mensaje recibidos', () => {
    const out = formatFailure('TIMEOUT', 'se agoto el tiempo cargando el listado');
    expect(out).toContain('TIMEOUT');
    expect(out).toContain('se agoto el tiempo cargando el listado');
  });

  it('SESSION dice que hay que volver a iniciar sesion', () => {
    const out = formatFailure('SESSION', 'la sesion aparece cerrada');
    expect(out).toContain('npm run login');
  });

  it('SELECTOR culpa al HTML de Rappi y apunta al archivo de selectores', () => {
    const out = formatFailure('SELECTOR', '0 tarjetas');
    expect(out).toMatch(/HTML/i);
    expect(out).toContain('src/selectors.ts');
  });

  it('SELECTOR no se confunde con "no hay ofertas"', () => {
    const out = formatFailure('SELECTOR', '0 tarjetas');
    expect(out).not.toContain('Sin ofertas');
  });

  it('ADDRESS menciona la direccion', () => {
    const out = formatFailure('ADDRESS', 'la direccion activa no es Chia');
    expect(out).toMatch(/direcci[oó]n/i);
  });

  it('un codigo desconocido igual produce un mensaje de fallo utilizable', () => {
    const out = formatFailure('ALGO_RARO', 'detalle');
    expect(out.startsWith('⚠️')).toBe(true);
    expect(out).toContain('ALGO_RARO');
    expect(out).toContain('detalle');
  });

  it('cabe en un mensaje de Discord', () => {
    const out = formatFailure('SELECTOR', 'x'.repeat(3000));
    expect(out.length).toBeLessThanOrEqual(DISCORD_LIMIT);
  });
});
