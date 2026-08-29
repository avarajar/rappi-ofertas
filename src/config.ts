import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { ConfigError } from './errors.js';

export interface Config {
  /** null cuando se corre en --dry-run sin webhook configurado. */
  discordWebhookUrl: string | null;
  expectedAddress: string;
  browserProfileDir: string;
  scrapeTimeoutMs: number;
  maxScrollSteps: number;
}

/** Carga .env sin dependencias externas. Ignora comentarios y lineas vacias. */
function loadDotEnv(cwd: string): void {
  const envPath = resolve(cwd, '.env');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    // Lo que ya esta en el entorno real gana sobre el .env.
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function intFromEnv(key: string, fallback: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw.trim() === '') return fallback;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(`${key} debe ser un entero positivo, recibi "${raw}".`);
  }
  return parsed;
}

/**
 * @param opts.requireWebhook false en --dry-run, para poder probar el pipeline
 *   completo antes de crear el webhook de Discord.
 */
export function loadConfig(opts: { requireWebhook: boolean; cwd?: string }): Config {
  const cwd = opts.cwd ?? process.cwd();
  loadDotEnv(cwd);

  const rawWebhook = process.env.DISCORD_WEBHOOK_URL?.trim() ?? '';
  const isPlaceholder = rawWebhook.includes('000000') || rawWebhook === '';
  const discordWebhookUrl = isPlaceholder ? null : rawWebhook;

  if (opts.requireWebhook && discordWebhookUrl === null) {
    throw new ConfigError(
      'Falta DISCORD_WEBHOOK_URL. Copia .env.example a .env y pon tu webhook, ' +
        'o corre con --dry-run para probar sin enviar nada.',
    );
  }
  if (discordWebhookUrl !== null && !/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(discordWebhookUrl)) {
    throw new ConfigError(
      'DISCORD_WEBHOOK_URL no parece un webhook de Discord ' +
        '(esperaba https://discord.com/api/webhooks/...).',
    );
  }

  const expectedAddress = process.env.EXPECTED_ADDRESS?.trim() || 'Chia';

  return {
    discordWebhookUrl,
    expectedAddress,
    browserProfileDir: resolve(
      cwd,
      process.env.BROWSER_PROFILE_DIR?.trim() || '.browser-profile',
    ),
    scrapeTimeoutMs: intFromEnv('SCRAPE_TIMEOUT_MS', 120_000),
    maxScrollSteps: intFromEnv('MAX_SCROLL_STEPS', 40),
  };
}
