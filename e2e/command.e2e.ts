/**
 * Write-side smoke test. Sends a command to the first appliance and verifies
 * state delta after a short delay. Reads creds from hbConfig/config.json.
 *
 *   npm run test:e2e:command -- power on|off
 *   npm run test:e2e:command -- mode AUTO|DRY|CONTINUOUS|QUIET
 *   npm run test:e2e:command -- fan LOW|MIDDLE|HIGH|AUTO
 *   npm run test:e2e:command -- lock on|off
 *   npm run test:e2e:command -- humidity 45
 *   npm run test:e2e:command -- raw '{"executeCommand":"OFF"}'
 *   npm run test:e2e:command -- --id <applianceId> power off
 */

import type { Appliance, DehumidifierState } from '../src/api/types.js';
import { buildClient, loadCreds } from './shared.js';

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
    return { uiLockMode: req(arg, 'lock on|off').toLowerCase() === 'on' };
  case 'humidity': {
    const n = parseInt(req(arg, 'humidity <35-85>'), 10);
    if (Number.isNaN(n) || n < 35 || n > 85) {
      fail('humidity must be an integer between 35 and 85');
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
  const client = buildClient(username, password);
  await client.ensureAuth();

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
