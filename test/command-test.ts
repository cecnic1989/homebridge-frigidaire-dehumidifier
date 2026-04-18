/**
 * Write-side smoke test. Sends a command to the first appliance and verifies
 * state delta after a short delay. Reads creds from test/hbConfig/config.json.
 *
 *   npx tsx test/command-test.ts power on|off
 *   npx tsx test/command-test.ts mode AUTO|DRY|CONTINUOUS|QUIET
 *   npx tsx test/command-test.ts fan LOW|MIDDLE|HIGH|AUTO
 *   npx tsx test/command-test.ts lock on|off
 *   npx tsx test/command-test.ts humidity 45
 *   npx tsx test/command-test.ts raw '{"executeCommand":"OFF"}'
 *   npx tsx test/command-test.ts --id <applianceId> power off
 */

import { ElectroluxClient } from '../src/api/electroluxClient.js';
import type { Appliance, DehumidifierState } from '../src/api/types.js';
import { ensureLoggedIn, loadCreds, logger } from './shared.js';

type Payload = Record<string, unknown>;

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

function req(v: string | undefined, usage: string): string {
  if (!v) {
    fail(`usage: ${usage}`);
  }
  return v;
}

function buildPayload(argv: string[]): Payload {
  const [cmd, arg] = argv;
  if (!cmd) {
    fail('missing subcommand');
  }
  switch (cmd.toLowerCase()) {
  case 'power':
    return { executeCommand: req(arg, 'power on|off').toUpperCase() };
  case 'mode':
    return { mode: req(arg, 'mode AUTO|DRY|CONTINUOUS|QUIET').toUpperCase() };
  case 'fan':
    return { fanSpeedSetting: req(arg, 'fan LOW|MIDDLE|HIGH|AUTO').toUpperCase() };
  case 'lock':
    return { uiLockMode: req(arg, 'lock on|off').toUpperCase() };
  case 'humidity': {
    const n = parseInt(req(arg, 'humidity <35-85>'), 10);
    if (Number.isNaN(n)) {
      fail('humidity must be a number');
    }
    return { targetHumidity: n };
  }
  case 'raw':
    return JSON.parse(req(arg, 'raw \'<json>\'')) as Payload;
  default:
    fail(`unknown subcommand: ${cmd}`);
  }
}

function snapshot(state: DehumidifierState): Record<string, unknown> {
  return {
    applianceState: state.applianceState,
    mode: state.mode,
    fanSpeedSetting: state.fanSpeedSetting,
    targetHumidity: state.targetHumidity,
    uiLockMode: state.uiLockMode,
  };
}

function pickAppliance(list: Appliance[], id: string | undefined): Appliance {
  if (id) {
    const match = list.find((a) => a.applianceId === id);
    if (!match) {
      fail(`appliance ${id} not found. Available: ${list.map((a) => a.applianceId).join(', ')}`);
    }
    return match;
  }
  if (list.length === 0) {
    fail('no appliances on account');
  }
  return list[0];
}

async function main() {
  const args = [...process.argv.slice(2)];
  let id: string | undefined;
  const idx = args.indexOf('--id');
  if (idx >= 0) {
    id = args[idx + 1];
    args.splice(idx, 2);
  }

  const payload = buildPayload(args);

  const { username, password } = loadCreds();
  const client = new ElectroluxClient(username, password, logger);
  await ensureLoggedIn(client);

  const before = await client.getAppliances();
  const device = pickAppliance(before, id);

  console.log(`Target: ${device.applianceData.applianceName} (${device.applianceId})`);
  console.log('Before:', JSON.stringify(snapshot(device.properties.reported), null, 2));
  console.log('Sending:', JSON.stringify(payload));

  try {
    await client.sendCommand(device.applianceId, payload);
    console.log('sendCommand OK');
  } catch (err) {
    console.error('sendCommand FAILED:', (err as Error).message);
    process.exit(2);
  }

  console.log('Waiting 3s for device to apply...');
  await new Promise((r) => setTimeout(r, 3000));

  const after = await client.getAppliances();
  const updated = pickAppliance(after, id);
  console.log('After: ', JSON.stringify(snapshot(updated.properties.reported), null, 2));
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
