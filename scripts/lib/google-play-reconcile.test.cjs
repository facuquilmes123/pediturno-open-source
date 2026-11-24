const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { runGooglePlayReconciliation } = require('../google-play-reconcile.cjs');
const secret = 'synthetic-test-scheduler-secret-only';

test('scheduler CLI exits nonzero without sending a request when configuration is missing', () => {
  const result = spawnSync(process.execPath, [path.resolve(__dirname, '../google-play-reconcile.cjs')], {
    env: { ...process.env, GOOGLE_PLAY_RECONCILE_SECRET: '' }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.deepEqual(JSON.parse(result.stdout), { ok: false, alert: 'google_play_reconciliation_config_missing' });
  assert.equal(result.stderr, '');
});

test('does not send a request without a configured scheduler secret', async () => {
  let called = false;
  const result = await runGooglePlayReconciliation({ secret: '', fetchImpl: async () => { called = true; } });
  assert.equal(called, false);
  assert.equal(result.ok, false);
});

test('uses the fixed HTTPS endpoint, refuses redirects and emits only counters', async () => {
  const result = await runGooglePlayReconciliation({ secret, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://pediturno.com/api/google-play/reconcile');
    assert.equal(options.method, 'POST');
    assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    assert.ok(options.signal instanceof AbortSignal);
    return Response.json({ checked: 1, processed: 1, failed: 0, purchaseToken: 'synthetic-private-provider-data' });
  } });
  assert.deepEqual(result, { ok: true, checked: 1, processed: 1, failed: 0 });
});

test('reports partial failures even if a server returns HTTP 200', async () => {
  for (const status of [200, 503]) {
    const result = await runGooglePlayReconciliation({ secret, fetchImpl: async () => Response.json({ checked: 1, processed: 0, failed: 1 }, { status }) });
    assert.equal(result.ok, false);
    assert.equal(result.alert, 'google_play_reconciliation_failed');
    assert.equal(result.failed, 1);
  }
});

test('does not expose provider bodies, malformed replies or thrown credentials', async () => {
  for (const fetchImpl of [
    async () => Response.json({ error: secret }, { status: 401 }),
    async () => new Response('not-json', { status: 200 }),
    async () => { throw new Error(secret); },
  ]) {
    const result = await runGooglePlayReconciliation({ secret, fetchImpl });
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes(secret), false);
  }
});
