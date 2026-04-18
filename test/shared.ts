import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import type { ElectroluxClient, SessionSnapshot } from '../src/api/electroluxClient.js';

interface PlatformEntry {
  platform: string;
  auth?: { username?: string; password?: string };
}

function sessionPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, 'hbConfig', '.session.json');
}

export async function ensureLoggedIn(client: ElectroluxClient): Promise<void> {
  const path = sessionPath();
  if (existsSync(path)) {
    try {
      const snap = JSON.parse(readFileSync(path, 'utf8')) as SessionSnapshot;
      client.importSession(snap);
      await client.ensureAuth();
      writeFileSync(path, JSON.stringify(client.exportSession(), null, 2));
      return;
    } catch (err) {
      console.warn('Cached session invalid, re-logging in:', (err as Error).message);
    }
  }
  await client.login();
  writeFileSync(path, JSON.stringify(client.exportSession(), null, 2));
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

export const logger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.log,
  log: console.log,
  success: console.log,
} as never;
