import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { FrigidaireDehumidifierPlatform } from '../platform.js';
import type { Appliance, DehumidifierState } from '../api/types.js';

export class PumpSwitchAccessory {
  private service: Service;
  private state: DehumidifierState;

  constructor(
    private readonly platform: FrigidaireDehumidifierPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.state = (accessory.context.device as Appliance).properties.reported;

    this.service = this.accessory.getService('Condensate Pump')
      || this.accessory.addService(this.platform.Service.Switch, 'Condensate Pump', 'condensate-pump');

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getOn.bind(this))
      .onSet(this.setOn.bind(this));
  }

  refreshState(state: DehumidifierState): void {
    this.state = state;
    this.service.updateCharacteristic(
      this.platform.Characteristic.On,
      state.condensatePump?.toUpperCase() === 'ON',
    );
  }

  private getOn(): CharacteristicValue {
    return this.state.condensatePump?.toUpperCase() === 'ON';
  }

  private async setOn(value: CharacteristicValue): Promise<void> {
    const applianceId = (this.accessory.context.device as Appliance).applianceId;
    const pump = value ? 'on' : 'off';
    this.platform.log.info('Setting condensate pump to %s', pump);
    try {
      await this.platform.client.sendCommand(applianceId, { condensatePump: pump });
    } catch (err) {
      this.platform.log.error('Failed to set condensate pump:', (err as Error).message);
      throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
