# Contributing

## Prerequisites

- Node.js `^22.10.0 || ^24.0.0`
- A Frigidaire account with at least one connected dehumidifier

## Setup

```bash
git clone https://github.com/cecnic1989/homebridge-frigidaire-dehumidifier.git
cd homebridge-frigidaire-dehumidifier
npm install
```

Create your local dev config (used by both the smoke test and local Homebridge):

```bash
cp test/hbConfig/config.json.example test/hbConfig/config.json
```

Edit `test/hbConfig/config.json` — replace `YOUR_EMAIL_HERE` / `YOUR_PASSWORD_HERE`. This file is gitignored; only `.example` is tracked.

## API Smoke Test

Verifies auth + device discovery without Homebridge. Fast feedback loop.

```bash
npx tsx test/api-test.ts         # prints parsed state per device
npx tsx test/api-test.ts --raw   # also dumps raw API JSON (useful for new fields)
```

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
