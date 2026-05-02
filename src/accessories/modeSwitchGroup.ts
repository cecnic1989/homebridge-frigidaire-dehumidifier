import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { FrigidaireDehumidifierPlatform } from '../platform.js';
import type { Appliance, DehumidifierState } from '../api/types.js';
import {
  ALL_MODES,
  computeSwitchStates,
  modeToCommand,
  normalizeMode,
  planSwitchTap,
  type DehumMode,
  type SwitchAction,
} from '../utils/mappers.js';

const MODE_LABELS: Record<DehumMode, string> = {
  AUTO: 'Auto',
  DRY: 'Dry',
  QUIET: 'Quiet',
  FANONLY: 'Fan',
  CONTINUOUS: 'Continuous',
};

const SUBTYPE_PREFIX = 'mode-';

function subtypeFor(mode: DehumMode): string {
  return `${SUBTYPE_PREFIX}${mode.toLowerCase()}`;
}

export class ModeSwitchGroup {
  private readonly services: Map<DehumMode, Service> = new Map();
  private currentMode: DehumMode | undefined;
  private isPoweredOn = false;
  private lastNonAuto: DehumMode = 'DRY';

  constructor(
    private readonly platform: FrigidaireDehumidifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    const device = accessory.context.device as Appliance;
    const baseName = device.applianceData.applianceName;

    for (const mode of ALL_MODES) {
      this.services.set(mode, this.registerSwitch(mode, baseName));
    }

    this.refresh(device.properties.reported);
  }

  refresh(state: DehumidifierState): void {
    this.currentMode = normalizeMode(state.mode);
    this.isPoweredOn = (state.applianceState ?? '').toUpperCase() !== 'OFF';
    if (this.currentMode && this.currentMode !== 'AUTO') {
      this.lastNonAuto = this.currentMode;
    }
    this.applySwitchStates();
  }

  lastNonAutoMode(): DehumMode {
    return this.lastNonAuto;
  }

  static cleanup(accessory: PlatformAccessory): void {
    // Iterate a snapshot — removeService mutates the underlying list.
    const stale = accessory.services.filter((s) => s.subtype?.startsWith(SUBTYPE_PREFIX));
    for (const svc of stale) {
      accessory.removeService(svc);
    }
  }

  // --- internals ---

  private registerSwitch(mode: DehumMode, baseName: string): Service {
    const subtype = subtypeFor(mode);
    const displayName = `${baseName} ${MODE_LABELS[mode]}`;
    const service = this.accessory.getServiceById(this.platform.Service.Switch, subtype)
      ?? this.accessory.addService(this.platform.Service.Switch, displayName, subtype);

    service.setCharacteristic(this.platform.Characteristic.Name, displayName);
    service.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName);
    service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(() => this.switchValue(mode))
      .onSet((v) => this.handleTap(mode, v));
    return service;
  }

  private switchValue(mode: DehumMode): boolean {
    return computeSwitchStates(this.currentMode, this.isPoweredOn)[mode];
  }

  private async handleTap(mode: DehumMode, value: CharacteristicValue): Promise<void> {
    const action: SwitchAction = value
      ? { kind: 'setOn', mode }
      : { kind: 'setOff', mode };
    const effect = planSwitchTap(this.currentMode, this.isPoweredOn, action);

    if (effect.kind === 'noop') {
      // HomeKit may have pushed a stale value — re-assert authoritative state.
      this.applySwitchStates();
      return;
    }

    if (effect.kind === 'powerOff') {
      await this.dispatchPowerOff();
      return;
    }

    await this.dispatchSetMode(effect.mode, effect.alsoPowerOn);
  }

  private async dispatchPowerOff(): Promise<void> {
    const applianceId = (this.accessory.context.device as Appliance).applianceId;
    try {
      await this.platform.client.sendCommand(applianceId, { executeCommand: 'OFF' });
    } catch (err) {
      this.platform.log.error('Failed to power off via mode switch:', (err as Error).message);
      this.applySwitchStates();
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
    this.isPoweredOn = false;
    this.applySwitchStates();
  }

  private async dispatchSetMode(mode: DehumMode, alsoPowerOn: boolean): Promise<void> {
    const applianceId = (this.accessory.context.device as Appliance).applianceId;
    try {
      await this.platform.client.sendCommand(applianceId, { mode: modeToCommand(mode) });
      if (alsoPowerOn) {
        await this.platform.client.sendCommand(applianceId, { executeCommand: 'ON' });
      }
    } catch (err) {
      this.platform.log.error('Failed to set mode via switch:', (err as Error).message);
      this.applySwitchStates();
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
    this.currentMode = mode;
    this.isPoweredOn = true;
    if (mode !== 'AUTO') {
      this.lastNonAuto = mode;
    }
    this.applySwitchStates();
  }

  private applySwitchStates(): void {
    const states = computeSwitchStates(this.currentMode, this.isPoweredOn);
    for (const [mode, service] of this.services) {
      service.updateCharacteristic(this.platform.Characteristic.On, states[mode]);
    }
  }
}
