import type { PlatformConfig } from 'homebridge';

export interface Appliance {
  applianceId: string;
  applianceData: ApplianceData;
  properties: Properties;
  status: string;
  connectionState: string;
}

export interface ApplianceData {
  applianceName: string;
  modelName: string;
}

export interface Properties {
  reported: DehumidifierState;
}

export interface DehumidifierState {
  sensorHumidity: number;
  targetHumidity: number;
  mode: string;
  fanSpeedSetting: string;
  filterState: string;
  applianceState: string;
  waterBucketLevel: number;
  waterTankFull: string;
  ambientTemperatureC?: number;
  condensatePump: string;
  cleanAirMode: string;
  uiLockMode: string | boolean | Record<string, unknown>;
  alerts?: unknown;
  networkInterface?: NetworkInterface;
}

export interface NetworkInterface {
  swVersion: string;
}

export type WebhookPriority = 'min' | 'low' | 'default' | 'high' | 'max';

export interface NotificationsConfig {
  enabled: boolean;
  url?: string;
  cooldownMinutes?: number;
  humidityThreshold?: number;
  title?: string;
  priority?: WebhookPriority;
  tags?: string;
  alerts?: {
    bucketFull?: boolean;
    highHumidity?: boolean;
    filterDirty?: boolean;
    deviceOff?: boolean;
    deviceOffline?: boolean;
    apiError?: boolean;
    humiditySpike?: boolean;
    humidityRising?: boolean;
    notReachingTarget?: boolean;
    runningTooLong?: boolean;
    frequentCycling?: boolean;
    freezeWarning?: boolean;
  };
}

export interface FrigidaireDehumidifierConfig extends PlatformConfig {
  auth: {
    username: string;
    password: string;
  };
  pollInterval?: number;
  dehumidifierMode?: string;
  notifications?: NotificationsConfig;
}
