# homebridge-frigidaire-dehumidifier

[![npm version](https://img.shields.io/npm/v/@cecnic1989/homebridge-frigidaire-dehumidifier.svg)](https://www.npmjs.com/package/@cecnic1989/homebridge-frigidaire-dehumidifier)
[![Build and Lint](https://img.shields.io/github/actions/workflow/status/cecnic1989/homebridge-frigidaire-dehumidifier/build.yml?branch=latest)](https://github.com/cecnic1989/homebridge-frigidaire-dehumidifier/actions/workflows/build.yml)

Homebridge plugin for Frigidaire / Electrolux smart dehumidifiers. Exposes your dehumidifier to Apple Home via the Electrolux OCP API (same backend the Frigidaire mobile app uses).

## Features

Each physical dehumidifier is split into multiple Home app tiles so each sensor and control can be individually named, moved between rooms, and used in HomeKit automations:

- **Dehumidifier** — power, mode (Auto / Dry / Continuous / Quiet), target humidity, fan speed, child lock, filter indicator
- **Humidity sensor** — room humidity
- **Temperature sensor** — ambient temperature (when reported by device)
- **Water bucket** — `LeakSensor` triggers when water tank fills (works on both Husky and DH models)
- **Air purifier** — clean air mode control (supported models only)
- **Condensate pump switch** — pump control (supported models only)

## Requirements

- Homebridge `^1.8.0` or `^2.0.0-beta.0`
- Node.js `^20.19.0 || ^22.10.0 || ^24.0.0`
- A Frigidaire account (same credentials as the Frigidaire mobile app)

## Installation

```bash
sudo npm install -g @cecnic1989/homebridge-frigidaire-dehumidifier
```

Or in the Homebridge UI: **Plugins** → search `@cecnic1989/homebridge-frigidaire-dehumidifier`.

## Configuration

Minimal config:

```json
{
  "platforms": [
    {
      "platform": "FrigidaireDehumidifier",
      "name": "Frigidaire Dehumidifier",
      "auth": {
        "username": "your@email.com",
        "password": "your-frigidaire-password"
      }
    }
  ]
}
```

All other fields optional — see table for defaults.

| Field | Default | Description |
|---|---|---|
| `auth.username` | required | Frigidaire account email |
| `auth.password` | required | Frigidaire account password |
| `pollInterval` | `90` | Poll interval in seconds (min 15, max 3600) |
| `dehumidifierMode` | `"DRY"` | Mode when HomeKit target set to dehumidifier — `DRY` / `CONTINUOUS` / `QUIET` |

## Status

Early release. Read operations (state, humidity, temperature, bucket level) are verified against real devices. Write operations (power, mode, fan speed, target humidity) send commands to the Electrolux command endpoint but are not yet fully validated — use at your own risk and report issues.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, local testing, and design notes.

## Acknowledgements

Architecture inspired by [`haywirecoder/homebridge-frigidaire-dehumidifier`](https://github.com/haywirecoder/homebridge-frigidaire-dehumidifier) (archived). This plugin uses the current Electrolux OCP API rather than the deprecated Frigidaire v2 API the archived plugin targeted.

## License

Apache-2.0
