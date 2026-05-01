import type { DehumidifierState } from '../api/types.js';

export function fanSpeedToHAP(setting: string): number {
  switch (setting?.toUpperCase()) {
  case 'LOW': return 1;
  case 'MIDDLE': return 2;
  case 'HIGH': return 3;
  default: return 0;
  }
}

export function hapToFanSpeed(value: number): string {
  if (value <= 1) {
    return 'LOW';
  }
  if (value === 2) {
    return 'MIDDLE';
  }
  return 'HIGH';
}

export function waterLevelToHAP(state: DehumidifierState): number {
  if (state.waterTankFull?.toUpperCase() === 'YES') {
    return 100;
  }
  return state.waterBucketLevel ?? 0;
}

export function isBucketFull(state: DehumidifierState): boolean {
  if (state.waterTankFull?.toUpperCase() === 'YES') {
    return true;
  }
  // DH models: 100 = full. Use exact match to avoid false positives during drain cycles.
  if (state.waterBucketLevel === 100) {
    return true;
  }
  return false;
}

export function filterStateToHAP(filterState: string): number {
  // 0 = FILTER_OK, 1 = CHANGE_FILTER. CLEAN means "needs cleaning" in the Frigidaire API.
  const upper = filterState?.toUpperCase();
  if (upper === 'CLEAN' || upper === 'CHANGE' || upper === 'BUY') {
    return 1;
  }
  return 0;
}

export function parseUILockMode(raw: string | boolean | Record<string, unknown>): boolean {
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (typeof raw === 'string') {
    return raw.toUpperCase() === 'ON';
  }
  if (raw && typeof raw === 'object') {
    const val = Object.values(raw)[0];
    return val === 'ON' || val === true;
  }
  return false;
}
