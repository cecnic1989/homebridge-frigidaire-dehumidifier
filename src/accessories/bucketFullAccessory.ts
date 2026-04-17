import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { FrigidaireDehumidifierPlatform } from '../platform.js';
import type { Appliance, DehumidifierState } from '../api/types.js';
import { isBucketFull } from '../utils/mappers.js';

export class BucketFullAccessory {
  private service: Service;
  private state: DehumidifierState;

  constructor(
    private readonly platform: FrigidaireDehumidifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.state = (accessory.context.device as Appliance).properties.reported;

    this.service = this.accessory.getService('Water Level')
      || this.accessory.addService(this.platform.Service.LeakSensor, 'Water Level', 'bucket-full');

    this.service.getCharacteristic(this.platform.Characteristic.LeakDetected)
      .onGet(this.getLeak.bind(this));
  }

  refreshState(state: DehumidifierState): void {
    this.state = state;
    this.service.updateCharacteristic(
      this.platform.Characteristic.LeakDetected,
      this.leakValue(),
    );
  }

  private getLeak(): CharacteristicValue {
    return this.leakValue();
  }

  private leakValue(): number {
    const { Characteristic } = this.platform;
    if (isBucketFull(this.state)) {
      return Characteristic.LeakDetected.LEAK_DETECTED;
    }
    return Characteristic.LeakDetected.LEAK_NOT_DETECTED;
  }
}
