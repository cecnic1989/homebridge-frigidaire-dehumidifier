/**
 * API smoke test. Reads credentials from hbConfig/config.json
 * (same config the dev Homebridge instance uses).
 *
 *   cp hbConfig/config.json.example hbConfig/config.json
 *   # edit config.json with real creds
 *   npm run test:e2e:api -- [--raw]
 */

import { buildClient, loadCreds } from './shared.js';

// CLEAN means "needs cleaning" in the Frigidaire API — append the meaning
// alongside the raw value so the smoke output isn't misleading.
const FILTER_MEANINGS: Record<string, string> = {
  GOOD: 'OK',
  CLEAN: 'needs cleaning',
  CHANGE: 'needs replacement',
  BUY: 'order new filter',
};

async function main() {
  const { username, password } = loadCreds();
  const client = buildClient(username, password);

  console.log('--- Login ---');
  await client.ensureAuth();
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
    const filterMeaning = FILTER_MEANINGS[r.filterState?.toUpperCase() ?? ''] ?? 'unknown';
    console.log(`  Filter:      ${r.filterState} (${filterMeaning})`);
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
