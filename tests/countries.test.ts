import { describe, expect, it } from 'vitest';
import { COUNTRIES, resolveCountry, urlsFor, supportedCodes } from '../src/countries.js';
import { ConfigError } from '../src/errors.js';

describe('resolveCountry', () => {
  it('usa Colombia por defecto', () => {
    expect(resolveCountry(undefined).code).toBe('co');
    expect(resolveCountry('').code).toBe('co');
  });

  it('acepta mayusculas y espacios', () => {
    expect(resolveCountry('  MX ').code).toBe('mx');
  });

  it('lanza ConfigError con un codigo desconocido', () => {
    expect(() => resolveCountry('xx')).toThrow(ConfigError);
  });

  // Brasil se excluye a proposito: el sitio esta en portugues y los parsers
  // solo entienden espanol. Aceptarlo daria "sin ofertas" habiendo promociones.
  it('rechaza Brasil y explica por que', () => {
    expect(() => resolveCountry('br')).toThrow(/portugues/i);
  });

  it('el error lista las opciones validas', () => {
    expect(() => resolveCountry('xx')).toThrow(/Colombia/);
  });
});

describe('dominios', () => {
  // Verificados uno por uno contra el sitio real: no siguen un patron y
  // deducirlos habria fallado en tres de ocho.
  it.each([
    ['co', 'https://www.rappi.com.co/restaurantes'],
    ['mx', 'https://www.rappi.com.mx/restaurantes'],
    ['cl', 'https://www.rappi.cl/restaurantes'],
    ['pe', 'https://www.rappi.com.pe/restaurantes'],
    ['cr', 'https://www.rappi.co.cr/restaurantes'],
  ])('%s apunta a %s', (code, expected) => {
    expect(urlsFor(resolveCountry(code)).restaurants).toBe(expected);
  });

  it('Chile NO es rappi.com.cl y Peru NO es rappi.pe', () => {
    expect(COUNTRIES.cl!.domain).toBe('www.rappi.cl');
    expect(COUNTRIES.pe!.domain).toBe('www.rappi.com.pe');
  });

  it('todo pais tiene isoCode en mayusculas y coherente con su code', () => {
    for (const c of Object.values(COUNTRIES)) {
      expect(c.isoCode).toBe(c.code.toUpperCase());
      expect(c.domain).toMatch(/^www\.rappi\./);
    }
  });

  it('supportedCodes nombra los ocho paises', () => {
    expect(Object.keys(COUNTRIES)).toHaveLength(8);
    expect(supportedCodes()).toContain('mx (México)');
  });
});
