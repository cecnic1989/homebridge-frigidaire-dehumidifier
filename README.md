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

- **Dehumidifier** - power, target humidity, fan speed, child lock, filter indicator. The main tile's Auto/Dehumidify toggle mirrors the active mode.
- **Mode switches** - five Switch tiles (Auto, Dry, Quiet, Fan, Continuous) for explicit mode selection. Tapping one selects that mode and turns the unit on if it was off; tapping the active switch off powers the unit down. Disable via `showModeSwitches: false` in config.
- **Humidity sensor** - room humidity
- **Temperature sensor** - ambient temperature (when reported by device)
- **Water bucket** - `LeakSensor` triggers when the water tank fills
- **Air purifier** - clean air mode control (supported models only)
- **Condensate pump switch** - pump control (supported models only)

Optionally, the plugin can also send **phone notifications** when something needs attention - a full bucket, humidity climbing, a dirty filter. See [Notifications](#notifications).

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

Everything else is optional:

| Field | Default | Description |
|---|---|---|
| `auth.username` | required | Frigidaire account email |
| `auth.password` | required | Frigidaire account password |
| `pollInterval` | `90` | How often to check the device, in seconds (min 15, max 3600) |
| `showModeSwitches` | `true` | Whether to expose mode-selection Switch tiles in HomeKit |
| `notifications` | off | Phone alerts when something needs attention - see [Notifications](#notifications) |

The easiest way to set all of this is the Homebridge UI's settings form for the plugin, which lists every option with descriptions.

## Notifications

The plugin can watch your dehumidifier and send a notification to your phone when something looks wrong - the bucket fills up, humidity keeps climbing, the filter needs cleaning.

The simplest way to receive them is [ntfy.sh](https://ntfy.sh), a free notification service that needs no account:

1. Install the **ntfy** app on your phone (iOS or Android).
2. In the app, subscribe to a topic - any name you invent, for example `my-dehumidifier`. Pick something hard to guess, since anyone who knows the name can read your alerts.
3. In the plugin settings, turn on notifications and set the URL to `https://ntfy.sh/my-dehumidifier`.

```json
"notifications": {
  "enabled": true,
  "url": "https://ntfy.sh/my-dehumidifier"
}
```

That's it - alerts now arrive as phone notifications. Any service that accepts a web request works too, if you'd rather use something else.

### What it alerts on

| Alert | Sent when |
|---|---|
| `bucketFull` | The water tank is full |
| `highHumidity` | Room humidity goes above your threshold (default 60%) |
| `humiditySpike` | Humidity jumps suddenly - 15% or more in about 5 minutes |
| `humidityRising` | Humidity keeps climbing even though the unit is running |
| `notReachingTarget` | The unit hasn't reached your target humidity after an hour |
| `runningTooLong` | The unit has run non-stop for 12 hours |
| `frequentCycling` | The unit keeps switching itself on and off |
| `freezeWarning` | The room is cold enough (5°C / 41°F or below) to risk the coils icing |
| `filterDirty` | The filter needs cleaning or replacing |
| `deviceOff` | The unit turned off when you didn't expect it to |
| `deviceOffline` | The unit stopped responding |
| `apiError` | Frigidaire's servers are returning errors |

All are on by default once notifications are enabled. Turn any of them off individually under `notifications.alerts`, or adjust these:

| Field | Default | Description |
|---|---|---|
| `notifications.cooldownMinutes` | `60` | Minimum wait before repeating the same alert, so an ongoing problem doesn't flood your phone |
| `notifications.humidityThreshold` | `60` | The humidity percentage that triggers the high-humidity alert |
| `notifications.title` | `Dehumidifier Monitor` | The heading shown on the notification |
| `notifications.priority` | `high` | How insistently your phone announces it - `min`, `low`, `default`, `high`, or `max` |
| `notifications.tags` | `droplet` | Emoji shown next to the notification in ntfy |

Since `bucketFull` is also a HomeKit leak sensor, you may want to turn that one off to avoid being told twice.

## Status

Stable and [verified by Homebridge](https://github.com/homebridge/homebridge/wiki/Verified-Plugins). Read and write operations are validated against real Frigidaire hardware.

## Support

If your dehumidifier works with the Frigidaire mobile app, it should work here.

If your unit isn't picked up, or a control doesn't behave correctly on it, [open an issue](https://github.com/cecnic1989/homebridge-frigidaire-dehumidifier/issues) with your model number and Homebridge debug logs (`homebridge -D`).

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for setup, local testing, and design notes.

## Acknowledgements

Architecture inspired by [`haywirecoder/homebridge-frigidaire-dehumidifier`](https://github.com/haywirecoder/homebridge-frigidaire-dehumidifier) (archived). This plugin uses the current Electrolux OCP API rather than the deprecated Frigidaire v2 API the archived plugin targeted. As of July 2026 this plugin replaced the archived one on the Homebridge [verified plugins](https://github.com/homebridge/homebridge/wiki/Verified-Plugins) list.

## License

Apache-2.0
