import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { FrigidaireDehumidifierPlatform } from '../platform.js';
import type { Appliance, DehumidifierState } from '../api/types.js';

export class TemperatureSensorAccessory {
  private service: Service;
  private state: DehumidifierState;

  constructor(
    private readonly platform: FrigidaireDehumidifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.state = (accessory.context.device as Appliance).properties.reported;

    this.service = this.accessory.getService('Temperature')
      || this.accessory.addService(this.platform.Service.TemperatureSensor, 'Temperature', 'temperature-sensor');

    this.service.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getTemperature.bind(this));
  }

  refreshState(state: DehumidifierState): void {
    this.state = state;
    if (state.ambientTemperatureC !== undefined && state.ambientTemperatureC !== null) {
      this.service.updateCharacteristic(
        this.platform.Characteristic.CurrentTemperature,
        state.ambientTemperatureC,
      );
    }
  }

  private getTemperature(): CharacteristicValue {
    if (this.state.ambientTemperatureC === undefined || this.state.ambientTemperatureC === null) {
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.RESOURCE_DOES_NOT_EXIST);
    }
    return this.state.ambientTemperatureC;
  }
}
