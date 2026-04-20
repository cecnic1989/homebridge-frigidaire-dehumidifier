import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { ElectroluxClient } from './api/electroluxClient.js';
import type { SessionSnapshot } from './api/electroluxClient.js';
import type { Appliance, FrigidaireDehumidifierConfig } from './api/types.js';
import { DehumidifierAccessory } from './accessories/dehumidifierAccessory.js';
import { HumiditySensorAccessory } from './accessories/humiditySensorAccessory.js';
import { TemperatureSensorAccessory } from './accessories/temperatureSensorAccessory.js';
import { BucketFullAccessory } from './accessories/bucketFullAccessory.js';
import { AirPurifierAccessory } from './accessories/airPurifierAccessory.js';
import { PumpSwitchAccessory } from './accessories/pumpSwitchAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

const SESSION_FILENAME = 'frigidaire-dehumidifier.session.json';

// Minutes between retries when hitting Electrolux's active-session cap (cas_3403).
// Shortest reported lockout is ~80 minutes; retrying sooner provably extends it.
const CAP_RETRY_MINUTES = [120, 240, 480, 720];
// Minutes between retries for transient errors (network, 5xx, bad creds).
const NORMAL_RETRY_MINUTES = [1, 5, 15];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class FrigidaireDehumidifierPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  private readonly discoveredUUIDs: Set<string> = new Set();
  private readonly dehumidifierAccessories: Map<string, DehumidifierAccessory> = new Map();
  private readonly humiditySensorAccessories: Map<string, HumiditySensorAccessory> = new Map();
  private readonly temperatureSensorAccessories: Map<string, TemperatureSensorAccessory> = new Map();
  private readonly bucketFullAccessories: Map<string, BucketFullAccessory> = new Map();
  private readonly airPurifierAccessories: Map<string, AirPurifierAccessory> = new Map();
  private readonly pumpSwitchAccessories: Map<string, PumpSwitchAccessory> = new Map();

  public client!: ElectroluxClient;
  private pollTimer?: ReturnType<typeof setInterval>;
  public readonly pluginConfig: FrigidaireDehumidifierConfig;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.pluginConfig = config as FrigidaireDehumidifierConfig;

    if (!this.pluginConfig.auth?.username || !this.pluginConfig.auth?.password) {
      this.log.error('Missing auth credentials in config. Unregistering cached accessories.');
      this.api.on('didFinishLaunching', () => this.unregisterAll());
      return;
    }

    const sessionPath = join(api.user.storagePath(), SESSION_FILENAME);
    this.client = new ElectroluxClient(
      this.pluginConfig.auth.username,
      this.pluginConfig.auth.password,
      this.log,
      {
        loadSession: () => {
          if (!existsSync(sessionPath)) {
            return undefined;
          }
          return JSON.parse(readFileSync(sessionPath, 'utf8')) as SessionSnapshot;
        },
        onSessionUpdate: (snap) => {
          try {
            writeFileSync(sessionPath, JSON.stringify(snap, null, 2));
          } catch (err) {
            this.log.warn('Failed to persist session: %s', (err as Error).message);
          }
        },
      },
    );

    this.api.on('didFinishLaunching', () => {
      this.startPlugin().catch((err) => {
        this.log.error('Plugin startup failed:', (err as Error).message);
      });
    });

    this.api.on('shutdown', () => {
      if (this.pollTimer) {
        clearInterval(this.pollTimer);
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  private unregisterAll(): void {
    if (this.accessories.size === 0) {
      return;
    }
    const list = Array.from(this.accessories.values());
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, list);
    this.accessories.clear();
  }

  private async startPlugin(): Promise<void> {
    await this.authenticateWithRetry();

    await this.discoverDevices();

    const interval = Math.max(15, this.pluginConfig.pollInterval ?? 90) * 1000;
    this.log.info('Polling every %ds', interval / 1000);
    this.pollTimer = setInterval(() => this.pollDevices(), interval);
  }

  private async authenticateWithRetry(): Promise<void> {
    let capAttempt = 0;
    let normalAttempt = 0;

    while (true) {
      try {
        await this.client.ensureAuth();
        return;
      } catch (err) {
        const msg = (err as Error).message;
        const isCap = msg.includes('cas_3403');
        const schedule = isCap ? CAP_RETRY_MINUTES : NORMAL_RETRY_MINUTES;
        const attempt = isCap ? capAttempt++ : normalAttempt++;
        const waitMin = schedule[Math.min(attempt, schedule.length - 1)];
        this.log.error(
          'Login failed (%s): %s. Retrying in %dm.',
          isCap ? 'active-session cap' : 'transient',
          msg,
          waitMin,
        );
        await sleep(waitMin * 60 * 1000);
      }
    }
  }

  private async discoverDevices(): Promise<void> {
    let appliances: Appliance[];
    try {
      appliances = await this.client.getAppliances();
    } catch (err) {
      this.log.error('Failed to discover devices:', (err as Error).message);
      return;
    }

    const excluded = new Set(this.pluginConfig.excludedDevices ?? []);

    for (const appliance of appliances) {
      if (excluded.has(appliance.applianceId)) {
        this.log.info('Excluding device: %s (%s)', appliance.applianceData.applianceName, appliance.applianceId);
        continue;
      }

      this.log.info('Discovering: %s (%s)', appliance.applianceData.applianceName, appliance.applianceData.modelName);
      this.setupDehumidifierAccessory(appliance);
      this.setupHumiditySensorAccessory(appliance);
      this.setupTemperatureSensorAccessory(appliance);
      this.setupBucketFullAccessory(appliance);
      this.setupAirPurifierAccessory(appliance);
      this.setupPumpSwitchAccessory(appliance);
    }

    // Remove stale accessories (devices removed from account, or features disabled)
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredUUIDs.has(uuid)) {
        this.log.info('Removing stale accessory:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }

  private registerOrReuse(
    uuid: string,
    displayName: string,
    category: number,
    appliance: Appliance,
  ): PlatformAccessory {
    this.discoveredUUIDs.add(uuid);
    const existing = this.accessories.get(uuid);
    if (existing) {
      existing.context.device = appliance;
      if (existing.category !== category) {
        existing.category = category;
        this.api.updatePlatformAccessories([existing]);
      }
      return existing;
    }
    const accessory = new this.api.platformAccessory(displayName, uuid, category);
    accessory.context.device = appliance;
    this.accessories.set(uuid, accessory);
    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    return accessory;
  }

  private setupDehumidifierAccessory(appliance: Appliance): void {
    const uuid = this.api.hap.uuid.generate(appliance.applianceId);
    const accessory = this.registerOrReuse(
      uuid,
      appliance.applianceData.applianceName,
      this.api.hap.Categories.AIR_DEHUMIDIFIER,
      appliance,
    );
    this.dehumidifierAccessories.set(appliance.applianceId, new DehumidifierAccessory(this, accessory));
  }

  private setupHumiditySensorAccessory(appliance: Appliance): void {
    const uuid = this.api.hap.uuid.generate(`${appliance.applianceId}-humidity`);
    const accessory = this.registerOrReuse(
      uuid,
      `${appliance.applianceData.applianceName} Humidity`,
      this.api.hap.Categories.SENSOR,
      appliance,
    );
    this.humiditySensorAccessories.set(appliance.applianceId, new HumiditySensorAccessory(this, accessory));
  }

  private setupTemperatureSensorAccessory(appliance: Appliance): void {
    const temp = appliance.properties.reported.ambientTemperatureC;
    if (temp === undefined || temp === null) {
      return;
    }
    const uuid = this.api.hap.uuid.generate(`${appliance.applianceId}-temperature`);
    const accessory = this.registerOrReuse(
      uuid,
      `${appliance.applianceData.applianceName} Temperature`,
      this.api.hap.Categories.SENSOR,
      appliance,
    );
    this.temperatureSensorAccessories.set(appliance.applianceId, new TemperatureSensorAccessory(this, accessory));
  }

  private setupBucketFullAccessory(appliance: Appliance): void {
    const uuid = this.api.hap.uuid.generate(`${appliance.applianceId}-bucket`);
    const accessory = this.registerOrReuse(
      uuid,
      `${appliance.applianceData.applianceName} Bucket`,
      this.api.hap.Categories.SENSOR,
      appliance,
    );
    this.bucketFullAccessories.set(appliance.applianceId, new BucketFullAccessory(this, accessory));
  }

  private setupAirPurifierAccessory(appliance: Appliance): void {
    if (this.pluginConfig.enableAirPurifier === false || appliance.properties.reported.cleanAirMode === undefined) {
      return;
    }
    const uuid = this.api.hap.uuid.generate(`${appliance.applianceId}-airpurifier`);
    const accessory = this.registerOrReuse(
      uuid,
      `${appliance.applianceData.applianceName} Air Purifier`,
      this.api.hap.Categories.AIR_PURIFIER,
      appliance,
    );
    this.airPurifierAccessories.set(appliance.applianceId, new AirPurifierAccessory(this, accessory));
  }

  private setupPumpSwitchAccessory(appliance: Appliance): void {
    if (this.pluginConfig.enablePumpSwitch === false || appliance.properties.reported.condensatePump === undefined) {
      return;
    }
    const uuid = this.api.hap.uuid.generate(`${appliance.applianceId}-pump`);
    const accessory = this.registerOrReuse(
      uuid,
      `${appliance.applianceData.applianceName} Pump`,
      this.api.hap.Categories.SWITCH,
      appliance,
    );
    this.pumpSwitchAccessories.set(appliance.applianceId, new PumpSwitchAccessory(this, accessory));
  }

  private async pollDevices(): Promise<void> {
    let appliances: Appliance[];
    try {
      appliances = await this.client.getAppliances();
    } catch (err) {
      this.log.error('Poll failed:', (err as Error).message);
      return;
    }

    for (const appliance of appliances) {
      const id = appliance.applianceId;
      const reported = appliance.properties.reported;

      this.log.debug('[%s] humidity=%d%% target=%d%% mode=%s state=%s',
        appliance.applianceData.applianceName,
        reported.sensorHumidity, reported.targetHumidity,
        reported.mode, reported.applianceState,
      );

      this.dehumidifierAccessories.get(id)?.refreshState(reported);
      this.humiditySensorAccessories.get(id)?.refreshState(reported);
      this.temperatureSensorAccessories.get(id)?.refreshState(reported);
      this.bucketFullAccessories.get(id)?.refreshState(reported);
      this.airPurifierAccessories.get(id)?.refreshState(reported);
      this.pumpSwitchAccessories.get(id)?.refreshState(reported);
    }
  }
}
