import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ElectroluxClient } from '../src/api/electroluxClient.js';
import type { SessionSnapshot } from '../src/api/electroluxClient.js';

interface PlatformEntry {
  platform: string;
  auth?: { username?: string; password?: string };
}

export const logger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.log,
  log: console.log,
  success: console.log,
} as never;

function sessionPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'hbConfig', '.session.json');
}

export function buildClient(username: string, password: string): ElectroluxClient {
  const path = sessionPath();
  return new ElectroluxClient(username, password, logger, {
    loadSession: () => {
      if (!existsSync(path)) {
        return undefined;
      }
      return JSON.parse(readFileSync(path, 'utf8')) as SessionSnapshot;
    },
    onSessionUpdate: (snap) => {
      try {
        writeFileSync(path, JSON.stringify(snap, null, 2));
      } catch (err) {
        console.warn('Failed to persist session:', (err as Error).message);
      }
    },
  });
}

export function loadCreds(): { username: string; password: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  const configPath = join(here, 'hbConfig', 'config.json');

  let raw: string;
  try {
    raw = readFileSync(configPath, 'utf8');
  } catch {
    console.error(`Missing ${configPath}. Copy config.json.example to config.json and fill in creds.`);
    process.exit(1);
  }

  const config = JSON.parse(raw) as { platforms?: PlatformEntry[] };
  const platform = config.platforms?.find((p) => p.platform === 'FrigidaireDehumidifier');

  if (!platform?.auth?.username || !platform.auth.password) {
    console.error('FrigidaireDehumidifier platform missing auth.username / auth.password');
    process.exit(1);
  }

  if (platform.auth.username === 'YOUR_EMAIL_HERE') {
    console.error('config.json still has placeholder credentials. Edit it with real values.');
    process.exit(1);
  }

  return { username: platform.auth.username, password: platform.auth.password };
}
