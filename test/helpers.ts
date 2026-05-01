import { AlertChecker } from '../src/alerts/checker.js';
import { emptyAlertState, type AlertEnabledMap, type AlertState } from '../src/alerts/types.js';
import type { DehumidifierState } from '../src/api/types.js';

export const silentLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
  log: () => {},
  success: () => {},
} as never;

export function baseState(overrides: Partial<DehumidifierState> = {}): DehumidifierState {
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

export interface CheckerOpts {
  state?: AlertState;
  alerts?: AlertEnabledMap;
  cooldownMs?: number;
  humidityThreshold?: number;
}

export function newChecker(opts: CheckerOpts = {}): { checker: AlertChecker; state: AlertState } {
  const state = opts.state ?? emptyAlertState();
  const checker = new AlertChecker(
    {
      cooldownMs: opts.cooldownMs ?? 60 * 60 * 1000,
      humidityThreshold: opts.humidityThreshold ?? 60,
      alerts: opts.alerts ?? {},
    },
    state,
    silentLog,
    () => {},
  );
  return { checker, state };
}
