import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { ElectroluxClient } from './api/electroluxClient.js';
import type { Appliance, FrigidaireDehumidifierConfig } from './api/types.js';
import { DehumidifierAccessory } from './accessories/dehumidifierAccessory.js';
import { HumiditySensorAccessory } from './accessories/humiditySensorAccessory.js';
import { TemperatureSensorAccessory } from './accessories/temperatureSensorAccessory.js';
import { BucketFullAccessory } from './accessories/bucketFullAccessory.js';
import { AirPurifierAccessory } from './accessories/airPurifierAccessory.js';
import { PumpSwitchAccessory } from './accessories/pumpSwitchAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

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

    this.client = new ElectroluxClient(
      this.pluginConfig.auth.username,
      this.pluginConfig.auth.password,
      this.log,
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
    try {
      this.log.info('Logging in to Electrolux API...');
      await this.client.login();
      this.log.info('Login successful.');
    } catch (err) {
      this.log.error('Login failed:', (err as Error).message);
      return;
    }

    await this.discoverDevices();

    const interval = Math.max(15, this.pluginConfig.pollInterval ?? 90) * 1000;
    this.log.info('Polling every %ds', interval / 1000);
    this.pollTimer = setInterval(() => this.pollDevices(), interval);
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

      const uuid = this.api.hap.uuid.generate(appliance.applianceId);
      this.discoveredUUIDs.add(uuid);

      const existingAccessory = this.accessories.get(uuid);
      if (existingAccessory) {
        this.log.info('Restoring accessory from cache:', existingAccessory.displayName);
        existingAccessory.context.device = appliance;
        this.setupAccessory(existingAccessory, appliance);
        continue;
      }

      this.log.info('Adding new accessory: %s (%s)', appliance.applianceData.applianceName, appliance.applianceData.modelName);
      const accessory = new this.api.platformAccessory(appliance.applianceData.applianceName, uuid);
      accessory.context.device = appliance;
      this.setupAccessory(accessory, appliance);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }

    // Remove stale accessories
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredUUIDs.has(uuid)) {
        this.log.info('Removing stale accessory:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  private setupAccessory(accessory: PlatformAccessory, appliance: Appliance): void {
    const id = appliance.applianceId;

    const dehuAccessory = new DehumidifierAccessory(this, accessory);
    this.dehumidifierAccessories.set(id, dehuAccessory);

    const humiditySensor = new HumiditySensorAccessory(this, accessory);
    this.humiditySensorAccessories.set(id, humiditySensor);

    if (appliance.properties.reported.ambientTemperatureC !== undefined
        && appliance.properties.reported.ambientTemperatureC !== null) {
      const tempSensor = new TemperatureSensorAccessory(this, accessory);
      this.temperatureSensorAccessories.set(id, tempSensor);
    }

    const bucketFull = new BucketFullAccessory(this, accessory);
    this.bucketFullAccessories.set(id, bucketFull);

    if (this.pluginConfig.enableAirPurifier !== false && appliance.properties.reported.cleanAirMode !== undefined) {
      const airAccessory = new AirPurifierAccessory(this, accessory);
      this.airPurifierAccessories.set(id, airAccessory);
    }

    if (this.pluginConfig.enablePumpSwitch !== false && appliance.properties.reported.condensatePump !== undefined) {
      const pumpAccessory = new PumpSwitchAccessory(this, accessory);
      this.pumpSwitchAccessories.set(id, pumpAccessory);
    }
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
