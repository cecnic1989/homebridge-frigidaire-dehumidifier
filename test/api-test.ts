/**
 * API smoke test. Reads credentials from test/hbConfig/config.json
 * (same config the dev Homebridge uses).
 *
 *   cp test/hbConfig/config.json.example test/hbConfig/config.json
 *   # edit config.json with real creds
 *   npx tsx test/api-test.ts [--raw]
 */

import { ElectroluxClient } from '../src/api/electroluxClient.js';
import { ensureLoggedIn, loadCreds, logger } from './shared.js';

async function main() {
  const { username, password } = loadCreds();
  const client = new ElectroluxClient(username, password, logger);

  console.log('--- Login ---');
  await ensureLoggedIn(client);
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
