import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import { emptyAlertState } from '../src/alerts/types.js';
import {
  emptyAlertStateStore,
  loadAlertStateStore,
  saveAlertStateStore,
  takeApplianceState,
} from '../src/alerts/state.js';
import { baseState, newChecker, silentLog } from './helpers.js';

describe('alert state store — per appliance', () => {
  test('two units do not share cooldown, power, or humidity history', () => {
    const store = emptyAlertStateStore();
    const stateA = takeApplianceState(store, 'a', 2).state;
    const stateB = takeApplianceState(store, 'b', 2).state;
    assert.notEqual(stateA, stateB);

    const now = Date.now();
    stateA.humidityHistory.push({ humidity: 40, running: true, time: now - 5 * 60 * 1000 });
    const checkerA = newChecker({ state: stateA });
    const checkerB = newChecker({ state: stateB });

    const running = checkerA.checker.checkAppliance({
      reported: baseState({ applianceState: 'RUNNING', sensorHumidity: 70, waterTankFull: 'YES' }),
      isOnline: true,
      applianceName: 'Basement',
    });
    assert.ok(running.find((x) => x.type === 'bucket_full'));
    assert.ok(running.find((x) => x.type === 'humidity_spike'));

    const other = checkerB.checker.checkAppliance({
      reported: baseState({ applianceState: 'OFF', sensorHumidity: 80, waterTankFull: 'YES' }),
      isOnline: true,
      applianceName: 'Upstairs',
    });
    assert.equal(other.find((x) => x.type === 'device_off'), undefined);
    assert.equal(other.find((x) => x.type === 'humidity_spike'), undefined);
    const bucket = other.find((x) => x.type === 'bucket_full');
    assert.ok(bucket);
    assert.equal(bucket?.message, 'Upstairs: Bucket is full. Please empty it.');

    const again = takeApplianceState(store, 'a', 2);
    assert.equal(again.legacyAction, 'none');
    assert.equal(again.state, stateA);
    assert.equal(again.state.previousPowerState, 'RUNNING');
    assert.equal(takeApplianceState(store, 'b', 2).state.previousPowerState, 'OFF');
  });
});

describe('alert state store — legacy file', () => {
  test('a single appliance keeps its previous history', () => {
    const dir = mkdtempSync(join(tmpdir(), 'alerts-'));
    const path = join(dir, 'alerts.json');
    const sentAt = Date.now();
    try {
      writeFileSync(path, JSON.stringify({
        lastSent: { bucket_full: sentAt, api_error: sentAt },
        previousPowerState: 'RUNNING',
        humidityHistory: [{ humidity: 50, running: true, time: sentAt - 60_000 }],
        powerTransitions: [sentAt - 1000],
      }));
      const store = loadAlertStateStore(path, silentLog);
      const { state, legacyAction } = takeApplianceState(store, 'only-unit', 1);
      assert.equal(legacyAction, 'migrated');
      assert.equal(state.previousPowerState, 'RUNNING');
      assert.equal(state.lastSent.bucket_full, sentAt);
      assert.equal(state.lastSent.api_error, undefined);
      assert.equal(state.humidityHistory.length, 1);
      assert.equal(store.api.lastSent.api_error, sentAt);
      assert.equal(store.legacy, undefined);

      saveAlertStateStore(path, store, silentLog);
      const reloaded = loadAlertStateStore(path, silentLog);
      assert.equal(reloaded.legacy, undefined);
      assert.equal(reloaded.appliances['only-unit'].previousPowerState, 'RUNNING');
      assert.equal(reloaded.appliances['only-unit'].lastSent.bucket_full, sentAt);
      assert.equal(reloaded.appliances['only-unit'].lastSent.api_error, undefined);
      assert.equal(reloaded.api.lastSent.api_error, sentAt);

      const { checker } = newChecker({ state });
      const alerts = checker.checkAppliance({
        reported: baseState({ applianceState: 'OFF', waterTankFull: 'YES' }),
        isOnline: true,
        applianceName: 'Basement',
      });
      const turnedOff = alerts.find((x) => x.type === 'device_off');
      assert.equal(turnedOff?.message, 'Basement: Unit turned off unexpectedly. May need attention.');
      assert.equal(alerts.find((x) => x.type === 'bucket_full'), undefined);

      const api = newChecker({ state: store.api });
      assert.equal(api.checker.checkAPIError('still cooling down').length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('several appliances discard the shared history but keep the API-error timer', () => {
    const dir = mkdtempSync(join(tmpdir(), 'alerts-'));
    const path = join(dir, 'alerts.json');
    const sentAt = Date.now();
    try {
      writeFileSync(path, JSON.stringify({
        lastSent: { bucket_full: sentAt, api_error: sentAt },
        previousPowerState: 'RUNNING',
        humidityHistory: [{ humidity: 40, running: true, time: sentAt - 5 * 60 * 1000 }],
        powerTransitions: [sentAt],
      }));
      const store = loadAlertStateStore(path, silentLog);
      const first = takeApplianceState(store, 'a', 2);
      const second = takeApplianceState(store, 'b', 2);
      assert.equal(first.legacyAction, 'discarded');
      assert.equal(second.legacyAction, 'none');
      assert.deepEqual(first.state, emptyAlertState());
      assert.deepEqual(second.state, emptyAlertState());
      assert.notEqual(first.state, second.state);
      assert.equal(store.legacy, undefined);
      assert.equal(store.api.lastSent.api_error, sentAt);

      saveAlertStateStore(path, store, silentLog);
      const reloaded = loadAlertStateStore(path, silentLog);
      assert.equal(reloaded.legacy, undefined);
      assert.equal(reloaded.api.lastSent.api_error, sentAt);
      assert.equal(reloaded.appliances.a.previousPowerState, undefined);
      assert.deepEqual(reloaded.appliances.a.lastSent, {});
      assert.equal(reloaded.appliances.b.previousPowerState, undefined);
      assert.deepEqual(reloaded.appliances.b.lastSent, {});

      const off = newChecker({ state: first.state }).checker.checkAppliance({
        reported: baseState({ applianceState: 'OFF', waterTankFull: 'YES', sensorHumidity: 80 }),
        isOnline: true,
        applianceName: 'Basement',
      });
      assert.equal(off.find((x) => x.type === 'device_off'), undefined);
      assert.equal(off.find((x) => x.type === 'humidity_spike'), undefined);
      assert.ok(off.find((x) => x.type === 'bucket_full'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('corrupt alert state starts fresh', () => {
    const dir = mkdtempSync(join(tmpdir(), 'alerts-'));
    const path = join(dir, 'alerts.json');
    try {
      writeFileSync(path, '{');
      const store = loadAlertStateStore(path, silentLog);
      assert.deepEqual(store, emptyAlertStateStore());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
