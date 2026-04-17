import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { FrigidaireDehumidifierPlatform } from '../platform.js';
import type { Appliance, DehumidifierState } from '../api/types.js';

export class AirPurifierAccessory {
  private service: Service;
  private state: DehumidifierState;

  constructor(
    private readonly platform: FrigidaireDehumidifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.state = (accessory.context.device as Appliance).properties.reported;

    this.service = this.accessory.getService('Air Purifier')
      || this.accessory.addService(this.platform.Service.AirPurifier, 'Air Purifier', 'air-purifier');

    // Only AUTO target state — device manages purifier mode
    this.service.getCharacteristic(this.platform.Characteristic.TargetAirPurifierState)
      .setProps({ validValues: [this.platform.Characteristic.TargetAirPurifierState.AUTO] });

    this.service.getCharacteristic(this.platform.Characteristic.Active)
      .onGet(this.getActive.bind(this))
      .onSet(this.setActive.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.CurrentAirPurifierState)
      .onGet(this.getCurrentState.bind(this));

    this.service.getCharacteristic(this.platform.Characteristic.TargetAirPurifierState)
      .onGet(() => this.platform.Characteristic.TargetAirPurifierState.AUTO);
  }

  refreshState(state: DehumidifierState): void {
    this.state = state;
    const { Characteristic } = this.platform;
    const isOn = state.cleanAirMode?.toUpperCase() === 'ON';

    this.service.updateCharacteristic(Characteristic.Active,
      isOn ? Characteristic.Active.ACTIVE : Characteristic.Active.INACTIVE);
    this.service.updateCharacteristic(Characteristic.CurrentAirPurifierState,
      isOn ? Characteristic.CurrentAirPurifierState.PURIFYING_AIR : Characteristic.CurrentAirPurifierState.INACTIVE);
  }

  private getActive(): CharacteristicValue {
    const { Characteristic } = this.platform;
    if (this.state.cleanAirMode?.toUpperCase() === 'ON') {
      return Characteristic.Active.ACTIVE;
    }
    return Characteristic.Active.INACTIVE;
  }

  private getCurrentState(): CharacteristicValue {
    const { Characteristic } = this.platform;
    if (this.state.cleanAirMode?.toUpperCase() === 'ON') {
      return Characteristic.CurrentAirPurifierState.PURIFYING_AIR;
    }
    return Characteristic.CurrentAirPurifierState.INACTIVE;
  }

  private async setActive(value: CharacteristicValue): Promise<void> {
    const applianceId = (this.accessory.context.device as Appliance).applianceId;
    const mode = value === this.platform.Characteristic.Active.ACTIVE ? 'on' : 'off';
    this.platform.log.info('Setting clean air mode to %s', mode);
    try {
      await this.platform.client.sendCommand(applianceId, { cleanAirMode: mode });
    } catch (err) {
      this.platform.log.error('Failed to set clean air mode:', (err as Error).message);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
