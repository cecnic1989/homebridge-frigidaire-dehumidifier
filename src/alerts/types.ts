export type AlertType =
  | 'bucket_full'
  | 'high_humidity'
  | 'filter_dirty'
  | 'device_off'
  | 'device_offline'
  | 'api_error'
  | 'humidity_spike'
  | 'humidity_rising'
  | 'not_reaching_target'
  | 'running_too_long'
  | 'frequent_cycling'
  | 'freeze_warning';

export const ALERT_TYPES: AlertType[] = [
  'bucket_full',
  'high_humidity',
  'filter_dirty',
  'device_off',
  'device_offline',
  'api_error',
  'humidity_spike',
  'humidity_rising',
  'not_reaching_target',
  'running_too_long',
  'frequent_cycling',
  'freeze_warning',
];

export interface Alert {
  type: AlertType;
  message: string;
}

export interface HumidityReading {
  humidity: number;
  running: boolean;
  time: number;
}

export interface AlertState {
  lastSent: Partial<Record<AlertType, number>>;
  previousPowerState?: string;
  humidityHistory: HumidityReading[];
  runningSince?: number;
  powerTransitions: number[];
}

export function emptyAlertState(): AlertState {
  return {
    lastSent: {},
    humidityHistory: [],
    powerTransitions: [],
  };
}

export type AlertEnabledMap = Partial<Record<
  | 'bucketFull'
  | 'highHumidity'
  | 'filterDirty'
  | 'deviceOff'
  | 'deviceOffline'
  | 'apiError'
  | 'humiditySpike'
  | 'humidityRising'
  | 'notReachingTarget'
  | 'runningTooLong'
  | 'frequentCycling'
  | 'freezeWarning',
  boolean
>>;

export interface AlertCheckerConfig {
  cooldownMs: number;
  humidityThreshold: number;
  alerts: AlertEnabledMap;
}
