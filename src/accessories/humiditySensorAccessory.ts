import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { FrigidaireDehumidifierPlatform } from '../platform.js';
import type { Appliance, DehumidifierState } from '../api/types.js';

export class HumiditySensorAccessory {
  private service: Service;
  private state: DehumidifierState;

  constructor(
    private readonly platform: FrigidaireDehumidifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.state = (accessory.context.device as Appliance).properties.reported;

    this.service = this.accessory.getService('Humidity')
      || this.accessory.addService(this.platform.Service.HumiditySensor, 'Humidity', 'humidity-sensor');

    this.service.getCharacteristic(this.platform.Characteristic.CurrentRelativeHumidity)
      .onGet(this.getHumidity.bind(this));
  }

  refreshState(state: DehumidifierState): void {
    this.state = state;
    this.service.updateCharacteristic(
      this.platform.Characteristic.CurrentRelativeHumidity,
      state.sensorHumidity,
    );
  }

  private getHumidity(): CharacteristicValue {
    return this.state.sensorHumidity;
  }
}
