import type { Logging } from 'homebridge';

import type { DehumidifierState } from '../api/types.js';
import type {
  Alert,
  AlertCheckerConfig,
  AlertEnabledMap,
  AlertState,
  AlertType,
  HumidityReading,
} from './types.js';

const HISTORY_TTL_MS = 2 * 60 * 60 * 1000;
const SPIKE_LOOKBACK_MS = 4 * 60 * 1000;
const SPIKE_DELTA = 15;
const RISING_WINDOW_MS = 30 * 60 * 1000;
const RISING_DELTA = 3;
const NOT_REACHING_RUN_MS = 60 * 60 * 1000;
const RUNNING_TOO_LONG_MS = 12 * 60 * 60 * 1000;
const CYCLING_WINDOW_MS = 60 * 60 * 1000;
const CYCLING_THRESHOLD = 6;
const FREEZE_TEMP_C = 5;

export interface AlertCheckerInput {
  reported: DehumidifierState;
  isOnline: boolean;
}

export class AlertChecker {
  constructor(
    private readonly config: AlertCheckerConfig,
    private readonly state: AlertState,
    private readonly log: Logging,
    private readonly persist: () => void,
  ) {}

  checkAppliance(input: AlertCheckerInput): Alert[] {
    const { reported, isOnline } = input;
    const currentPower = (reported.applianceState ?? '').toUpperCase();
    const isRunning = currentPower === 'RUNNING';
    const prevPower = this.state.previousPowerState ?? '';
    const mode = (reported.mode ?? '').toUpperCase();
    const now = Date.now();

    const alerts: Alert[] = [];

    this.checkBucket(alerts, reported);
    this.checkHumidity(alerts, reported);
    this.checkFilter(alerts, reported);
    this.checkUnexpectedOff(alerts, prevPower, currentPower);
    this.checkOffline(alerts, isOnline);

    this.recordHumidity(reported.sensorHumidity, isRunning, now);

    this.checkHumiditySpike(alerts, reported.sensorHumidity, now);
    this.checkHumidityRising(alerts, reported.sensorHumidity, isRunning, now);
    this.checkNotReachingTarget(alerts, reported, isRunning, mode, now);

    this.trackRunDuration(isRunning, now);
    this.checkRunningTooLong(alerts, isRunning, mode, now);

    this.trackPowerTransition(prevPower, currentPower, now);
    this.checkFrequentCycling(alerts, now);

    this.checkFreezeWarning(alerts, isRunning, reported);

    this.state.previousPowerState = currentPower;
    this.persist();
    return alerts;
  }

  checkAPIError(message: string): Alert[] {
    const alerts: Alert[] = [];
    this.maybeAlert(alerts, 'api_error', message);
    this.persist();
    return alerts;
  }

  // --- Individual alert checks ---

  private checkBucket(alerts: Alert[], s: DehumidifierState): void {
    if (!this.enabled('bucketFull')) {
      return;
    }
    const tankFull = (s.waterTankFull ?? '').toUpperCase() === 'YES';
    const bucketFull = (s.waterBucketLevel ?? 0) >= 100;
    if (!tankFull && !bucketFull) {
      return;
    }
    this.maybeAlert(alerts, 'bucket_full', 'DEHUMIDIFIER: Bucket is full. Please empty it.');
  }

  private checkHumidity(alerts: Alert[], s: DehumidifierState): void {
    if (!this.enabled('highHumidity')) {
      return;
    }
    if (s.sensorHumidity <= 0 || s.sensorHumidity <= this.config.humidityThreshold) {
      return;
    }
    this.maybeAlert(
      alerts,
      'high_humidity',
      `DEHUMIDIFIER: Humidity at ${s.sensorHumidity}% (threshold: ${this.config.humidityThreshold}%). Check basement.`,
    );
  }

  private checkFilter(alerts: Alert[], s: DehumidifierState): void {
    if (!this.enabled('filterDirty')) {
      return;
    }
    const status = (s.filterState ?? '').toUpperCase();
    if (status !== 'CLEAN' && status !== 'CHANGE' && status !== 'BUY') {
      return;
    }
    const messages: Record<string, string> = {
      CLEAN: 'DEHUMIDIFIER: Filter needs cleaning.',
      CHANGE: 'DEHUMIDIFIER: Filter needs to be changed.',
      BUY: 'DEHUMIDIFIER: Filter needs replacement — please order a new one.',
    };
    this.maybeAlert(alerts, 'filter_dirty', messages[status]);
  }

  private checkUnexpectedOff(alerts: Alert[], prevPower: string, currentPower: string): void {
    if (!this.enabled('deviceOff')) {
      return;
    }
    if (prevPower !== 'RUNNING' || currentPower !== 'OFF') {
      return;
    }
    this.maybeAlert(
      alerts,
      'device_off',
      'DEHUMIDIFIER: Unit turned off unexpectedly. May need attention.',
    );
  }

  private checkOffline(alerts: Alert[], isOnline: boolean): void {
    if (!this.enabled('deviceOffline')) {
      return;
    }
    if (isOnline) {
      return;
    }
    this.maybeAlert(
      alerts,
      'device_offline',
      'DEHUMIDIFIER: Device is offline. Check WiFi or power.',
    );
  }

  private checkHumiditySpike(alerts: Alert[], currentHumidity: number, now: number): void {
    if (!this.enabled('humiditySpike') || currentHumidity <= 0) {
      return;
    }
    const cutoff = now - SPIKE_LOOKBACK_MS;
    // Most recent reading older than the lookback window (excluding the just-recorded one).
    let prev: HumidityReading | undefined;
    for (let i = this.state.humidityHistory.length - 2; i >= 0; i--) {
      const r = this.state.humidityHistory[i];
      if (r.time <= cutoff) {
        prev = r;
        break;
      }
    }
    if (!prev || prev.humidity <= 0) {
      return;
    }
    const jump = currentHumidity - prev.humidity;
    if (jump < SPIKE_DELTA) {
      return;
    }
    this.maybeAlert(
      alerts,
      'humidity_spike',
      `DEHUMIDIFIER: Humidity spiked +${jump}% (from ${prev.humidity}% to ${currentHumidity}%). Possible water event.`,
    );
  }

  private checkHumidityRising(
    alerts: Alert[],
    currentHumidity: number,
    isRunning: boolean,
    now: number,
  ): void {
    if (!this.enabled('humidityRising') || !isRunning) {
      return;
    }
    const cutoff = now - RISING_WINDOW_MS;
    // Most recent reading older than the window — closest to "30 min ago".
    // History is oldest-first, so walk backwards to find the newest match.
    let old: HumidityReading | undefined;
    for (let i = this.state.humidityHistory.length - 1; i >= 0; i--) {
      const r = this.state.humidityHistory[i];
      if (r.time <= cutoff) {
        old = r;
        break;
      }
    }
    if (!old || old.humidity <= 0) {
      return;
    }
    if (currentHumidity - old.humidity < RISING_DELTA) {
      return;
    }
    this.maybeAlert(
      alerts,
      'humidity_rising',
      `DEHUMIDIFIER: Humidity rising to ${currentHumidity}% despite unit running. Check for open doors/windows.`,
    );
  }

  private checkNotReachingTarget(
    alerts: Alert[],
    s: DehumidifierState,
    isRunning: boolean,
    mode: string,
    now: number,
  ): void {
    if (!this.enabled('notReachingTarget') || !isRunning) {
      return;
    }
    if (mode === 'CONTINUOUS') {
      return;
    }
    if (s.sensorHumidity <= s.targetHumidity) {
      return;
    }
    if (this.state.runningSince === undefined || now - this.state.runningSince < NOT_REACHING_RUN_MS) {
      return;
    }
    this.maybeAlert(
      alerts,
      'not_reaching_target',
      `DEHUMIDIFIER: Running 1+ hour but humidity at ${s.sensorHumidity}% (target: ${s.targetHumidity}%). Unit may be struggling.`,
    );
  }

  private checkRunningTooLong(alerts: Alert[], isRunning: boolean, mode: string, now: number): void {
    if (!this.enabled('runningTooLong') || !isRunning) {
      return;
    }
    if (mode === 'CONTINUOUS') {
      return;
    }
    if (this.state.runningSince === undefined) {
      return;
    }
    const runDuration = now - this.state.runningSince;
    if (runDuration < RUNNING_TOO_LONG_MS) {
      return;
    }
    const hours = Math.round(runDuration / (60 * 60 * 1000));
    this.maybeAlert(
      alerts,
      'running_too_long',
      `DEHUMIDIFIER: Running continuously for ~${hours}h. Check if this is expected.`,
    );
  }

  private checkFrequentCycling(alerts: Alert[], now: number): void {
    if (!this.enabled('frequentCycling')) {
      return;
    }
    const cutoff = now - CYCLING_WINDOW_MS;
    const count = this.state.powerTransitions.filter((t) => t > cutoff).length;
    if (count < CYCLING_THRESHOLD) {
      return;
    }
    this.maybeAlert(
      alerts,
      'frequent_cycling',
      'DEHUMIDIFIER: Unit cycling on/off frequently. May indicate a problem.',
    );
  }

  private checkFreezeWarning(alerts: Alert[], isRunning: boolean, s: DehumidifierState): void {
    if (!this.enabled('freezeWarning') || !isRunning) {
      return;
    }
    if (s.ambientTemperatureC === undefined || s.ambientTemperatureC === null) {
      return;
    }
    if (s.ambientTemperatureC > FREEZE_TEMP_C) {
      return;
    }
    const tempF = Math.round((s.ambientTemperatureC * 9) / 5 + 32);
    this.maybeAlert(
      alerts,
      'freeze_warning',
      `DEHUMIDIFIER: Ambient temperature is ${tempF}°F. Running near freezing can damage the compressor.`,
    );
  }

  // --- State tracking helpers ---

  private recordHumidity(humidity: number, running: boolean, now: number): void {
    this.state.humidityHistory.push({ humidity, running, time: now });
    const cutoff = now - HISTORY_TTL_MS;
    this.state.humidityHistory = this.state.humidityHistory.filter((r) => r.time > cutoff);
  }

  private trackRunDuration(isRunning: boolean, now: number): void {
    if (!isRunning) {
      this.state.runningSince = undefined;
      return;
    }
    if (this.state.runningSince === undefined) {
      this.state.runningSince = now;
    }
  }

  private trackPowerTransition(prevPower: string, currentPower: string, now: number): void {
    if (prevPower === '' || prevPower === currentPower) {
      return;
    }
    this.state.powerTransitions.push(now);
    const cutoff = now - CYCLING_WINDOW_MS;
    this.state.powerTransitions = this.state.powerTransitions.filter((t) => t > cutoff);
  }

  // --- Cooldown ---

  private maybeAlert(alerts: Alert[], type: AlertType, message: string): void {
    const lastSent = this.state.lastSent[type];
    if (lastSent !== undefined && Date.now() - lastSent < this.config.cooldownMs) {
      return;
    }
    this.state.lastSent[type] = Date.now();
    alerts.push({ type, message });
    this.log.info('ALERT [%s]: %s', type, message);
  }

  private enabled(key: keyof AlertEnabledMap): boolean {
    return this.config.alerts[key] !== false;
  }
}
