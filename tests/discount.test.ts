import { describe, expect, it } from 'vitest';
import { parseDiscount, findDiscountCandidates } from '../src/parse/discount.js';
import type { ParsedDiscount } from '../src/types.js';

interface Case {
  /** Texto tal como llegaria de la tarjeta. */
  text: string;
  expected: ParsedDiscount | null;
  /** Por que este caso importa. */
  why: string;
}

const exact = (percent: number, literal: string): ParsedDiscount => ({
  percent,
  literal,
  kind: 'exact',
});
const upto = (percent: number, literal: string): ParsedDiscount => ({
  percent,
  literal,
  kind: 'upto',
});
const dosXuno = (literal: string): ParsedDiscount => ({
  percent: 50,
  literal,
  kind: '2x1',
});

const cases: Case[] = [
  // --- Porcentaje plano -----------------------------------------------------
  { text: '50% OFF', expected: exact(50, '50% OFF'), why: 'forma canonica' },
  { text: '50%OFF', expected: exact(50, '50%OFF'), why: 'sin espacio' },
  { text: '-50%', expected: exact(50, '-50%'), why: 'signo menos como marcador' },
  {
    text: '50 % de descuento',
    expected: exact(50, '50 % de descuento'),
    why: 'espacio antes del % y sufijo largo',
  },
  {
    text: 'Descuento 50%',
    expected: exact(50, 'Descuento 50%'),
    why: 'palabra clave antes del numero',
  },
  { text: '70% OFF', expected: exact(70, '70% OFF'), why: 'valor alto' },
  {
    text: '15% OFF',
    expected: exact(15, '15% OFF'),
    why: 'parsea aunque el filtro >=50 lo descarte despues',
  },
  { text: '50%', expected: exact(50, '50%'), why: 'badge que es solo el porcentaje' },
  { text: '  50 %  ', expected: exact(50, '50 %'), why: 'badge suelto con espacios' },
  { text: 'Dcto 60%', expected: exact(60, 'Dcto 60%'), why: 'abreviatura antes' },
  { text: '60% dcto', expected: exact(60, '60% dcto'), why: 'abreviatura despues' },
  {
    text: '45% OFF en pizzas',
    expected: exact(45, '45% OFF'),
    why: 'el literal se corta en el badge, no arrastra el resto',
  },
  { text: '100% OFF', expected: exact(100, '100% OFF'), why: 'limite superior valido' },

  // --- Techo ("hasta") ------------------------------------------------------
  { text: 'hasta 60%', expected: upto(60, 'hasta 60%'), why: 'techo minimo' },
  {
    text: 'hasta un 60% OFF',
    expected: upto(60, 'hasta un 60% OFF'),
    why: 'articulo intermedio',
  },
  {
    text: 'Hasta 60 % dcto',
    expected: upto(60, 'Hasta 60 % dcto'),
    why: 'mayuscula, espacio y abreviatura',
  },
  { text: 'hasta 45%', expected: upto(45, 'hasta 45%'), why: 'techo bajo el filtro' },
  {
    text: 'Hasta el 70% de descuento',
    expected: upto(70, 'Hasta el 70% de descuento'),
    why: '"el" intermedio y sufijo largo',
  },
  {
    text: 'Descuento hasta 60%',
    expected: upto(60, 'hasta 60%'),
    why: '"hasta" gana sobre la palabra clave suelta: sigue siendo un techo',
  },

  // --- 2x1 ------------------------------------------------------------------
  { text: '2x1', expected: dosXuno('2x1'), why: 'forma canonica' },
  { text: '2X1', expected: dosXuno('2X1'), why: 'mayuscula' },
  { text: '2 x 1', expected: dosXuno('2 x 1'), why: 'con espacios' },
  {
    text: 'Lleva 2 paga 1',
    expected: dosXuno('Lleva 2 paga 1'),
    why: 'forma escrita en palabras',
  },
  {
    text: '2x1 en hamburguesas',
    expected: dosXuno('2x1'),
    why: 'el literal no arrastra el alcance',
  },

  // --- Nada legible: null ---------------------------------------------------
  { text: '', expected: null, why: 'vacio' },
  { text: '   ', expected: null, why: 'solo espacios' },
  { text: 'Envío gratis', expected: null, why: 'promo que no es porcentaje' },
  { text: '$5.000 OFF', expected: null, why: 'descuento en pesos, no en %' },
  { text: '3x2', expected: null, why: 'NO se extrapola a un porcentaje' },
  { text: '3 x 2', expected: null, why: 'NO se extrapola aunque tenga espacios' },
  { text: 'Lleva 3 paga 2', expected: null, why: 'NO se extrapola en palabras' },
  { text: 'Nuevo', expected: null, why: 'etiqueta sin descuento' },
  { text: 'Abierto', expected: null, why: 'estado, no descuento' },
  { text: '30 min', expected: null, why: 'tiempo de entrega' },
  {
    text: '50 minutos',
    expected: null,
    why: 'TRAMPA: numero 50 sin signo % no es un descuento',
  },
  { text: '$50.000', expected: null, why: 'TRAMPA: precio, no 50%' },
  { text: '4.5 estrellas', expected: null, why: 'TRAMPA: calificacion' },
  { text: '4.5', expected: null, why: 'TRAMPA: calificacion suelta' },
  {
    text: 'Entrega 20 min · $50.000 mínimo · 4.5',
    expected: null,
    why: 'TRAMPA: tarjeta llena de numeros y ningun descuento',
  },
  { text: '12x1', expected: null, why: 'no es un 2x1' },
  { text: '150% OFF', expected: null, why: 'porcentaje imposible (>100)' },
  { text: '0% OFF', expected: null, why: 'porcentaje sin sentido (0)' },
  {
    text: '100% natural',
    expected: null,
    why: 'porcentaje sin contexto de descuento: no se inventa una oferta',
  },
  { text: 'Pedido mínimo $30.000', expected: null, why: 'monto minimo' },

  // --- Varios valores en la misma tarjeta -----------------------------------
  {
    text: 'hasta 60% en seleccionados, 20% OFF',
    expected: upto(60, 'hasta 60%'),
    why: 'gana el porcentaje mas alto y conserva SU propio kind y literal',
  },
  {
    text: '20% OFF hasta 80%',
    expected: upto(80, 'hasta 80%'),
    why: 'el mas alto gana sin importar el orden en el texto',
  },
  {
    text: '50% OFF 2x1',
    expected: exact(50, '50% OFF'),
    why: 'empate en 50: gana el porcentaje explicito sobre el 2x1 sintetico',
  },
  {
    text: '2x1 hasta 40%',
    expected: dosXuno('2x1'),
    why: 'el 2x1 (50) supera al techo de 40',
  },
  {
    text: 'hasta 70% OFF 2x1',
    expected: upto(70, 'hasta 70% OFF'),
    why: 'el techo de 70 supera al 2x1',
  },
  {
    text: 'hasta 50% 50% OFF',
    expected: exact(50, '50% OFF'),
    why: 'empate en 50: el valor firme gana sobre el techo',
  },
  {
    text: '150% OFF 60% OFF',
    expected: exact(60, '60% OFF'),
    why: 'se descarta el imposible y se conserva el legible',
  },
];

describe('parseDiscount', () => {
  for (const c of cases) {
    it(`${JSON.stringify(c.text)} -> ${c.expected ? c.expected.kind + ' ' + c.expected.percent : 'null'} (${c.why})`, () => {
      expect(parseDiscount(c.text)).toEqual(c.expected);
    });
  }

  it('nunca imprime un porcentaje que no este en el texto original', () => {
    for (const c of cases) {
      const parsed = parseDiscount(c.text);
      if (parsed === null) continue;
      expect(c.text).toContain(parsed.literal);
    }
  });

  it('siempre devuelve un percent en el rango (0, 100]', () => {
    for (const c of cases) {
      const parsed = parseDiscount(c.text);
      if (parsed === null) continue;
      expect(parsed.percent).toBeGreaterThan(0);
      expect(parsed.percent).toBeLessThanOrEqual(100);
    }
  });

  it('es estable: la misma entrada da el mismo resultado', () => {
    expect(parseDiscount('hasta 60% en seleccionados, 20% OFF')).toEqual(
      parseDiscount('hasta 60% en seleccionados, 20% OFF'),
    );
  });
});

describe('findDiscountCandidates', () => {
  it('encuentra todos los candidatos de una tarjeta con varios badges', () => {
    const found = findDiscountCandidates('hasta 60% en seleccionados, 20% OFF 2x1');
    expect(found.map((c) => [c.kind, c.percent, c.literal])).toEqual([
      ['upto', 60, 'hasta 60%'],
      ['exact', 20, '20% OFF'],
      ['2x1', 50, '2x1'],
    ]);
  });

  it('devuelve lista vacia cuando no hay nada legible', () => {
    expect(findDiscountCandidates('Entrega 20 min · $50.000')).toEqual([]);
  });

  it('descarta candidatos fuera de rango pero conserva los validos', () => {
    const found = findDiscountCandidates('150% OFF 60% OFF');
    expect(found).toHaveLength(1);
    expect(found[0]?.percent).toBe(60);
  });
});
