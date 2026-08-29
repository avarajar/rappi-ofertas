import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPayload, sendToDiscord } from '../src/notify/discord.js';
import { NotifyError } from '../src/errors.js';

const WEBHOOK = 'https://discord.com/api/webhooks/123/abc';

/** Respuesta minima con lo unico que consume sendToDiscord. */
function res(status: number, body = ''): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  } as unknown as Response;
}

/**
 * Corre todos los reintentos y devuelve el error.
 *
 * El .catch se engancha antes de mover el reloj: si se hiciera despues, la
 * promesa rechazaria sin handler y Vitest lo reportaria como fuga.
 */
async function settle(promise: Promise<void>): Promise<unknown> {
  const caught = promise.then(() => undefined, (err: unknown) => err);
  await vi.runAllTimersAsync();
  return caught;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // Timers falsos: los reintentos esperan segundos reales y los tests no.
  vi.useFakeTimers();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('buildPayload', () => {
  it('deja el contenido intacto cuando cabe', () => {
    expect(buildPayload('Sin ofertas ≥50% hoy.')).toEqual({
      content: 'Sin ofertas ≥50% hoy.',
    });
  });

  it('no toca un mensaje de exactamente 2000 caracteres', () => {
    const exact = 'a'.repeat(2000);
    expect(buildPayload(exact).content).toBe(exact);
  });

  it('trunca en 1990 y agrega elipsis cuando pasa de 2000', () => {
    const long = 'b'.repeat(2500);
    const { content } = buildPayload(long);

    expect(content).toHaveLength(1991);
    expect(content.startsWith('b'.repeat(1990))).toBe(true);
    expect(content.endsWith('…')).toBe(true);
    expect(content.length).toBeLessThanOrEqual(2000);
  });
});

describe('sendToDiscord', () => {
  it('hace POST del payload como JSON', async () => {
    fetchMock.mockResolvedValue(res(204));

    await sendToDiscord(WEBHOOK, 'hola');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WEBHOOK);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ content: 'hola' });
  });

  it('envia el contenido ya truncado', async () => {
    fetchMock.mockResolvedValue(res(204));

    await sendToDiscord(WEBHOOK, 'c'.repeat(3000));

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(init.body as string) as { content: string };
    expect(sent.content).toHaveLength(1991);
    expect(sent.content.endsWith('…')).toBe(true);
  });

  it('reintenta ante un 500 y termina bien', async () => {
    fetchMock
      .mockResolvedValueOnce(res(500, 'internal error'))
      .mockResolvedValueOnce(res(204));

    const sent = sendToDiscord(WEBHOOK, 'hola');
    await vi.runAllTimersAsync();

    await expect(sent).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reintenta ante un error de red y termina bien', async () => {
    fetchMock
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(res(204));

    const sent = sendToDiscord(WEBHOOK, 'hola');
    await vi.runAllTimersAsync();

    await expect(sent).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('NO reintenta ante un 400: un webhook malo tiene que doler de una vez', async () => {
    fetchMock.mockResolvedValue(res(400, '{"message":"Cannot send an empty message"}'));

    const failure = await settle(sendToDiscord(WEBHOOK, 'hola'));

    expect(failure).toBeInstanceOf(NotifyError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('NO reintenta ante un 404 (webhook borrado)', async () => {
    fetchMock.mockResolvedValue(res(404, '{"message":"Unknown Webhook"}'));

    const failure = await settle(sendToDiscord(WEBHOOK, 'hola'));

    expect((failure as Error).message).toMatch(/404/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tira NotifyError con status y cuerpo tras agotar los reintentos', async () => {
    fetchMock.mockResolvedValue(res(503, 'service unavailable'));

    const failure = await settle(sendToDiscord(WEBHOOK, 'hola'));

    expect(failure).toBeInstanceOf(NotifyError);
    expect((failure as Error).message).toMatch(/503/);
    expect((failure as Error).message).toMatch(/service unavailable/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('tira NotifyError cuando la red falla en los tres intentos', async () => {
    fetchMock.mockRejectedValue(new TypeError('ECONNREFUSED'));

    const failure = await settle(sendToDiscord(WEBHOOK, 'hola'));

    expect(failure).toBeInstanceOf(NotifyError);
    expect((failure as Error).message).toMatch(/ECONNREFUSED/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('respeta el retry_after de un 429 en vez del backoff normal', async () => {
    // retry_after viene en segundos; 2s es mas que el backoff de 500ms.
    fetchMock
      .mockResolvedValueOnce(res(429, JSON.stringify({ retry_after: 2 })))
      .mockResolvedValueOnce(res(204));

    const sent = sendToDiscord(WEBHOOK, 'hola');

    await vi.advanceTimersByTimeAsync(1500);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(600);
    await expect(sent).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('cae al backoff si el 429 no trae un retry_after usable', async () => {
    fetchMock
      .mockResolvedValueOnce(res(429, 'rate limited'))
      .mockResolvedValueOnce(res(204));

    const sent = sendToDiscord(WEBHOOK, 'hola');
    await vi.runAllTimersAsync();

    await expect(sent).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
