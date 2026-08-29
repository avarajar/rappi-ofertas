import { describe, expect, it } from 'vitest';
import { parseScope, detectScope, extractDeadline } from '../src/parse/scope.js';
import type { PromoScope } from '../src/types.js';

interface ScopeCase {
  text: string;
  expected: PromoScope;
  why: string;
}

const scopeCases: ScopeCase[] = [
  // --- first-order (la mas especifica: gana siempre) ------------------------
  { text: 'Solo en tu primer pedido', expected: 'first-order', why: 'frase canonica' },
  { text: '50% OFF en tu primera compra', expected: 'first-order', why: 'variante compra' },
  { text: 'Para nuevos usuarios', expected: 'first-order', why: 'variante usuarios' },
  { text: 'Válido en tu primera orden', expected: 'first-order', why: 'variante orden' },
  { text: 'PRIMER PEDIDO', expected: 'first-order', why: 'mayusculas' },
  {
    text: 'Todo el menú en tu primer pedido',
    expected: 'first-order',
    why: 'PRIORIDAD: primer pedido gana sobre todo el menu',
  },
  {
    text: 'Productos seleccionados, solo primera compra',
    expected: 'first-order',
    why: 'PRIORIDAD: primer pedido gana sobre seleccionados',
  },

  // --- selected-items -------------------------------------------------------
  { text: 'En productos seleccionados', expected: 'selected-items', why: 'frase canonica' },
  { text: 'hasta 60% en seleccionados', expected: 'selected-items', why: 'forma corta' },
  { text: 'Aplica en productos participantes', expected: 'selected-items', why: 'participantes' },
  { text: 'Artículos seleccionados', expected: 'selected-items', why: 'con tilde' },
  { text: 'Articulos seleccionados', expected: 'selected-items', why: 'sin tilde' },
  { text: '2x1 en productos', expected: 'selected-items', why: 'forma minima' },
  {
    text: 'Todo el menú en productos seleccionados',
    expected: 'selected-items',
    why: 'PRIORIDAD: seleccionados gana sobre todo el menu',
  },

  // --- full-menu ------------------------------------------------------------
  { text: 'En todo el menú', expected: 'full-menu', why: 'con tilde' },
  { text: 'En todo el menu', expected: 'full-menu', why: 'sin tilde' },
  { text: '50% OFF en todo el men...', expected: 'full-menu', why: 'texto truncado por la UI' },
  { text: 'Descuento en toda la tienda', expected: 'full-menu', why: 'variante tienda' },
  { text: 'Aplica a todos los productos', expected: 'full-menu', why: 'variante productos' },

  // --- unknown --------------------------------------------------------------
  { text: '', expected: 'unknown', why: 'vacio' },
  { text: '50% OFF', expected: 'unknown', why: 'badge sin alcance: NUNCA asumir menu completo' },
  { text: 'hasta 60%', expected: 'unknown', why: 'techo sin alcance' },
  { text: 'Envío gratis · 30 min', expected: 'unknown', why: 'texto sin nada de alcance' },
  { text: '2x1', expected: 'unknown', why: '2x1 pelado no dice alcance' },
];

describe('detectScope', () => {
  for (const c of scopeCases) {
    it(`${JSON.stringify(c.text)} -> ${c.expected} (${c.why})`, () => {
      expect(detectScope(c.text)).toBe(c.expected);
    });
  }

  it('nunca devuelve full-menu por defecto', () => {
    const sinPistas = ['', '   ', '50% OFF', 'Restaurante Popular', 'Abierto ahora'];
    for (const text of sinPistas) {
      expect(detectScope(text)).toBe('unknown');
    }
  });
});

interface DeadlineCase {
  text: string;
  expected: string | null;
  why: string;
}

const deadlineCases: DeadlineCase[] = [
  { text: 'hasta el 31/08', expected: 'hasta el 31/08', why: 'fecha corta' },
  { text: 'Válido hasta el 31/08/2026', expected: 'Válido hasta el 31/08/2026', why: 'con año' },
  { text: 'hasta el 31-08', expected: 'hasta el 31-08', why: 'separador guion' },
  {
    text: 'válido hasta el 31 de agosto',
    expected: 'válido hasta el 31 de agosto',
    why: 'fecha en palabras, VERBATIM sin convertir a ISO',
  },
  { text: 'Hasta el 1 de septiembre', expected: 'Hasta el 1 de septiembre', why: 'mes largo' },
  { text: 'solo hoy', expected: 'solo hoy', why: 'limite relativo' },
  { text: 'Sólo hoy', expected: 'Sólo hoy', why: 'con tilde' },
  { text: 'Solo por hoy', expected: 'Solo por hoy', why: 'variante con por' },
  { text: 'termina en 2 días', expected: 'termina en 2 días', why: 'cuenta regresiva' },
  { text: 'Termina en 5 horas', expected: 'Termina en 5 horas', why: 'horas' },
  { text: 'hasta mañana', expected: 'hasta mañana', why: 'dia relativo' },
  {
    text: '50% OFF en todo el menú hasta el 31/08',
    expected: 'hasta el 31/08',
    why: 'extrae solo el fragmento de tiempo',
  },
  { text: '', expected: null, why: 'vacio' },
  { text: '50% OFF', expected: null, why: 'sin limite' },
  {
    text: 'hasta 60% OFF',
    expected: null,
    why: 'TRAMPA: "hasta" de un techo de descuento NO es una fecha',
  },
  {
    text: 'hasta un 60% en seleccionados',
    expected: null,
    why: 'TRAMPA: techo con articulo tampoco es fecha',
  },
  { text: 'Entrega hasta 30 min', expected: null, why: 'TRAMPA: "hasta" de tiempo de entrega' },
  { text: 'Abierto hasta las 11 pm', expected: null, why: 'TRAMPA: horario de atencion' },
];

describe('extractDeadline', () => {
  for (const c of deadlineCases) {
    it(`${JSON.stringify(c.text)} -> ${c.expected === null ? 'null' : JSON.stringify(c.expected)} (${c.why})`, () => {
      expect(extractDeadline(c.text)).toBe(c.expected);
    });
  }

  it('el resultado siempre es una subcadena verbatim del original', () => {
    for (const c of deadlineCases) {
      const found = extractDeadline(c.text);
      if (found === null) continue;
      expect(c.text).toContain(found);
    }
  });
});

describe('parseScope', () => {
  it('combina alcance y fecha limite', () => {
    expect(parseScope('50% OFF en productos seleccionados, válido hasta el 31 de agosto')).toEqual({
      scope: 'selected-items',
      deadline: 'válido hasta el 31 de agosto',
    });
  });

  it('devuelve unknown y null cuando la tarjeta no dice nada', () => {
    expect(parseScope('50% OFF')).toEqual({ scope: 'unknown', deadline: null });
  });

  it('devuelve un alcance sin fecha', () => {
    expect(parseScope('2x1 en todo el menú')).toEqual({ scope: 'full-menu', deadline: null });
  });

  it('devuelve fecha sin alcance', () => {
    expect(parseScope('50% OFF solo hoy')).toEqual({ scope: 'unknown', deadline: 'solo hoy' });
  });
});
