import assert from 'node:assert/strict';

import { AlertChecker } from '../src/alerts/checker.js';
import { emptyAlertState, type AlertState } from '../src/alerts/types.js';
import { WebhookNotifier } from '../src/alerts/webhookNotifier.js';
import type { DehumidifierState } from '../src/api/types.js';

const NTFY_TOPIC = process.env.NTFY_TOPIC;
if (!NTFY_TOPIC) {
  console.error('NTFY_TOPIC env var is required. Run with: NTFY_TOPIC=<your-topic> npx tsx test/notifications-e2e.ts');
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

function baseState(overrides: Partial<DehumidifierState> = {}): DehumidifierState {
  return {
    sensorHumidity: 50,
    targetHumidity: 45,
    mode: 'DRY',
    fanSpeedSetting: 'AUTO',
    filterState: 'GOOD',
    applianceState: 'RUNNING',
    waterBucketLevel: 0,
    waterTankFull: 'NO',
    ambientTemperatureC: 22,
    condensatePump: 'OFF',
    cleanAirMode: 'OFF',
    uiLockMode: false,
    ...overrides,
  };
}

function newChecker(state: AlertState = emptyAlertState()): { checker: AlertChecker; state: AlertState } {
  const checker = new AlertChecker(
    {
      cooldownMs: 60 * 60 * 1000,
      humidityThreshold: 60,
      alerts: {},
    },
    state,
    log,
    () => {},
  );
  return { checker, state };
}

async function main(): Promise<void> {
  console.log('\n=== Notifications E2E ===');
  console.log(`ntfy URL: ${NTFY_URL}\n`);

  const notifier = new WebhookNotifier({
    url: NTFY_URL,
    title: 'Dehumidifier Monitor (E2E)',
    priority: 'default',
    tags: 'test_tube',
    log,
  });

  // 1. Real push: "test started"
  console.log('[1/5] Sending "test started" push to ntfy...');
  await notifier.notify('E2E test starting — you should receive a few test notifications.');
  await sleep(500);

  // 2. Trigger one real alert (bucket_full) via the full pipeline.
  console.log('[2/5] Triggering bucket_full via AlertChecker → notifier...');
  {
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
  }

  // 3. Cooldown: same condition next poll should NOT re-alert.
  console.log('[3/5] Verifying cooldown (no push expected)...');
  {
    const { checker, state } = newChecker();
    let alerts = checker.checkAppliance({
      reported: baseState({ waterTankFull: 'YES' }),
      isOnline: true,
    });
    assert.equal(alerts.length, 1, 'first call should fire');
    alerts = checker.checkAppliance({
      reported: baseState({ waterTankFull: 'YES' }),
      isOnline: true,
    });
    assert.equal(alerts.length, 0, 'second call within cooldown should be suppressed');
    assert.ok(state.lastSent.bucket_full, 'lastSent should be recorded');
    console.log('    -> ok: second call suppressed by cooldown');
  }

  // 4. CONTINUOUS-mode skip for running_too_long and not_reaching_target.
  console.log('[4/5] Verifying CONTINUOUS-mode skip (no push expected)...');
  {
    const now = Date.now();
    const state: AlertState = {
      ...emptyAlertState(),
      runningSince: now - 13 * 60 * 60 * 1000,
      humidityHistory: Array.from({ length: 14 }, (_, i) => ({
        humidity: 70,
        running: true,
        time: now - (13 - i) * 5 * 60 * 1000,
      })),
    };
    const { checker } = newChecker(state);
    const alerts = checker.checkAppliance({
      reported: baseState({
        mode: 'CONTINUOUS',
        sensorHumidity: 70,
        targetHumidity: 45,
      }),
      isOnline: true,
    });
    const triggered = alerts.map((a) => a.type);
    assert.ok(
      !triggered.includes('running_too_long'),
      `CONTINUOUS mode should suppress running_too_long, got: ${triggered.join(',')}`,
    );
    assert.ok(
      !triggered.includes('not_reaching_target'),
      `CONTINUOUS mode should suppress not_reaching_target, got: ${triggered.join(',')}`,
    );
    console.log(`    -> ok: alerts in CONTINUOUS mode = [${triggered.join(', ') || 'none'}]`);
  }

  // 5. Verify all 12 alert types produce well-formed messages (no push).
  console.log('[5/5] Verifying all 12 alert types produce messages (no push)...');
  {
    const triggered: string[] = [];
    const now = Date.now();

    // bucket_full
    {
      const { checker } = newChecker();
      const a = checker.checkAppliance({ reported: baseState({ waterBucketLevel: 100 }), isOnline: true });
      assert.ok(a.find((x) => x.type === 'bucket_full'), 'bucket_full');
      triggered.push('bucket_full');
    }
    // high_humidity
    {
      const { checker } = newChecker();
      const a = checker.checkAppliance({ reported: baseState({ sensorHumidity: 75 }), isOnline: true });
      assert.ok(a.find((x) => x.type === 'high_humidity'), 'high_humidity');
      triggered.push('high_humidity');
    }
    // filter_dirty
    {
      const { checker } = newChecker();
      const a = checker.checkAppliance({ reported: baseState({ filterState: 'CHANGE' }), isOnline: true });
      assert.ok(a.find((x) => x.type === 'filter_dirty'), 'filter_dirty');
      triggered.push('filter_dirty');
    }
    // device_off (transition RUNNING -> OFF)
    {
      const { checker } = newChecker({ ...emptyAlertState(), previousPowerState: 'RUNNING' });
      const a = checker.checkAppliance({ reported: baseState({ applianceState: 'OFF' }), isOnline: true });
      assert.ok(a.find((x) => x.type === 'device_off'), 'device_off');
      triggered.push('device_off');
    }
    // device_offline
    {
      const { checker } = newChecker();
      const a = checker.checkAppliance({ reported: baseState(), isOnline: false });
      assert.ok(a.find((x) => x.type === 'device_offline'), 'device_offline');
      triggered.push('device_offline');
    }
    // api_error
    {
      const { checker } = newChecker();
      const a = checker.checkAPIError('test api error message');
      assert.ok(a.find((x) => x.type === 'api_error'), 'api_error');
      triggered.push('api_error');
    }
    // humidity_spike (need a reading older than 4 min, then big jump)
    {
      const state: AlertState = {
        ...emptyAlertState(),
        humidityHistory: [{ humidity: 50, running: true, time: now - 5 * 60 * 1000 }],
      };
      const { checker } = newChecker(state);
      const a = checker.checkAppliance({ reported: baseState({ sensorHumidity: 70 }), isOnline: true });
      assert.ok(a.find((x) => x.type === 'humidity_spike'), 'humidity_spike');
      triggered.push('humidity_spike');
    }
    // humidity_rising (positive): rose 10pts in the last 30 min while running.
    {
      const state: AlertState = {
        ...emptyAlertState(),
        humidityHistory: [
          { humidity: 50, running: true, time: now - 35 * 60 * 1000 },
          { humidity: 51, running: true, time: now - 25 * 60 * 1000 },
          { humidity: 52, running: true, time: now - 15 * 60 * 1000 },
        ],
        runningSince: now - 60 * 60 * 1000,
      };
      const { checker } = newChecker(state);
      const a = checker.checkAppliance({ reported: baseState({ sensorHumidity: 60 }), isOnline: true });
      assert.ok(a.find((x) => x.type === 'humidity_rising'), 'humidity_rising should fire on 10pt rise vs 35min ago');
      triggered.push('humidity_rising');
    }
    // humidity_rising (negative regression): old stale reading (90min ago) shows a
    // big rise, but the reading closest to 30min ago shows only +1pt. The buggy
    // implementation used Array.find which returned the oldest match (90min ago,
    // humidity 40) and falsely fired. Fixed code walks backwards and uses the
    // 35-min-old reading (humidity 49), so delta is 1 < threshold → no alert.
    {
      const state: AlertState = {
        ...emptyAlertState(),
        humidityHistory: [
          { humidity: 40, running: true, time: now - 90 * 60 * 1000 },
          { humidity: 49, running: true, time: now - 35 * 60 * 1000 },
          { humidity: 49, running: true, time: now - 20 * 60 * 1000 },
        ],
        runningSince: now - 100 * 60 * 1000,
      };
      const { checker } = newChecker(state);
      const a = checker.checkAppliance({ reported: baseState({ sensorHumidity: 50 }), isOnline: true });
      assert.ok(
        !a.find((x) => x.type === 'humidity_rising'),
        'humidity_rising must NOT fire when ~30min-ago reading shows only a 1pt rise (regression: was returning oldest 90min-ago reading)',
      );
    }
    // not_reaching_target (running 1+ hr, sensor > target, NOT continuous)
    {
      const state: AlertState = {
        ...emptyAlertState(),
        runningSince: now - 65 * 60 * 1000,
      };
      const { checker } = newChecker(state);
      const a = checker.checkAppliance({
        reported: baseState({ mode: 'DRY', sensorHumidity: 70, targetHumidity: 45 }),
        isOnline: true,
      });
      assert.ok(a.find((x) => x.type === 'not_reaching_target'), 'not_reaching_target');
      triggered.push('not_reaching_target');
    }
    // running_too_long (running 12+ hr, NOT continuous)
    {
      const state: AlertState = {
        ...emptyAlertState(),
        runningSince: now - 13 * 60 * 60 * 1000,
      };
      const { checker } = newChecker(state);
      const a = checker.checkAppliance({
        reported: baseState({ mode: 'DRY' }),
        isOnline: true,
      });
      assert.ok(a.find((x) => x.type === 'running_too_long'), 'running_too_long');
      triggered.push('running_too_long');
    }
    // frequent_cycling (≥6 transitions in last hour)
    {
      const state: AlertState = {
        ...emptyAlertState(),
        powerTransitions: Array.from({ length: 7 }, (_, i) => now - (i * 5 * 60 * 1000)),
      };
      const { checker } = newChecker(state);
      const a = checker.checkAppliance({ reported: baseState(), isOnline: true });
      assert.ok(a.find((x) => x.type === 'frequent_cycling'), 'frequent_cycling');
      triggered.push('frequent_cycling');
    }
    // freeze_warning (running, ambient ≤5°C)
    {
      const { checker } = newChecker();
      const a = checker.checkAppliance({
        reported: baseState({ ambientTemperatureC: 2 }),
        isOnline: true,
      });
      assert.ok(a.find((x) => x.type === 'freeze_warning'), 'freeze_warning');
      triggered.push('freeze_warning');
    }

    console.log(`    -> ok: all 12 alert types produced messages (${triggered.length}/12)`);
    assert.equal(triggered.length, 12, 'all 12 alert types should fire');
  }

  // Final push: test complete
  console.log('\nSending final "test complete" push...');
  await notifier.notify('E2E test passed: 12/12 alert types verified, cooldown OK, CONTINUOUS-mode skip OK.');

  console.log('\nAll assertions passed.');
}

main().catch((err) => {
  console.error('\nE2E FAILED:', err);
  process.exit(1);
});
