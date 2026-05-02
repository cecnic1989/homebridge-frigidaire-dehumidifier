import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { FrigidaireDehumidifierPlatform } from '../platform.js';
import type { Appliance, DehumidifierState } from '../api/types.js';
import {
  currentStateKind,
  fanSpeedToHAP,
  filterStateToHAP,
  hapToFanSpeed,
  modeToCommand,
  normalizeMode,
  parseUILockMode,
  waterLevelToHAP,
} from '../utils/mappers.js';
import type { ModeSwitchGroup } from './modeSwitchGroup.js';

export class DehumidifierAccessory {
  private dehumidifierService: Service;
  private filterService: Service;
  private state!: DehumidifierState;

  constructor(
    private readonly platform: FrigidaireDehumidifierPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly modeGroup?: ModeSwitchGroup,
  ) {
    const device = accessory.context.device as Appliance;
    this.state = device.properties.reported;

    // Accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Frigidaire')
      .setCharacteristic(this.platform.Characteristic.Model, device.applianceData.modelName)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, device.applianceId)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision,
        device.properties.reported.networkInterface?.swVersion ?? 'Unknown');

    // HumidifierDehumidifier service
    this.dehumidifierService = this.accessory.getService(this.platform.Service.HumidifierDehumidifier)
      || this.accessory.addService(this.platform.Service.HumidifierDehumidifier);

    this.dehumidifierService.setCharacteristic(this.platform.Characteristic.Name, device.applianceData.applianceName);

    // Remove HUMIDIFIER from valid target states — this is a dehumidifier only
    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState)
      .setProps({
        validValues: [
          this.platform.Characteristic.TargetHumidifierDehumidifierState.HUMIDIFIER_OR_DEHUMIDIFIER,
          this.platform.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER,
        ],
      });

    // Don't narrow minValue/maxValue here — iOS Home app renders the "Lowering to X%"
    // label as (value - minValue) / (maxValue - minValue) * 100 when minValue > 0,
    // which made 35% display as 0%. clampHumidity below keeps real writes/reads
    // inside the device's 35-85 operating band.
    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.RelativeHumidityDehumidifierThreshold)
      .updateValue(this.clampHumidity(this.state.targetHumidity))
      .setProps({ minStep: 5 });

    // Set fan speed range
    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 3, minStep: 1 });

    // Register handlers
    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.CurrentHumidifierDehumidifierState)
      .onGet(this.getCurrentState.bind(this));

    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.TargetHumidifierDehumidifierState)
      .onGet(this.getTargetState.bind(this))
      .onSet(this.setTargetState.bind(this));

    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(() => this.state.sensorHumidity);

    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.RelativeHumidityDehumidifierThreshold)
      .onGet(() => this.clampHumidity(this.state.targetHumidity))
      .onSet(this.setTargetHumidity.bind(this));

    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onGet(() => fanSpeedToHAP(this.state.fanSpeedSetting))
      .onSet(this.setFanSpeed.bind(this));

    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.WaterLevel)
      .onGet(() => waterLevelToHAP(this.state));

    this.dehumidifierService.getCharacteristic(this.platform.Characteristic.LockPhysicalControls)
      .onGet(this.getLockControls.bind(this))
      .onSet(this.setLockControls.bind(this));

    // FilterMaintenance service
    this.filterService = this.accessory.getService(this.platform.Service.FilterMaintenance)
      || this.accessory.addService(this.platform.Service.FilterMaintenance);

    this.filterService.getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(() => filterStateToHAP(this.state.filterState));

    // Link filter service to dehumidifier
    this.dehumidifierService.addLinkedService(this.filterService);
  }

  refreshState(state: DehumidifierState): void {
    this.state = state;

    const { Characteristic } = this.platform;

    this.dehumidifierService.updateCharacteristic(Characteristic.Active, this.activeValue());
    this.dehumidifierService.updateCharacteristic(Characteristic.CurrentHumidifierDehumidifierState, this.currentStateValue());
    this.dehumidifierService.updateCharacteristic(Characteristic.TargetHumidifierDehumidifierState, this.targetStateValue());
    this.dehumidifierService.updateCharacteristic(Characteristic.CurrentRelativeHumidity, state.sensorHumidity);
    this.dehumidifierService.updateCharacteristic(Characteristic.RelativeHumidityDehumidifierThreshold, this.clampHumidity(state.targetHumidity));
    this.dehumidifierService.updateCharacteristic(Characteristic.RotationSpeed, fanSpeedToHAP(state.fanSpeedSetting));
    this.dehumidifierService.updateCharacteristic(Characteristic.WaterLevel, waterLevelToHAP(state));
    this.dehumidifierService.updateCharacteristic(Characteristic.LockPhysicalControls, this.lockValue());

    this.filterService.updateCharacteristic(Characteristic.FilterChangeIndication, filterStateToHAP(state.filterState));

    this.modeGroup?.refresh(state);
  }

  // --- Getters ---

  private getActive(): CharacteristicValue {
    return this.activeValue();
  }

  private getCurrentState(): CharacteristicValue {
    return this.currentStateValue();
  }

  private getTargetState(): CharacteristicValue {
    return this.targetStateValue();
  }

  private getLockControls(): CharacteristicValue {
    return this.lockValue();
  }

  // --- Setters ---

  private async setActive(value: CharacteristicValue): Promise<void> {
    const applianceId = (this.accessory.context.device as Appliance).applianceId;
    const target = value === this.platform.Characteristic.Active.ACTIVE ? 'ON' : 'OFF';
    this.platform.log.info('Setting power to %s', target);
    try {
      await this.platform.client.sendCommand(applianceId, { executeCommand: target });
      this.dehumidifierService.updateCharacteristic(this.platform.Characteristic.Active, value);
    } catch (err) {
      this.platform.log.error('Failed to set power:', (err as Error).message);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async setTargetState(value: CharacteristicValue): Promise<void> {
    const applianceId = (this.accessory.context.device as Appliance).applianceId;
    const { Characteristic } = this.platform;
    const goingToAuto = value === Characteristic.TargetHumidifierDehumidifierState.HUMIDIFIER_OR_DEHUMIDIFIER;
    const targetMode = goingToAuto ? 'AUTO' : (this.modeGroup?.lastNonAutoMode() ?? 'DRY');
    const wasOff = this.state.applianceState?.toUpperCase() === 'OFF';
    this.platform.log.info('Setting mode to %s', targetMode);
    try {
      await this.platform.client.sendCommand(applianceId, { mode: modeToCommand(targetMode) });
      if (wasOff) {
        await this.platform.client.sendCommand(applianceId, { executeCommand: 'ON' });
      }
      this.dehumidifierService.updateCharacteristic(Characteristic.TargetHumidifierDehumidifierState, value);
    } catch (err) {
      this.platform.log.error('Failed to set mode:', (err as Error).message);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async setTargetHumidity(value: CharacteristicValue): Promise<void> {
    const applianceId = (this.accessory.context.device as Appliance).applianceId;
    const clamped = this.clampHumidity(Math.round((value as number) / 5) * 5);
    this.platform.log.info('Setting target humidity to %d%%', clamped);
    try {
      await this.platform.client.sendCommand(applianceId, { targetHumidity: clamped });
      this.dehumidifierService.updateCharacteristic(
        this.platform.Characteristic.RelativeHumidityDehumidifierThreshold,
        clamped,
      );
    } catch (err) {
      this.platform.log.error('Failed to set target humidity:', (err as Error).message);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async setFanSpeed(value: CharacteristicValue): Promise<void> {
    const applianceId = (this.accessory.context.device as Appliance).applianceId;
    const speed = hapToFanSpeed(value as number);
    this.platform.log.info('Setting fan speed to %s', speed);
    try {
      await this.platform.client.sendCommand(applianceId, { fanSpeedSetting: speed });
      this.dehumidifierService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, value);
    } catch (err) {
      this.platform.log.error('Failed to set fan speed:', (err as Error).message);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async setLockControls(value: CharacteristicValue): Promise<void> {
    const applianceId = (this.accessory.context.device as Appliance).applianceId;
    const lock = value === this.platform.Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED;
    this.platform.log.info('Setting UI lock to %s', lock);
    try {
      await this.platform.client.sendCommand(applianceId, { uiLockMode: lock });
      this.dehumidifierService.updateCharacteristic(this.platform.Characteristic.LockPhysicalControls, value);
    } catch (err) {
      this.platform.log.error('Failed to set UI lock:', (err as Error).message);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  // --- Value helpers ---

  private activeValue(): number {
    const { Characteristic } = this.platform;
    if (this.state.applianceState?.toUpperCase() === 'OFF') {
      return Characteristic.Active.INACTIVE;
    }
    return Characteristic.Active.ACTIVE;
  }

  private currentStateValue(): number {
    const { Characteristic } = this.platform;
    const kind = currentStateKind(this.state.applianceState, normalizeMode(this.state.mode));
    if (kind === 'INACTIVE') {
      return Characteristic.CurrentHumidifierDehumidifierState.INACTIVE;
    }
    if (kind === 'DEHUMIDIFYING') {
      return Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING;
    }
    return Characteristic.CurrentHumidifierDehumidifierState.IDLE;
  }

  private targetStateValue(): number {
    const { Characteristic } = this.platform;
    if (this.state.mode?.toUpperCase() === 'AUTO') {
      return Characteristic.TargetHumidifierDehumidifierState.HUMIDIFIER_OR_DEHUMIDIFIER;
    }
    return Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER;
  }

  private lockValue(): number {
    const { Characteristic } = this.platform;
    if (parseUILockMode(this.state.uiLockMode)) {
      return Characteristic.LockPhysicalControls.CONTROL_LOCK_ENABLED;
    }
    return Characteristic.LockPhysicalControls.CONTROL_LOCK_DISABLED;
  }

  private clampHumidity(value: number | undefined): number {
    if (!value || value < 35) {
      return 35;
    }
    if (value > 85) {
      return 85;
    }
    return value;
  }
}
