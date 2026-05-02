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

export type DehumMode = 'AUTO' | 'DRY' | 'QUIET' | 'FANONLY' | 'CONTINUOUS';

export const ALL_MODES: DehumMode[] = ['AUTO', 'DRY', 'QUIET', 'FANONLY', 'CONTINUOUS'];

const MODE_LOOKUP: Record<string, DehumMode> = {
  AUTO: 'AUTO',
  DRY: 'DRY',
  QUIET: 'QUIET',
  FANONLY: 'FANONLY',
  CONTINUOUS: 'CONTINUOUS',
};

export function normalizeMode(raw: string | undefined): DehumMode | undefined {
  if (!raw) {
    return undefined;
  }
  return MODE_LOOKUP[raw.toUpperCase()];
}

export function isDehumidifying(mode: DehumMode | undefined): boolean {
  if (!mode) {
    return false;
  }
  return mode !== 'FANONLY';
}

const MODE_COMMAND: Record<DehumMode, string> = {
  AUTO: 'AUTO',
  DRY: 'DRY',
  QUIET: 'QUIET',
  FANONLY: 'FANONLY',
  CONTINUOUS: 'CONTINUOUS',
};

export function modeToCommand(mode: DehumMode): string {
  return MODE_COMMAND[mode];
}

export type CurrentStateKind = 'INACTIVE' | 'IDLE' | 'DEHUMIDIFYING';

export function currentStateKind(
  applianceState: string | undefined,
  mode: DehumMode | undefined,
): CurrentStateKind {
  const upper = applianceState?.toUpperCase();
  if (upper === 'OFF') {
    return 'INACTIVE';
  }
  if (upper === 'RUNNING' && isDehumidifying(mode)) {
    return 'DEHUMIDIFYING';
  }
  return 'IDLE';
}

export type SwitchStateMap = Record<DehumMode, boolean>;

export function computeSwitchStates(mode: DehumMode | undefined, isPoweredOn: boolean): SwitchStateMap {
  const result: SwitchStateMap = { AUTO: false, DRY: false, QUIET: false, FANONLY: false, CONTINUOUS: false };
  if (!isPoweredOn || !mode) {
    return result;
  }
  result[mode] = true;
  return result;
}

export type SwitchAction =
  | { kind: 'setOn'; mode: DehumMode }
  | { kind: 'setOff'; mode: DehumMode };

export type SwitchEffect =
  | { kind: 'noop' }
  | { kind: 'powerOff' }
  | { kind: 'setMode'; mode: DehumMode; alsoPowerOn: boolean };

export function planSwitchTap(
  current: DehumMode | undefined,
  isPoweredOn: boolean,
  action: SwitchAction,
): SwitchEffect {
  if (action.kind === 'setOn') {
    if (isPoweredOn && current === action.mode) {
      return { kind: 'noop' };
    }
    return { kind: 'setMode', mode: action.mode, alsoPowerOn: !isPoweredOn };
  }
  if (!isPoweredOn) {
    return { kind: 'noop' };
  }
  if (current === action.mode) {
    return { kind: 'powerOff' };
  }
  return { kind: 'noop' };
}
