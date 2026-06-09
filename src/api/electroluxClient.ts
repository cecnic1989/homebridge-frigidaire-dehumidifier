import type { Logging } from 'homebridge';

import { BASE_API_URL, FRIGIDAIRE_API_KEY, FRIGIDAIRE_CLIENT_ID, FRIGIDAIRE_CLIENT_SECRET } from './constants.js';
import type { Appliance } from './types.js';

const MAX_ATTEMPTS = 3;
const COMMAND_MAX_ATTEMPTS = 3;
const COMMAND_MIN_INTERVAL_MS = 1250;
const COMMAND_JITTER_MS = 250;
const COMMAND_MAX_RETRY_AFTER_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface SessionSnapshot {
  accessToken: string;
  refreshToken: string;
  tokenExpiresAt: number;
  gigyaAPIKey: string;
  gigyaDomain: string;
  dataCenter: string;
  regionalBaseURL: string;
}

export interface ElectroluxClientOptions {
  loadSession?: () => SessionSnapshot | undefined;
  onSessionUpdate?: (snapshot: SessionSnapshot) => void;
  fetch?: typeof fetch;
  commandMinIntervalMs?: number;
  commandJitterMs?: number;
}

export class ElectroluxClient {
  private appToken = '';
  private accessToken = '';
  private refreshToken = '';
  private tokenExpiresAt = 0;
  private gigyaAPIKey = '';
  private gigyaDomain = '';
  private dataCenter = '';
  private regionalBaseURL = '';
  private authPromise: Promise<void> | null = null;
  private requestChain: Promise<void> = Promise.resolve();
  private lastCommandAt = 0;

  constructor(
    private readonly email: string,
    private readonly password: string,
    private readonly log: Logging,
    private readonly options: ElectroluxClientOptions = {},
  ) {}

  private notifySessionUpdate(): void {
    if (!this.options.onSessionUpdate) {
      return;
    }
    try {
      this.options.onSessionUpdate(this.exportSession());
    } catch (err) {
      this.log.warn('onSessionUpdate failed: %s', (err as Error).message);
    }
  }

  async login(): Promise<void> {
    this.log.info('Logging in to Electrolux API...');
    await this.getAppToken();
    await this.discoverEndpoints();
    await this.authenticate();
    this.log.info('Login successful.');
  }

  exportSession(): SessionSnapshot {
    return {
      accessToken: this.accessToken,
      refreshToken: this.refreshToken,
      tokenExpiresAt: this.tokenExpiresAt,
      gigyaAPIKey: this.gigyaAPIKey,
      gigyaDomain: this.gigyaDomain,
      dataCenter: this.dataCenter,
      regionalBaseURL: this.regionalBaseURL,
    };
  }

  importSession(snap: SessionSnapshot): void {
    Object.assign(this, snap);
  }

  async ensureAuth(): Promise<void> {
    if (this.authPromise) {
      return this.authPromise;
    }

    if (!this.accessToken && this.options.loadSession) {
      try {
        const snap = this.options.loadSession();
        if (snap?.accessToken) {
          this.importSession(snap);
          this.log.info('Restored Electrolux session from cache.');
        }
      } catch (err) {
        this.log.warn('Failed to load cached session: %s', (err as Error).message);
      }
    }

    if (!this.accessToken) {
      this.authPromise = this.login().finally(() => this.authPromise = null);
      return this.authPromise;
    }

    if (Date.now() < this.tokenExpiresAt) {
      return;
    }

    this.log.info('Access token expired, refreshing...');
    this.authPromise = this.doRefreshToken()
      .catch(async (err) => {
        this.log.warn('Token refresh failed: %s, re-authenticating...', err);
        await this.login();
      })
      .finally(() => this.authPromise = null);
    return this.authPromise;
  }

  private invalidateTokens(): void {
    this.accessToken = '';
    this.tokenExpiresAt = 0;
  }

  // Serializes appliance API calls so only one request is in flight at a time.
  // The promise chain is the queue: each caller chains onto the current tail (FIFO).
  private withRequestLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.requestChain.then(fn);
    this.requestChain = run.then(() => undefined, () => undefined);
    return run;
  }

  async getAppliances(): Promise<Appliance[]> {
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      await this.ensureAuth();

      const url = `${this.regionalBaseURL}/appliance/api/v2/appliances?includeMetadata=true`;
      let resp: Response;
      try {
        resp = await this.withRequestLock(() => (this.options.fetch ?? fetch)(url, {
          headers: this.authHeaders(),
        }));
      } catch (err) {
        lastErr = err as Error;
        const backoff = (1 << attempt) * 1000;
        this.log.warn('Network error (attempt %d/%d): %s, retrying in %ds...', attempt + 1, MAX_ATTEMPTS, err, backoff / 1000);
        await sleep(backoff);
        continue;
      }

      if (resp.ok) {
        return await resp.json() as Appliance[];
      }

      const body = await resp.text();
      lastErr = new Error(`HTTP ${resp.status}: ${body}`);

      if (resp.status === 401) {
        this.log.warn('Got 401 (attempt %d/%d), re-authenticating...', attempt + 1, MAX_ATTEMPTS);
        this.invalidateTokens();
        continue;
      }

      if (resp.status === 429) {
        const ra = resp.headers.get('Retry-After');
        const wait = ra ? parseInt(ra, 10) * 1000 : 5000;
        this.log.warn('Rate limited (attempt %d/%d), waiting %ds...', attempt + 1, MAX_ATTEMPTS, wait / 1000);
        await sleep(wait);
        continue;
      }

      if (resp.status >= 500) {
        const backoff = (1 << attempt) * 1000;
        this.log.warn('Server error %d (attempt %d/%d), retrying in %ds...', resp.status, attempt + 1, MAX_ATTEMPTS, backoff / 1000);
        await sleep(backoff);
        continue;
      }

      throw lastErr;
    }

    throw new Error(`getAppliances failed after ${MAX_ATTEMPTS} attempts: ${lastErr?.message}`);
  }

  async sendCommand(applianceId: string, command: Record<string, unknown>): Promise<void> {
    return this.withRequestLock(() => this.doSendCommand(applianceId, command));
  }

  // Electrolux locks accounts that send commands too quickly (cas_3403, lockouts of
  // 1h20m-12h), so each command waits for 1.25s ±0.25s jitter since the previous one.
  private async waitForCommandSlot(): Promise<void> {
    const minInterval = this.options.commandMinIntervalMs ?? COMMAND_MIN_INTERVAL_MS;
    const jitterMs = this.options.commandJitterMs ?? COMMAND_JITTER_MS;
    const jitter = (Math.random() * 2 - 1) * jitterMs;
    const wait = Math.max(0, this.lastCommandAt + minInterval + jitter - Date.now());
    if (wait > 0) {
      await sleep(wait);
    }
  }

  private async doSendCommand(applianceId: string, command: Record<string, unknown>): Promise<void> {
    let reauthed = false;
    let lastErr: Error | null = null;

    for (let attempt = 0; attempt < COMMAND_MAX_ATTEMPTS; attempt++) {
      await this.ensureAuth();
      await this.waitForCommandSlot();
      this.lastCommandAt = Date.now();

      const url = `${this.regionalBaseURL}/appliance/api/v2/appliances/${applianceId}/command`;
      const resp = await (this.options.fetch ?? fetch)(url, {
        method: 'PUT',
        headers: this.authHeaders(),
        body: JSON.stringify(command),
      });

      if (resp.ok) {
        return;
      }

      const body = await resp.text();
      lastErr = new Error(`sendCommand HTTP ${resp.status}: ${body}`);

      if (resp.status === 401 && !reauthed) {
        reauthed = true;
        this.log.warn('sendCommand got 401, re-authenticating...');
        this.invalidateTokens();
        continue;
      }

      if (resp.status === 429) {
        // Never re-auth here: upstream documents that re-auth extends the lockout.
        const ra = resp.headers.get('Retry-After');
        const parsed = ra ? parseInt(ra, 10) * 1000 : 5000;
        const wait = Number.isFinite(parsed) ? parsed : 5000;
        if (wait > COMMAND_MAX_RETRY_AFTER_MS) {
          // Lockout-scale Retry-After: fail fast instead of blocking queued commands.
          this.log.warn('sendCommand rate limited with Retry-After %ds, giving up.', wait / 1000);
          throw lastErr;
        }
        this.log.warn('sendCommand rate limited (attempt %d/%d), waiting %ds...', attempt + 1, COMMAND_MAX_ATTEMPTS, wait / 1000);
        await sleep(wait);
        continue;
      }

      throw lastErr;
    }

    throw new Error(`sendCommand failed after ${COMMAND_MAX_ATTEMPTS} attempts: ${lastErr?.message}`);
  }

  // --- Internal auth methods ---

  private async getAppToken(): Promise<void> {
    const resp = await fetch(`${BASE_API_URL}/one-account-authorization/api/v1/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'x-api-key': FRIGIDAIRE_API_KEY,
      },
      body: JSON.stringify({
        grantType: 'client_credentials',
        clientId: FRIGIDAIRE_CLIENT_ID,
        clientSecret: FRIGIDAIRE_CLIENT_SECRET,
        scope: '',
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`getAppToken: HTTP ${resp.status}: ${body}`);
    }

    const data = await resp.json() as { accessToken: string };
    this.appToken = data.accessToken;
  }

  private async discoverEndpoints(): Promise<void> {
    const resp = await fetch(
      `${BASE_API_URL}/one-account-user/api/v1/identity-providers?brand=frigidaire&countryCode=US`,
      {
        headers: {
          'Accept': 'application/json',
          'x-api-key': FRIGIDAIRE_API_KEY,
          'Authorization': `Bearer ${this.appToken}`,
        },
      },
    );

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`discoverEndpoints: HTTP ${resp.status}: ${body}`);
    }

    const providers = await resp.json() as Array<{
      apiKey: string;
      domain: string;
      dataCenter: string;
      httpRegionalBaseUrl: string;
    }>;

    if (providers.length === 0) {
      throw new Error('No identity providers found');
    }

    this.gigyaAPIKey = providers[0].apiKey;
    this.gigyaDomain = providers[0].domain;
    this.dataCenter = providers[0].dataCenter;
    this.regionalBaseURL = providers[0].httpRegionalBaseUrl;
  }

  private async authenticate(): Promise<void> {
    const idToken = await this.gigyaLogin();
    await this.exchangeToken(idToken);
  }

  private async gigyaLogin(): Promise<string> {
    const loginURL = `https://accounts.${this.gigyaDomain}/accounts.login`;

    const params = new URLSearchParams({
      apikey: this.gigyaAPIKey,
      format: 'json',
      httpStatusCodes: 'false',
      include: 'id_token',
      loginID: this.email,
      password: this.password,
      targetEnv: 'mobile',
    });

    const resp = await fetch(loginURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`gigyaLogin: HTTP ${resp.status}: ${body}`);
    }

    const data = await resp.json() as {
      errorCode: number;
      errorMessage: string;
      id_token: string;
    };

    if (data.errorCode !== 0) {
      throw new Error(`Gigya error ${data.errorCode}: ${data.errorMessage}`);
    }

    if (!data.id_token) {
      throw new Error('No id_token in Gigya response');
    }

    return data.id_token;
  }

  private async exchangeToken(idToken: string): Promise<void> {
    const resp = await fetch(
      `${this.regionalBaseURL}/one-account-authorization/api/v1/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': FRIGIDAIRE_API_KEY,
          'Origin-Country-Code': this.dataCenter,
        },
        body: JSON.stringify({
          grantType: 'urn:ietf:params:oauth:grant-type:token-exchange',
          clientId: FRIGIDAIRE_CLIENT_ID,
          idToken,
          scope: '',
        }),
      },
    );

    if (!resp.ok) {
      const body = await resp.text();
      // platform.ts greps this message for `cas_3403` to trigger long backoff.
      // Keep the raw body in the thrown error.
      throw new Error(`exchangeToken: HTTP ${resp.status}: ${body}`);
    }

    const data = await resp.json() as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    };

    this.accessToken = data.accessToken;
    this.refreshToken = data.refreshToken;
    this.tokenExpiresAt = Date.now() + data.expiresIn * 1000;
    this.notifySessionUpdate();
  }

  private async doRefreshToken(): Promise<void> {
    const resp = await fetch(
      `${this.regionalBaseURL}/one-account-authorization/api/v1/token`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': FRIGIDAIRE_API_KEY,
          'Origin-Country-Code': this.dataCenter,
        },
        body: JSON.stringify({
          grantType: 'refresh_token',
          clientId: FRIGIDAIRE_CLIENT_ID,
          refreshToken: this.refreshToken,
          scope: '',
        }),
      },
    );

    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`doRefreshToken: HTTP ${resp.status}: ${body}`);
    }

    const data = await resp.json() as {
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
    };

    this.accessToken = data.accessToken;
    if (data.refreshToken) {
      this.refreshToken = data.refreshToken;
    }
    this.tokenExpiresAt = Date.now() + data.expiresIn * 1000;
    this.notifySessionUpdate();
  }

  private authHeaders(): Record<string, string> {
    return {
      'User-Agent': 'Ktor client',
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'x-api-key': FRIGIDAIRE_API_KEY,
      'Authorization': `Bearer ${this.accessToken}`,
    };
  }
}
