// Real-push smoke test: drives the bucket_full alert through AlertChecker → WebhookNotifier
// and posts to ntfy. Run manually with `npm run test:e2e` after setting NTFY_TOPIC in .env.
// Pure assertion logic for AlertChecker / mappers lives in test/*.test.ts (run via `npm test`).

import assert from 'node:assert/strict';

import { WebhookNotifier } from '../src/alerts/webhookNotifier.js';
import { baseState, newChecker } from './helpers.js';

const NTFY_TOPIC = process.env.NTFY_TOPIC;
if (!NTFY_TOPIC) {
  console.error('NTFY_TOPIC env var is required. Run with: npm run test:e2e (with NTFY_TOPIC in .env)');
  process.exit(1);
}
const NTFY_URL = process.env.NTFY_URL ?? `https://ntfy.sh/${NTFY_TOPIC}`;

const log = {
  info: (...a: unknown[]) => console.log('[info]', ...a),
  warn: (...a: unknown[]) => console.warn('[warn]', ...a),
  error: (...a: unknown[]) => console.error('[error]', ...a),
  debug: (...a: unknown[]) => console.log('[debug]', ...a),
  log: (...a: unknown[]) => console.log(...a),
  success: (...a: unknown[]) => console.log('[ok]', ...a),
} as never;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log('\n=== Notifications E2E (real ntfy pushes) ===');
  console.log(`ntfy URL: ${NTFY_URL}\n`);

  const notifier = new WebhookNotifier({
    url: NTFY_URL,
    title: 'Dehumidifier Monitor (E2E)',
    priority: 'default',
    tags: 'test_tube',
    log,
  });

  console.log('[1/3] Sending "test started" push...');
  await notifier.notify('E2E test starting — you should receive 2-3 test notifications.');
  await sleep(500);

  console.log('[2/3] Driving bucket_full through AlertChecker → notifier...');
  const { checker } = newChecker();
  const alerts = checker.checkAppliance({
    reported: baseState({ waterTankFull: 'YES' }),
    isOnline: true,
  });
  assert.equal(alerts.length, 1, 'expected exactly one alert for bucket_full');
  assert.equal(alerts[0].type, 'bucket_full');
  console.log(`    -> alert.message: ${alerts[0].message}`);
  await notifier.notify(alerts[0].message);
  await sleep(500);

  console.log('[3/3] Sending "test complete" push...');
  await notifier.notify('E2E test passed: real-push pipeline OK.');
  console.log('\nAll pushes sent.');
}

main().catch((err) => {
  console.error('\nE2E FAILED:', err);
  process.exit(1);
});
