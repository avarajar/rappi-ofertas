/**
 * Jerarquia de errores tipados.
 *
 * Cada error se traduce a un mensaje distinto en Discord, un registro en el log
 * y un exit code != 0. Ningun fallo puede terminar reportando datos vacios como
 * si fueran un resultado valido.
 */

export type ErrorCode =
  | 'CONFIG'
  | 'SESSION'
  | 'ADDRESS'
  | 'SELECTOR'
  | 'TIMEOUT'
  | 'NOTIFY'
  | 'FORBIDDEN_ACTION';

export class RappiError extends Error {
  readonly code: ErrorCode;
  /** Selector implicado, si aplica. Sirve para diagnosticar cambios de HTML. */
  readonly selector?: string;

  constructor(code: ErrorCode, message: string, selector?: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    if (selector !== undefined) this.selector = selector;
  }
}

/** Falta o es invalida una variable de entorno. */
export class ConfigError extends RappiError {
  constructor(message: string) {
    super('CONFIG', message);
  }
}

/** La sesion aparece deslogueada. Hay que volver a correr `login`. */
export class SessionError extends RappiError {
  constructor(message: string) {
    super('SESSION', message);
  }
}

/** La direccion activa no es la esperada (Chia). Nunca se cambia: se aborta. */
export class AddressError extends RappiError {
  constructor(message: string) {
    super('ADDRESS', message);
  }
}

/**
 * No se encontro lo que se esperaba en el DOM.
 *
 * Esto significa que Rappi cambio su HTML. NO significa que no haya ofertas.
 */
export class SelectorError extends RappiError {
  constructor(message: string, selector?: string) {
    super('SELECTOR', message, selector);
  }
}

/** Se agoto el tiempo de scraping. */
export class ScrapeTimeoutError extends RappiError {
  constructor(message: string) {
    super('TIMEOUT', message);
  }
}

/** Fallo el envio a Discord. */
export class NotifyError extends RappiError {
  constructor(message: string) {
    super('NOTIFY', message);
  }
}

/**
 * Se intento una accion prohibida (comprar, agregar al carrito, cambiar ajustes).
 *
 * Este error es un bug del scraper, no una condicion de Rappi. Aborta siempre.
 */
export class ForbiddenActionError extends RappiError {
  constructor(message: string) {
    super('FORBIDDEN_ACTION', message);
  }
}

/** Normaliza cualquier throw a un RappiError. */
export function toRappiError(err: unknown): RappiError {
  if (err instanceof RappiError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/timeout/i.test(message)) return new ScrapeTimeoutError(message);
  return new RappiError('SELECTOR', message);
}
