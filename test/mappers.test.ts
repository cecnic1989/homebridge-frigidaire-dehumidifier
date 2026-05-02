import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  currentStateKind,
  fanSpeedToHAP,
  filterStateToHAP,
  hapToFanSpeed,
  isBucketFull,
  parseUILockMode,
  planSwitchTap,
  waterLevelToHAP,
} from '../src/utils/mappers.js';
import { baseState } from './helpers.js';

describe('filterStateToHAP', () => {
  // CLEAN means "needs cleaning" in the Frigidaire API — must map to CHANGE_FILTER
  // so the HomeKit indicator agrees with the alert path.
  test('CLEAN/CHANGE/BUY map to CHANGE_FILTER (1)', () => {
    assert.equal(filterStateToHAP('CLEAN'), 1);
    assert.equal(filterStateToHAP('CHANGE'), 1);
    assert.equal(filterStateToHAP('BUY'), 1);
  });

  test('GOOD maps to FILTER_OK (0)', () => {
    assert.equal(filterStateToHAP('GOOD'), 0);
  });

  test('case-insensitive', () => {
    assert.equal(filterStateToHAP('clean'), 1);
    assert.equal(filterStateToHAP('Change'), 1);
  });

  test('unknown / undefined / empty falls back to FILTER_OK', () => {
    assert.equal(filterStateToHAP('UNKNOWN'), 0);
    assert.equal(filterStateToHAP(undefined as unknown as string), 0);
    assert.equal(filterStateToHAP(''), 0);
  });
});

describe('fanSpeedToHAP', () => {
  test('LOW=1, MIDDLE=2, HIGH=3', () => {
    assert.equal(fanSpeedToHAP('LOW'), 1);
    assert.equal(fanSpeedToHAP('MIDDLE'), 2);
    assert.equal(fanSpeedToHAP('HIGH'), 3);
  });

  test('unknown / AUTO falls back to 0', () => {
    assert.equal(fanSpeedToHAP('AUTO'), 0);
    assert.equal(fanSpeedToHAP(undefined as unknown as string), 0);
  });
});

describe('hapToFanSpeed', () => {
  test('0/1 -> LOW, 2 -> MIDDLE, 3 -> HIGH', () => {
    assert.equal(hapToFanSpeed(0), 'LOW');
    assert.equal(hapToFanSpeed(1), 'LOW');
    assert.equal(hapToFanSpeed(2), 'MIDDLE');
    assert.equal(hapToFanSpeed(3), 'HIGH');
  });
});

describe('waterLevelToHAP', () => {
  test('waterTankFull=YES -> 100', () => {
    assert.equal(waterLevelToHAP(baseState({ waterTankFull: 'YES', waterBucketLevel: 0 })), 100);
  });

  test('falls back to waterBucketLevel', () => {
    assert.equal(waterLevelToHAP(baseState({ waterTankFull: 'NO', waterBucketLevel: 42 })), 42);
  });

  test('missing waterBucketLevel -> 0', () => {
    const state = baseState({ waterTankFull: 'NO' });
    delete (state as { waterBucketLevel?: number }).waterBucketLevel;
    assert.equal(waterLevelToHAP(state), 0);
  });
});

describe('isBucketFull', () => {
  test('waterTankFull=YES is full', () => {
    assert.equal(isBucketFull(baseState({ waterTankFull: 'YES' })), true);
  });

  test('waterBucketLevel exactly 100 is full', () => {
    assert.equal(isBucketFull(baseState({ waterBucketLevel: 100 })), true);
  });

  test('waterBucketLevel <100 is not full (avoids drain-cycle false positives)', () => {
    assert.equal(isBucketFull(baseState({ waterBucketLevel: 99 })), false);
    assert.equal(isBucketFull(baseState({ waterBucketLevel: 0 })), false);
  });
});

describe('parseUILockMode', () => {
  test('boolean passthrough', () => {
    assert.equal(parseUILockMode(true), true);
    assert.equal(parseUILockMode(false), false);
  });

  test('string ON/off (case-insensitive)', () => {
    assert.equal(parseUILockMode('ON'), true);
    assert.equal(parseUILockMode('on'), true);
    assert.equal(parseUILockMode('OFF'), false);
  });

  test('object with ON value', () => {
    assert.equal(parseUILockMode({ value: 'ON' }), true);
    assert.equal(parseUILockMode({ value: true }), true);
    assert.equal(parseUILockMode({ value: 'OFF' }), false);
  });
});

describe('currentStateKind', () => {
  // applianceState=running + fanOnly is the regression case: the unit reports
  // "running" but is not dehumidifying, so HomeKit's Current State must read
  // IDLE rather than DEHUMIDIFYING.
  test('running + FANONLY -> IDLE (unit running but not dehumidifying)', () => {
    assert.equal(currentStateKind('RUNNING', 'FANONLY'), 'IDLE');
  });

  test('running + dehumidifying mode -> DEHUMIDIFYING', () => {
    assert.equal(currentStateKind('RUNNING', 'DRY'), 'DEHUMIDIFYING');
    assert.equal(currentStateKind('RUNNING', 'AUTO'), 'DEHUMIDIFYING');
  });

  test('off -> INACTIVE regardless of mode', () => {
    assert.equal(currentStateKind('OFF', 'DRY'), 'INACTIVE');
    assert.equal(currentStateKind('OFF', 'FANONLY'), 'INACTIVE');
  });
});

describe('planSwitchTap (radio-button + power decisions)', () => {
  test('tap-on a different mode while powered on -> setMode without power-on', () => {
    const e = planSwitchTap('DRY', true, { kind: 'setOn', mode: 'AUTO' });
    assert.deepEqual(e, { kind: 'setMode', mode: 'AUTO', alsoPowerOn: false });
  });

  test('tap-on any mode while powered off -> setMode + power on', () => {
    const e = planSwitchTap(undefined, false, { kind: 'setOn', mode: 'QUIET' });
    assert.deepEqual(e, { kind: 'setMode', mode: 'QUIET', alsoPowerOn: true });
  });

  test('tap-off the active mode -> powerOff', () => {
    const e = planSwitchTap('DRY', true, { kind: 'setOff', mode: 'DRY' });
    assert.deepEqual(e, { kind: 'powerOff' });
  });

  test('tap-off an inactive mode is a noop (caller re-asserts state)', () => {
    const e = planSwitchTap('DRY', true, { kind: 'setOff', mode: 'AUTO' });
    assert.deepEqual(e, { kind: 'noop' });
  });
});
