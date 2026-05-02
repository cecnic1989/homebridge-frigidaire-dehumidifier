import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { AlertChecker } from '../src/alerts/checker.js';
import { emptyAlertState } from '../src/alerts/types.js';
import { baseState, newChecker, silentLog } from './helpers.js';

describe('AlertChecker — alert types', () => {
  test('bucket_full fires when waterBucketLevel >= 100', () => {
    const { checker } = newChecker();
    const a = checker.checkAppliance({ reported: baseState({ waterBucketLevel: 100 }), isOnline: true });
    assert.ok(a.find((x) => x.type === 'bucket_full'));
  });

  test('bucket_full fires when waterTankFull=YES', () => {
    const { checker } = newChecker();
    const a = checker.checkAppliance({ reported: baseState({ waterTankFull: 'YES' }), isOnline: true });
    assert.ok(a.find((x) => x.type === 'bucket_full'));
  });

  test('high_humidity fires above threshold', () => {
    const { checker } = newChecker();
    const a = checker.checkAppliance({ reported: baseState({ sensorHumidity: 75 }), isOnline: true });
    assert.ok(a.find((x) => x.type === 'high_humidity'));
  });

  test('filter_dirty fires on CLEAN with "needs cleaning" message', () => {
    const { checker } = newChecker();
    const a = checker.checkAppliance({ reported: baseState({ filterState: 'CLEAN' }), isOnline: true });
    const alert = a.find((x) => x.type === 'filter_dirty');
    assert.ok(alert, 'expected filter_dirty');
    assert.match(alert!.message, /cleaning/i);
  });

  test('filter_dirty fires on CHANGE and BUY', () => {
    for (const filterState of ['CHANGE', 'BUY']) {
      const { checker } = newChecker();
      const a = checker.checkAppliance({ reported: baseState({ filterState }), isOnline: true });
      assert.ok(a.find((x) => x.type === 'filter_dirty'), `expected filter_dirty for ${filterState}`);
    }
  });

  test('filter_dirty does NOT fire on GOOD', () => {
    const { checker } = newChecker();
    const a = checker.checkAppliance({ reported: baseState({ filterState: 'GOOD' }), isOnline: true });
    assert.equal(a.find((x) => x.type === 'filter_dirty'), undefined);
  });

  test('device_off fires on RUNNING -> OFF transition', () => {
    const { checker } = newChecker({
      state: { ...emptyAlertState(), previousPowerState: 'RUNNING' },
    });
    const a = checker.checkAppliance({ reported: baseState({ applianceState: 'OFF' }), isOnline: true });
    assert.ok(a.find((x) => x.type === 'device_off'));
  });

  test('device_offline fires when isOnline=false', () => {
    const { checker } = newChecker();
    const a = checker.checkAppliance({ reported: baseState(), isOnline: false });
    assert.ok(a.find((x) => x.type === 'device_offline'));
  });

  test('humidity_spike fires on +15pt jump vs >4min-old reading', () => {
    const now = Date.now();
    const { checker } = newChecker({
      state: {
        ...emptyAlertState(),
        humidityHistory: [{ humidity: 50, running: true, time: now - 5 * 60 * 1000 }],
      },
    });
    const a = checker.checkAppliance({ reported: baseState({ sensorHumidity: 70 }), isOnline: true });
    assert.ok(a.find((x) => x.type === 'humidity_spike'));
  });

  test('humidity_rising fires on >3pt rise over ~30min while running', () => {
    const now = Date.now();
    const { checker } = newChecker({
      state: {
        ...emptyAlertState(),
        humidityHistory: [
          { humidity: 50, running: true, time: now - 35 * 60 * 1000 },
          { humidity: 51, running: true, time: now - 25 * 60 * 1000 },
          { humidity: 52, running: true, time: now - 15 * 60 * 1000 },
        ],
        runningSince: now - 60 * 60 * 1000,
      },
    });
    const a = checker.checkAppliance({ reported: baseState({ sensorHumidity: 60 }), isOnline: true });
    assert.ok(a.find((x) => x.type === 'humidity_rising'));
  });

  // Regression: an earlier impl used Array.find which returned the OLDEST match
  // older than the cutoff (90min ago, humidity 40), making a 10pt rise look real.
  // The fix walks backwards to find the NEWEST match older than cutoff (~30min ago).
  test('humidity_rising does NOT fire when ~30min-ago reading shows only +1pt', () => {
    const now = Date.now();
    const { checker } = newChecker({
      state: {
        ...emptyAlertState(),
        humidityHistory: [
          { humidity: 40, running: true, time: now - 90 * 60 * 1000 },
          { humidity: 49, running: true, time: now - 35 * 60 * 1000 },
          { humidity: 49, running: true, time: now - 20 * 60 * 1000 },
        ],
        runningSince: now - 100 * 60 * 1000,
      },
    });
    const a = checker.checkAppliance({ reported: baseState({ sensorHumidity: 50 }), isOnline: true });
    assert.equal(a.find((x) => x.type === 'humidity_rising'), undefined);
  });

  test('not_reaching_target fires after 1+hr running with sensor>target (DRY mode)', () => {
    const now = Date.now();
    const { checker } = newChecker({
      state: { ...emptyAlertState(), runningSince: now - 65 * 60 * 1000 },
    });
    const a = checker.checkAppliance({
      reported: baseState({ mode: 'DRY', sensorHumidity: 70, targetHumidity: 45 }),
      isOnline: true,
    });
    assert.ok(a.find((x) => x.type === 'not_reaching_target'));
  });

  test('running_too_long fires after 12+hr running (DRY mode)', () => {
    const now = Date.now();
    const { checker } = newChecker({
      state: { ...emptyAlertState(), runningSince: now - 13 * 60 * 60 * 1000 },
    });
    const a = checker.checkAppliance({ reported: baseState({ mode: 'DRY' }), isOnline: true });
    assert.ok(a.find((x) => x.type === 'running_too_long'));
  });

  test('frequent_cycling fires on ≥6 transitions in last hour', () => {
    const now = Date.now();
    const { checker } = newChecker({
      state: {
        ...emptyAlertState(),
        powerTransitions: Array.from({ length: 7 }, (_, i) => now - i * 5 * 60 * 1000),
      },
    });
    const a = checker.checkAppliance({ reported: baseState(), isOnline: true });
    assert.ok(a.find((x) => x.type === 'frequent_cycling'));
  });

  test('freeze_warning fires when running and ambient ≤5°C', () => {
    const { checker } = newChecker();
    const a = checker.checkAppliance({ reported: baseState({ ambientTemperatureC: 2 }), isOnline: true });
    assert.ok(a.find((x) => x.type === 'freeze_warning'));
  });
});

describe('AlertChecker — CONTINUOUS mode skips long-run alerts', () => {
  test('not_reaching_target and running_too_long suppressed in CONTINUOUS', () => {
    const now = Date.now();
    const { checker } = newChecker({
      state: {
        ...emptyAlertState(),
        runningSince: now - 13 * 60 * 60 * 1000,
        humidityHistory: Array.from({ length: 14 }, (_, i) => ({
          humidity: 70,
          running: true,
          time: now - (13 - i) * 5 * 60 * 1000,
        })),
      },
    });
    const a = checker.checkAppliance({
      reported: baseState({ mode: 'CONTINUOUS', sensorHumidity: 70, targetHumidity: 45 }),
      isOnline: true,
    });
    const types = a.map((x) => x.type);
    assert.ok(!types.includes('running_too_long'), `running_too_long should be skipped, got: ${types.join(',')}`);
    assert.ok(!types.includes('not_reaching_target'), `not_reaching_target should be skipped, got: ${types.join(',')}`);
  });
});

describe('AlertChecker — FANONLY mode skips dehumidify-dependent alerts', () => {
  test('not_reaching_target is suppressed in FANONLY mode', () => {
    const now = Date.now();
    const { checker } = newChecker({
      state: { ...emptyAlertState(), runningSince: now - 65 * 60 * 1000 },
    });
    const a = checker.checkAppliance({
      reported: baseState({ mode: 'fanOnly', sensorHumidity: 70, targetHumidity: 45 }),
      isOnline: true,
    });
    assert.equal(a.find((x) => x.type === 'not_reaching_target'), undefined);
  });

  test('running_too_long is suppressed in FANONLY mode', () => {
    const now = Date.now();
    const { checker } = newChecker({
      state: { ...emptyAlertState(), runningSince: now - 13 * 60 * 60 * 1000 },
    });
    const a = checker.checkAppliance({
      reported: baseState({ mode: 'fanOnly' }),
      isOnline: true,
    });
    assert.equal(a.find((x) => x.type === 'running_too_long'), undefined);
  });

  test('humidity_rising is suppressed in FANONLY mode', () => {
    const now = Date.now();
    const { checker } = newChecker({
      state: {
        ...emptyAlertState(),
        humidityHistory: [
          { humidity: 50, running: true, time: now - 35 * 60 * 1000 },
          { humidity: 51, running: true, time: now - 25 * 60 * 1000 },
          { humidity: 52, running: true, time: now - 15 * 60 * 1000 },
        ],
        runningSince: now - 60 * 60 * 1000,
      },
    });
    const a = checker.checkAppliance({
      reported: baseState({ mode: 'fanOnly', sensorHumidity: 60 }),
      isOnline: true,
    });
    assert.equal(a.find((x) => x.type === 'humidity_rising'), undefined);
  });

  test('freeze_warning is suppressed in FANONLY mode', () => {
    const { checker } = newChecker();
    const a = checker.checkAppliance({
      reported: baseState({ mode: 'fanOnly', ambientTemperatureC: 2 }),
      isOnline: true,
    });
    assert.equal(a.find((x) => x.type === 'freeze_warning'), undefined);
  });

  test('high_humidity STILL fires in FANONLY mode (mode-agnostic environmental risk)', () => {
    const { checker } = newChecker();
    const a = checker.checkAppliance({
      reported: baseState({ mode: 'fanOnly', sensorHumidity: 75 }),
      isOnline: true,
    });
    assert.ok(a.find((x) => x.type === 'high_humidity'));
  });
});

describe('AlertChecker — cooldown', () => {
  test('same alert within cooldown is suppressed', () => {
    const { checker, state } = newChecker();
    const first = checker.checkAppliance({ reported: baseState({ waterTankFull: 'YES' }), isOnline: true });
    assert.equal(first.length, 1);
    const second = checker.checkAppliance({ reported: baseState({ waterTankFull: 'YES' }), isOnline: true });
    assert.equal(second.length, 0);
    assert.ok(state.lastSent.bucket_full, 'lastSent should be recorded');
  });
});

describe('AlertChecker — checkAPIError', () => {
  test('fires by default', () => {
    const { checker } = newChecker();
    const a = checker.checkAPIError('boom');
    assert.equal(a.length, 1);
    assert.equal(a[0].type, 'api_error');
  });

  test('suppressed when alerts.apiError === false', () => {
    const checker = new AlertChecker(
      { cooldownMs: 60 * 60 * 1000, humidityThreshold: 60, alerts: { apiError: false } },
      emptyAlertState(),
      silentLog,
      () => {},
    );
    const a = checker.checkAPIError('boom');
    assert.equal(a.length, 0);
  });
});

