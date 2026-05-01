# Contributing

## Prerequisites

- Node.js `^20.19.0 || ^22.10.0 || ^24.0.0`
- A Frigidaire account with at least one connected dehumidifier

## Setup

```bash
git clone https://github.com/cecnic1989/homebridge-frigidaire-dehumidifier.git
cd homebridge-frigidaire-dehumidifier
npm install
```

Create your local dev config (used by both the smoke tests and local Homebridge):

```bash
cp hbConfig/config.json.example hbConfig/config.json
```

Edit `hbConfig/config.json` — replace `YOUR_EMAIL_HERE` / `YOUR_PASSWORD_HERE`. This file is gitignored; only `.example` is tracked.

## Unit tests

```bash
npm test
```

Runs the `node:test` suites under `test/` (alert checker, mappers). No network or credentials required. CI runs this on every push and PR.

## API Smoke Test

Verifies auth + device discovery without Homebridge. Fast feedback loop.

```bash
npm run test:e2e:api          # prints parsed state per device
npm run test:e2e:api -- --raw # also dumps raw API JSON (useful for new fields)
```

## Command Test

Sends a write command to the first appliance and prints before/after state. Use when probing OCP payload shapes or verifying a setter works against a real device without going through HomeKit.

```bash
npm run test:e2e:command -- power on|off
npm run test:e2e:command -- mode AUTO|DRY|CONTINUOUS|QUIET
npm run test:e2e:command -- fan LOW|MIDDLE|HIGH|AUTO
npm run test:e2e:command -- lock on|off
npm run test:e2e:command -- humidity 45
npm run test:e2e:command -- raw '{"executeCommand":"OFF"}'        # arbitrary payload
npm run test:e2e:command -- --id <applianceId> power off          # multi-device accounts
```

## Notification Smoke Test

Drives the `bucket_full` alert through `AlertChecker → WebhookNotifier` and posts to ntfy. Set `NTFY_TOPIC` in a local `.env` file (gitignored), then:

```bash
npm run test:e2e:notifications
```

## Session caching

The API and command scripts cache the Electrolux session to `hbConfig/.session.json` (gitignored). Without it, each script run does a fresh login and Electrolux caps active sessions (`cas_3403 Too many active login context` → 429). With it, repeated runs reuse tokens and hit the refresh path on expiry.

Delete `.session.json` to force a full re-login.

## Local Homebridge Dev

Runs a real Homebridge instance. Auto-rebuilds on save.

```bash
npm run watch
```

Expect logs:

```
Logging in to Electrolux API...
Login successful.
Adding new accessory: Dehumidifier (Husky)
Polling every 30s
```

**Pair with iPhone (optional):** Home app → Add Accessory → "I Don't Have a Code" → enter `031-45-154`. iPhone must be on the same network.

## Design Notes

- **No runtime deps.** Native `fetch`, no supply-chain surface.
- **Platform owns polling.** Single timer pushes state into accessories via `refreshState()`.
- **Case-insensitive API values.** OCP returns `"running"` / `"on"` / `"yes"` in mixed case — comparators normalize with `.toUpperCase()`.
- **Two model families.** Husky reports `waterTankFull`; DH reports `waterBucketLevel`. Both handled. Optional services (air purifier, pump) skip when their field is absent.

## Style

- TypeScript strict; ESLint flat config
- Early returns over nested `if/else`
- Comments only when the **why** is non-obvious

Before committing:

```bash
npm run build && npm run lint
```

CI runs the same on every push.
