import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { Logging } from 'homebridge';

import { emptyAlertState, type AlertState } from './types.js';

export function loadAlertState(path: string, log: Logging): AlertState {
  if (!existsSync(path)) {
    return emptyAlertState();
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw) as AlertState;
    return {
      lastSent: parsed.lastSent ?? {},
      previousPowerState: parsed.previousPowerState,
      humidityHistory: parsed.humidityHistory ?? [],
      runningSince: parsed.runningSince,
      powerTransitions: parsed.powerTransitions ?? [],
    };
  } catch (err) {
    log.warn('Could not read alert state, starting fresh: %s', (err as Error).message);
    return emptyAlertState();
  }
}

export function saveAlertState(path: string, state: AlertState, log: Logging): void {
  try {
    writeFileSync(path, JSON.stringify(state, null, 2));
  } catch (err) {
    log.warn('Could not persist alert state: %s', (err as Error).message);
  }
}
