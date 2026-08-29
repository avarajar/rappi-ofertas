/**
 * Envio a un webhook de Discord.
 *
 * El envio es el ultimo eslabon: si falla, el usuario no se entera de nada.
 * Por eso reintenta ante errores transitorios (5xx, red caida, rate limit) pero
 * NO ante un 4xx normal: un webhook mal copiado tiene que doler de una vez, no
 * quedar escondido detras de tres reintentos que igual van a fallar.
 */

import { NotifyError } from '../errors.js';

/** Discord corta `content` en 2000 caracteres. */
const CONTENT_LIMIT = 2000;
/** Margen para el caracter de elipsis y para no pelear con el limite exacto. */
const TRUNCATE_AT = 1990;

const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 500;
/** Tope al retry_after que reporte Discord, por si manda algo absurdo. */
const MAX_RETRY_AFTER_MS = 60_000;
/** Cuanto del cuerpo de la respuesta se cita en el error. */
const BODY_SNIPPET_CHARS = 300;

/**
 * Arma el cuerpo JSON del webhook.
 *
 * La truncada es cinturon y tirantes: el formateador ya recorta, pero un mensaje
 * de 2001 caracteres no puede tumbar la corrida entera con un 400.
 */
export function buildPayload(content: string): { content: string } {
  if (content.length <= CONTENT_LIMIT) return { content };
  return { content: content.slice(0, TRUNCATE_AT) + '…' };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoffMs(attempt: number): number {
  return BASE_BACKOFF_MS * 2 ** (attempt - 1);
}

/**
 * Discord manda `retry_after` en SEGUNDOS dentro del JSON de un 429.
 * Devuelve null si el cuerpo no trae un valor usable.
 */
function retryAfterMs(body: string): number | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== 'object' || parsed === null) return null;

    const raw = (parsed as { retry_after?: unknown }).retry_after;
    const seconds = typeof raw === 'string' ? Number.parseFloat(raw) : raw;
    if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  } catch {
    // El cuerpo no era JSON. Se cae al backoff normal.
    return null;
  }
}

/**
 * Publica `content` en el webhook.
 *
 * @throws {NotifyError} si el mensaje no logro entregarse. Nunca falla en
 *   silencio: el CLI necesita el error para salir con codigo != 0.
 */
export async function sendToDiscord(webhookUrl: string, content: string): Promise<void> {
  const payload = buildPayload(content);
  let lastDetail = 'sin detalle';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;

    try {
      response = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      // DNS, conexion rechazada, socket cortado: transitorio, se reintenta.
      lastDetail = `error de red: ${err instanceof Error ? err.message : String(err)}`;
      if (attempt === MAX_ATTEMPTS) break;
      await sleep(backoffMs(attempt));
      continue;
    }

    if (response.ok) return;

    const body = await response.text().catch(() => '');
    lastDetail = `HTTP ${response.status}: ${body.slice(0, BODY_SNIPPET_CHARS)}`;

    const isRateLimited = response.status === 429;
    const isServerError = response.status >= 500;

    if (!isRateLimited && !isServerError) {
      // 4xx: webhook borrado, URL mal copiada, payload invalido. Reintentar
      // solo retrasaria el diagnostico.
      throw new NotifyError(`Discord rechazo el mensaje. ${lastDetail}`);
    }

    if (attempt === MAX_ATTEMPTS) break;

    const waitMs = (isRateLimited ? retryAfterMs(body) : null) ?? backoffMs(attempt);
    await sleep(waitMs);
  }

  throw new NotifyError(
    `No se pudo enviar a Discord tras ${MAX_ATTEMPTS} intentos. ${lastDetail}`,
  );
}
