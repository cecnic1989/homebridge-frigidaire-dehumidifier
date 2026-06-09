import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { ElectroluxClient, type ElectroluxClientOptions, type SessionSnapshot } from '../src/api/electroluxClient.js';
import { silentLog } from './helpers.js';

const TEST_INTERVAL_MS = 40;
// Allow a couple ms of setTimeout rounding slack when asserting spacing.
const SPACING_FLOOR_MS = TEST_INTERVAL_MS - 2;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function snapshot(): SessionSnapshot {
  return {
    accessToken: 'tok',
    refreshToken: 'refresh',
    tokenExpiresAt: Date.now() + 3600_000,
    gigyaAPIKey: '',
    gigyaDomain: '',
    dataCenter: '',
    regionalBaseURL: 'https://api.test',
  };
}

interface RecordedCall {
  url: string;
  at: number;
}

type ResponseFactory = () => Response | Promise<Response>;

// Fake fetch that records each call and returns scripted responses (last one repeats).
function recordingFetch(responses: ResponseFactory[]): { calls: RecordedCall[]; fetchImpl: typeof fetch } {
  const calls: RecordedCall[] = [];
  const last = responses[responses.length - 1];
  const fetchImpl = (async (input: string | URL | Request) => {
    calls.push({ url: String(input), at: Date.now() });
    const factory = responses.shift() ?? last;
    return factory();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function makeClient(fetchImpl: typeof fetch, opts: ElectroluxClientOptions = {}): ElectroluxClient {
  const client = new ElectroluxClient('e@x.test', 'pw', silentLog, {
    fetch: fetchImpl,
    commandMinIntervalMs: TEST_INTERVAL_MS,
    commandJitterMs: 0,
    ...opts,
  });
  client.importSession(snapshot());
  return client;
}

const ok = () => new Response('{}', { status: 200 });
const status = (code: number, headers: Record<string, string> = {}) => () => new Response('err body', { status: code, headers });

describe('ElectroluxClient sendCommand throttle', () => {
  test('serializes concurrent commands FIFO with min spacing', async () => {
    const { calls, fetchImpl } = recordingFetch([ok]);
    const client = makeClient(fetchImpl);

    await Promise.all([
      client.sendCommand('a', { executeCommand: 'ON' }),
      client.sendCommand('b', { executeCommand: 'OFF' }),
      client.sendCommand('c', { executeCommand: 'ON' }),
    ]);

    assert.equal(calls.length, 3);
    assert.ok(calls[0].url.includes('/appliances/a/'));
    assert.ok(calls[1].url.includes('/appliances/b/'));
    assert.ok(calls[2].url.includes('/appliances/c/'));
    for (let i = 1; i < calls.length; i++) {
      const gap = calls[i].at - calls[i - 1].at;
      assert.ok(gap >= SPACING_FLOOR_MS, `expected >=${SPACING_FLOOR_MS}ms between commands, got ${gap}ms`);
    }
  });

  test('a failed command does not block subsequent commands', async () => {
    const { calls, fetchImpl } = recordingFetch([status(500), ok]);
    const client = makeClient(fetchImpl);

    const first = client.sendCommand('a', {});
    const second = client.sendCommand('b', {});

    await assert.rejects(first, /sendCommand HTTP 500/);
    await second;
    assert.equal(calls.length, 2);
  });

  test('retries 429 honouring Retry-After without re-authenticating', async () => {
    const { calls, fetchImpl } = recordingFetch([status(429, { 'Retry-After': '0' }), ok]);
    let loadSessionCalls = 0;
    const client = makeClient(fetchImpl, {
      loadSession: () => {
        loadSessionCalls++;
        return snapshot();
      },
    });

    await client.sendCommand('a', {});

    assert.equal(calls.length, 2);
    assert.equal(loadSessionCalls, 0, 'a 429 must never invalidate tokens / re-auth');
    assert.equal(client.exportSession().accessToken, 'tok');
    const gap = calls[1].at - calls[0].at;
    assert.ok(gap >= SPACING_FLOOR_MS, `429 retry must still respect spacing, got ${gap}ms`);
  });

  test('gives up after max attempts of 429', async () => {
    const { calls, fetchImpl } = recordingFetch([status(429, { 'Retry-After': '0' })]);
    const client = makeClient(fetchImpl);

    await assert.rejects(client.sendCommand('a', {}), /failed after 3 attempts.*429/);
    assert.equal(calls.length, 3);
  });

  test('fails fast on lockout-scale Retry-After and keeps the queue moving', async () => {
    const { calls, fetchImpl } = recordingFetch([status(429, { 'Retry-After': '4800' }), ok]);
    const client = makeClient(fetchImpl);

    const first = client.sendCommand('a', {});
    const second = client.sendCommand('b', {});

    await assert.rejects(first, /sendCommand HTTP 429/);
    await second;
    assert.equal(calls.length, 2);
  });

  test('re-authenticates once on 401 then succeeds', async () => {
    const { calls, fetchImpl } = recordingFetch([status(401), ok]);
    let loadSessionCalls = 0;
    const client = makeClient(fetchImpl, {
      loadSession: () => {
        loadSessionCalls++;
        return snapshot();
      },
    });

    await client.sendCommand('a', {});

    assert.equal(calls.length, 2);
    assert.equal(loadSessionCalls, 1);
  });

  test('does not retry 401 more than once', async () => {
    const { calls, fetchImpl } = recordingFetch([status(401)]);
    const client = makeClient(fetchImpl, { loadSession: () => snapshot() });

    await assert.rejects(client.sendCommand('a', {}), /sendCommand HTTP 401/);
    assert.equal(calls.length, 2);
  });

  test('getAppliances waits for an in-flight command (single request in flight)', async () => {
    const calls: RecordedCall[] = [];
    let commandDoneAt = 0;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = String(input);
      calls.push({ url, at: Date.now() });
      if (url.includes('/command')) {
        await delay(50);
        commandDoneAt = Date.now();
        return new Response('{}', { status: 200 });
      }
      return new Response('[]', { status: 200 });
    }) as typeof fetch;
    const client = makeClient(fetchImpl);

    const command = client.sendCommand('a', {});
    const poll = client.getAppliances();
    await Promise.all([command, poll]);

    assert.equal(calls.length, 2);
    assert.ok(calls[0].url.includes('/command'));
    assert.ok(calls[1].url.includes('includeMetadata'));
    assert.ok(calls[1].at >= commandDoneAt, 'poll fetch must wait for the in-flight command');
  });
});
