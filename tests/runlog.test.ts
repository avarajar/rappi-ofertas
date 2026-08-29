import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appendRun, buildRecord, RUN_LOG_FILE } from '../src/log/runlog.js';
import { SelectorError, SessionError } from '../src/errors.js';
import type { RunLogRecord } from '../src/types.js';

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'rappi-runlog-'));
}

const created: string[] = [];

function scratch(): string {
  const dir = tempDir();
  created.push(dir);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  while (created.length > 0) {
    rmSync(created.pop() as string, { recursive: true, force: true });
  }
});

describe('buildRecord', () => {
  it('arma un registro de exito sin campos de error', () => {
    const record = buildRecord({
      durationMs: 1234,
      dryRun: false,
      cardsSeen: 42,
      candidatesParsed: 9,
      offersMatched: 3,
      timestamp: '2026-08-28T15:00:00.000Z',
    });

    expect(record).toEqual({
      timestamp: '2026-08-28T15:00:00.000Z',
      durationMs: 1234,
      outcome: 'success',
      cardsSeen: 42,
      candidatesParsed: 9,
      offersMatched: 3,
      dryRun: false,
    } satisfies RunLogRecord);
    expect('errorCode' in record).toBe(false);
    expect('failedSelector' in record).toBe(false);
  });

  it('pone ceros cuando no se alcanzo a contar nada', () => {
    const record = buildRecord({ durationMs: 10, dryRun: true });

    expect(record.cardsSeen).toBe(0);
    expect(record.candidatesParsed).toBe(0);
    expect(record.offersMatched).toBe(0);
    expect(record.dryRun).toBe(true);
    expect(record.outcome).toBe('success');
  });

  it('marca failure y copia codigo y mensaje del error', () => {
    const record = buildRecord({
      durationMs: 500,
      dryRun: false,
      error: new SessionError('la sesion se cayo'),
    });

    expect(record.outcome).toBe('failure');
    expect(record.errorCode).toBe('SESSION');
    expect(record.errorMessage).toBe('la sesion se cayo');
    expect(record.failedSelector).toBeUndefined();
  });

  it('guarda el selector que fallo cuando se sabe', () => {
    const record = buildRecord({
      durationMs: 500,
      dryRun: false,
      cardsSeen: 0,
      error: new SelectorError('cero tarjetas', '[data-qa="store-card"]'),
    });

    expect(record.outcome).toBe('failure');
    expect(record.errorCode).toBe('SELECTOR');
    expect(record.failedSelector).toBe('[data-qa="store-card"]');
    // Cero tarjetas queda registrado como fallo, nunca como corrida vacia feliz.
    expect(record.cardsSeen).toBe(0);
  });

  it('normaliza un throw que no era un RappiError', () => {
    const record = buildRecord({ durationMs: 1, dryRun: false, error: 'algo raro' });

    expect(record.outcome).toBe('failure');
    expect(record.errorCode).toBeDefined();
    expect(record.errorMessage).toBe('algo raro');
  });

  it('usa la hora actual en ISO cuando no le pasan timestamp', () => {
    const record = buildRecord({ durationMs: 1, dryRun: false });
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe('appendRun', () => {
  it('escribe una linea JSON valida y crea el directorio', () => {
    const dir = join(scratch(), 'anidado', 'logs');
    const record = buildRecord({
      durationMs: 100,
      dryRun: true,
      cardsSeen: 5,
      timestamp: '2026-08-28T15:00:00.000Z',
    });

    appendRun(record, dir);

    const raw = readFileSync(join(dir, RUN_LOG_FILE), 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(JSON.parse(raw.trim())).toEqual(record);
  });

  it('agrega una linea por corrida, sin pisar las anteriores', () => {
    const dir = scratch();

    appendRun(buildRecord({ durationMs: 1, dryRun: false, timestamp: 'a' }), dir);
    appendRun(buildRecord({ durationMs: 2, dryRun: false, timestamp: 'b' }), dir);
    appendRun(
      buildRecord({ durationMs: 3, dryRun: false, timestamp: 'c', error: new SessionError('x') }),
      dir,
    );

    const lines = readFileSync(join(dir, RUN_LOG_FILE), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(3);

    const parsed = lines.map((line) => JSON.parse(line) as RunLogRecord);
    expect(parsed.map((r) => r.timestamp)).toEqual(['a', 'b', 'c']);
    expect(parsed.map((r) => r.outcome)).toEqual(['success', 'success', 'failure']);
  });

  it('no tira cuando el directorio es imposible: perder un log no puede tumbar la corrida', () => {
    const base = scratch();
    // Un archivo donde deberia ir el directorio: mkdir falla con ENOTDIR.
    const bogus = join(base, 'no-soy-carpeta');
    writeFileSync(bogus, 'x', 'utf8');

    const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => {
      appendRun(buildRecord({ durationMs: 1, dryRun: false }), join(bogus, 'logs'));
    }).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('[runlog]');
  });

  it('no tira cuando el archivo de log es en realidad un directorio', () => {
    const dir = scratch();
    // runs.jsonl existe pero es una carpeta: appendFileSync falla con EISDIR.
    mkdirSync(join(dir, RUN_LOG_FILE));

    const warn = vi.spyOn(process.stderr, 'write').mockReturnValue(true);

    expect(() => {
      appendRun(buildRecord({ durationMs: 1, dryRun: false }), dir);
    }).not.toThrow();

    expect(warn).toHaveBeenCalledTimes(1);
  });
});
