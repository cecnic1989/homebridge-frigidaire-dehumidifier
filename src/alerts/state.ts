import { existsSync, readFileSync, writeFileSync } from 'node:fs';

import type { Logging } from 'homebridge';

import { emptyAlertState, type AlertState } from './types.js';

export interface AlertStateStore {
  appliances: Record<string, AlertState>;
  /** Account-level alerts (API errors), not tied to one unit. */
  api: AlertState;
  /**
   * Flat history written before state was per appliance.
   * Kept for the sole unit on an account. Dropped when several units shared
   * it, because that file interleaves their readings and cooldowns.
   */
  legacy?: AlertState;
}

export type LegacyAlertAction = 'none' | 'migrated' | 'discarded';

export function emptyAlertStateStore(): AlertStateStore {
  return {
    appliances: {},
    api: emptyAlertState(),
  };
}

function asPartialState(value: unknown): Partial<AlertState> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Partial<AlertState>;
}

function normalizeAlertState(parsed: Partial<AlertState> | undefined): AlertState {
  return {
    lastSent: parsed?.lastSent ?? {},
    previousPowerState: parsed?.previousPowerState,
    humidityHistory: parsed?.humidityHistory ?? [],
    runningSince: parsed?.runningSince,
    powerTransitions: parsed?.powerTransitions ?? [],
  };
}

function normalizeAppliances(raw: unknown): Record<string, AlertState> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const appliances: Record<string, AlertState> = {};
  for (const [id, value] of Object.entries(raw)) {
    const partial = asPartialState(value);
    if (!id || !partial) {
      continue;
    }
    appliances[id] = normalizeAlertState(partial);
  }
  return appliances;
}

function fromLegacy(parsed: Partial<AlertState>): AlertStateStore {
  const legacy = normalizeAlertState(parsed);
  const api = emptyAlertState();
  if (legacy.lastSent.api_error !== undefined) {
    api.lastSent.api_error = legacy.lastSent.api_error;
    delete legacy.lastSent.api_error;
  }
  return {
    appliances: {},
    api,
    legacy,
  };
}

function parseAlertStateStore(parsed: unknown): AlertStateStore {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return emptyAlertStateStore();
  }
  if ('appliances' in parsed || 'api' in parsed) {
    const raw = parsed as { appliances?: unknown; api?: unknown };
    return {
      appliances: normalizeAppliances(raw.appliances),
      api: normalizeAlertState(asPartialState(raw.api)),
    };
  }
  return fromLegacy(asPartialState(parsed) ?? {});
}

export function loadAlertStateStore(path: string, log: Logging): AlertStateStore {
  if (!existsSync(path)) {
    return emptyAlertStateStore();
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown;
    return parseAlertStateStore(parsed);
  } catch (err) {
    log.warn('Could not read alert state, starting fresh: %s', (err as Error).message);
    return emptyAlertStateStore();
  }
}

export function saveAlertStateStore(path: string, store: AlertStateStore, log: Logging): void {
  const persisted = {
    appliances: store.appliances,
    api: store.api,
  };
  try {
    writeFileSync(path, JSON.stringify(persisted, null, 2));
  } catch (err) {
    log.warn('Could not persist alert state: %s', (err as Error).message);
  }
}

/**
 * State bucket for one appliance. The same object is returned for a given id
 * so cooldown, power, and humidity history stay with that unit.
 */
export function takeApplianceState(
  store: AlertStateStore,
  applianceId: string,
  applianceCount: number,
): { state: AlertState; legacyAction: LegacyAlertAction } {
  const existing = store.appliances[applianceId];
  if (existing) {
    return { state: existing, legacyAction: 'none' };
  }

  if (store.legacy && applianceCount > 1) {
    store.legacy = undefined;
    const state = emptyAlertState();
    store.appliances[applianceId] = state;
    return { state, legacyAction: 'discarded' };
  }

  if (store.legacy && applianceCount === 1 && Object.keys(store.appliances).length === 0) {
    store.appliances[applianceId] = store.legacy;
    store.legacy = undefined;
    return { state: store.appliances[applianceId], legacyAction: 'migrated' };
  }

  const state = emptyAlertState();
  store.appliances[applianceId] = state;
  return { state, legacyAction: 'none' };
}
