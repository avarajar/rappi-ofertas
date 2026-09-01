/**
 * Paises donde opera Rappi con contenido en espanol.
 *
 * Los dominios NO siguen un patron: Chile es `rappi.cl` y no `rappi.com.cl`,
 * Peru es `rappi.com.pe` y no `rappi.pe`, Costa Rica es `rappi.co.cr`. Cada uno
 * se verifico contra el sitio real (respuesta 200 en /restaurantes), no se
 * dedujo de una regla.
 *
 * Brasil (rappi.com.br) queda fuera a proposito: el sitio esta en portugues y
 * los parsers de descuento y alcance solo entienden espanol. Agregar el dominio
 * sin traducir los patrones daria corridas que reportan "sin ofertas" habiendo
 * promociones, que es el peor fallo posible aqui.
 */

import { ConfigError } from './errors.js';

export interface Country {
  /** Codigo ISO en minusculas, el que se pone en RAPPI_COUNTRY. */
  code: string;
  /** El que Rappi reporta en __NEXT_DATA__ location.country, en mayusculas. */
  isoCode: string;
  name: string;
  domain: string;
}

/** Verificados el 2026-09-01 contra el sitio real. */
export const COUNTRIES: Record<string, Country> = {
  co: { code: 'co', isoCode: 'CO', name: 'Colombia', domain: 'www.rappi.com.co' },
  mx: { code: 'mx', isoCode: 'MX', name: 'México', domain: 'www.rappi.com.mx' },
  ar: { code: 'ar', isoCode: 'AR', name: 'Argentina', domain: 'www.rappi.com.ar' },
  cl: { code: 'cl', isoCode: 'CL', name: 'Chile', domain: 'www.rappi.cl' },
  pe: { code: 'pe', isoCode: 'PE', name: 'Perú', domain: 'www.rappi.com.pe' },
  uy: { code: 'uy', isoCode: 'UY', name: 'Uruguay', domain: 'www.rappi.com.uy' },
  cr: { code: 'cr', isoCode: 'CR', name: 'Costa Rica', domain: 'www.rappi.co.cr' },
  ec: { code: 'ec', isoCode: 'EC', name: 'Ecuador', domain: 'www.rappi.com.ec' },
};

export interface CountryUrls {
  home: string;
  restaurants: string;
}

export function urlsFor(country: Country): CountryUrls {
  return {
    home: `https://${country.domain}/`,
    restaurants: `https://${country.domain}/restaurantes`,
  };
}

/** Lista legible para los mensajes de error. */
export function supportedCodes(): string {
  return Object.values(COUNTRIES)
    .map((c) => `${c.code} (${c.name})`)
    .join(', ');
}

/**
 * Resuelve el codigo de pais configurado.
 *
 * @throws {ConfigError} si el codigo no esta soportado. Fallar aqui es
 *   preferible a caer en un dominio inventado y reportar un SelectorError
 *   confuso treinta segundos despues.
 */
export function resolveCountry(raw: string | undefined): Country {
  // Ojo con `??`: una linea `RAPPI_COUNTRY=` en el .env da "" y no null, asi
  // que sin este trim explicito el default nunca se aplicaba.
  const code = (raw ?? '').trim().toLowerCase() || 'co';
  const country = COUNTRIES[code];

  if (country === undefined) {
    throw new ConfigError(
      `RAPPI_COUNTRY="${code}" no esta soportado. Opciones: ${supportedCodes()}. ` +
        'Brasil queda fuera porque el sitio esta en portugues y los parsers ' +
        'solo entienden espanol.',
    );
  }
  return country;
}
