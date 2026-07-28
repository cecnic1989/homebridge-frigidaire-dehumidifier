<p align="center">
  <img src="https://raw.githubusercontent.com/homebridge/branding/latest/logos/homebridge-color-round-stylized.png" width="150">
</p>

# homebridge-frigidaire-dehumidifier

[![npm version](https://img.shields.io/npm/v/@cecnic1989/homebridge-frigidaire-dehumidifier.svg)](https://www.npmjs.com/package/@cecnic1989/homebridge-frigidaire-dehumidifier)
[![Build and Lint](https://img.shields.io/github/actions/workflow/status/cecnic1989/homebridge-frigidaire-dehumidifier/build.yml?branch=latest)](https://github.com/cecnic1989/homebridge-frigidaire-dehumidifier/actions/workflows/build.yml)
[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=flat&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)

Homebridge plugin for Frigidaire / Electrolux smart dehumidifiers. Exposes your dehumidifier to Apple Home via the Electrolux OCP API (same backend the Frigidaire mobile app uses).

## Features

Each physical dehumidifier is split into multiple Home app tiles so each sensor and control can be individually named, moved between rooms, and used in HomeKit automations:

- **Dehumidifier** — power, target humidity, fan speed, child lock, filter indicator. The main tile's Auto/Dehumidify toggle mirrors the active mode.
- **Mode switches** — five Switch tiles (Auto, Dry, Quiet, Fan, Continuous) for explicit mode selection. Tapping one selects that mode and turns the unit on if it was off; tapping the active switch off powers the unit down. Disable via `showModeSwitches: false` in config.
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

Homebridge UI: **Plugins** → search `@cecnic1989/homebridge-frigidaire-dehumidifier`.

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
| `showModeSwitches` | `true` | Whether to expose mode-selection Switch tiles in HomeKit |

## Status

Stable and [verified by Homebridge](https://github.com/homebridge/homebridge/wiki/Verified-Plugins). Read and write operations are validated against real Frigidaire hardware.

## Support

Tested against Frigidaire Husky and DH series dehumidifiers. If your model isn't supported, or a control doesn't map correctly on your unit, [open an issue](https://github.com/cecnic1989/homebridge-frigidaire-dehumidifier/issues) with your model number and Homebridge debug logs (`homebridge -D`).

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, local testing, and design notes.

## Acknowledgements

Architecture inspired by [`haywirecoder/homebridge-frigidaire-dehumidifier`](https://github.com/haywirecoder/homebridge-frigidaire-dehumidifier) (archived). This plugin uses the current Electrolux OCP API rather than the deprecated Frigidaire v2 API the archived plugin targeted. As of July 2026 this plugin replaced the archived one on the Homebridge [verified plugins](https://github.com/homebridge/homebridge/wiki/Verified-Plugins) list.

## License

Apache-2.0
