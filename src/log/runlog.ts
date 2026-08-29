/**
 * Bitacora de corridas: una linea JSON por ejecucion en `<logDir>/runs.jsonl`.
 *
 * Es el rastro que sirve el dia que Rappi cambie su HTML: se mira `outcome`,
 * `cardsSeen` y `failedSelector` y se sabe si el scraper quedo ciego o si de
 * verdad no habia ofertas.
 */

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { toRappiError } from '../errors.js';
import type { RunLogRecord } from '../types.js';

export const RUN_LOG_FILE = 'runs.jsonl';

export interface BuildRecordInput {
  durationMs: number;
  dryRun: boolean;
  cardsSeen?: number;
  candidatesParsed?: number;
  offersMatched?: number;
  /** Cualquier throw. Si viene, la corrida es 'failure'. */
  error?: unknown;
  /** Inyectable para tests. Por defecto, ahora. */
  timestamp?: string;
}

/**
 * Ensambla el registro. Puro: no toca disco, no lee el reloj si le pasan
 * `timestamp`. Toda la logica de "que se guarda" vive aca para poder testearla.
 */
export function buildRecord(input: BuildRecordInput): RunLogRecord {
  const record: RunLogRecord = {
    timestamp: input.timestamp ?? new Date().toISOString(),
    durationMs: input.durationMs,
    outcome: input.error === undefined || input.error === null ? 'success' : 'failure',
    cardsSeen: input.cardsSeen ?? 0,
    candidatesParsed: input.candidatesParsed ?? 0,
    offersMatched: input.offersMatched ?? 0,
    dryRun: input.dryRun,
  };

  if (record.outcome === 'failure') {
    const err = toRappiError(input.error);
    record.errorCode = err.code;
    record.errorMessage = err.message;
    if (err.selector !== undefined) record.failedSelector = err.selector;
  }

  return record;
}

/**
 * Agrega una linea a `<logDir>/runs.jsonl`, creando el directorio si falta.
 *
 * Nunca propaga: perder una linea de log no puede tumbar una corrida que ya
 * hizo el trabajo. Si falla, avisa por stderr y sigue.
 */
export function appendRun(record: RunLogRecord, logDir: string): void {
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, RUN_LOG_FILE), JSON.stringify(record) + '\n', 'utf8');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[runlog] no se pudo escribir el log en ${logDir}: ${message}\n`);
  }
}
