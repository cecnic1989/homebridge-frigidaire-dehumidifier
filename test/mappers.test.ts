import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
  fanSpeedToHAP,
  filterStateToHAP,
  hapToFanSpeed,
  isBucketFull,
  parseUILockMode,
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
