/**
 * API smoke test. Reads credentials from test/hbConfig/config.json
 * (same config the dev Homebridge uses).
 *
 *   cp test/hbConfig/config.json.example test/hbConfig/config.json
 *   # edit config.json with real creds
 *   npx tsx test/api-test.ts [--raw]
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { ElectroluxClient } from '../src/api/electroluxClient.js';

const logger = {
  info: console.log,
  warn: console.warn,
  error: console.error,
  debug: console.log,
  log: console.log,
  success: console.log,
} as never;

interface PlatformEntry {
  platform: string;
  auth?: { username?: string; password?: string };
}

function loadCreds(): { username: string; password: string } {
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

async function main() {
  const { username, password } = loadCreds();
  const client = new ElectroluxClient(username, password, logger);

  console.log('--- Login ---');
  await client.login();
  console.log('Login OK\n');

  console.log('--- Appliances ---');
  const appliances = await client.getAppliances();
  console.log(`Found ${appliances.length} appliance(s)\n`);

  for (const app of appliances) {
    const r = app.properties.reported;
    console.log(`[${app.applianceData.applianceName}]`);
    console.log(`  Model:       ${app.applianceData.modelName}`);
    console.log(`  ID:          ${app.applianceId}`);
    console.log(`  Connection:  ${app.connectionState}`);
    console.log(`  State:       ${r.applianceState}`);
    console.log(`  Humidity:    ${r.sensorHumidity}% (target: ${r.targetHumidity}%)`);
    console.log(`  Mode:        ${r.mode}`);
    console.log(`  Fan:         ${r.fanSpeedSetting}`);
    console.log(`  Filter:      ${r.filterState}`);
    console.log(`  Water:       bucket=${r.waterBucketLevel} tankFull=${r.waterTankFull}`);
    console.log(`  Pump:        ${r.condensatePump}`);
    console.log(`  Clean Air:   ${r.cleanAirMode}`);
    console.log(`  UI Lock:     ${JSON.stringify(r.uiLockMode)}`);
    console.log(`  Temp:        ${r.ambientTemperatureC ?? 'n/a'}°C`);
    console.log(`  FW:          ${r.networkInterface?.swVersion ?? 'n/a'}`);
    console.log();
  }

  if (process.argv.includes('--raw')) {
    console.log('--- Raw JSON ---');
    console.log(JSON.stringify(appliances, null, 2));
  }
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
