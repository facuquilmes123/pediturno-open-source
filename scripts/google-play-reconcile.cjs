// Run with the scheduler's managed environment. Never pass the secret in argv.
const ENDPOINT = 'https://pediturno.com/api/google-play/reconcile';

async function runGooglePlayReconciliation({ secret = process.env.GOOGLE_PLAY_RECONCILE_SECRET, fetchImpl = globalThis.fetch } = {}) {
  if (typeof secret !== 'string' || secret.length < 24 || /[\r\n]/.test(secret)) {
    return { ok: false, alert: 'google_play_reconciliation_config_missing' };
  }
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45_000),
      headers: { Authorization: `Bearer ${secret}`, Accept: 'application/json' },
    });
    const result = await response.json().catch(() => null);
    const counters = {};
    for (const key of ['checked', 'processed', 'failed']) {
      if (Number.isSafeInteger(result?.[key]) && result[key] >= 0) counters[key] = result[key];
    }
    const complete = Object.keys(counters).length === 3;
    if (!response.ok || !complete || counters.failed !== 0) {
      return { ok: false, alert: 'google_play_reconciliation_failed', httpStatus: response.status, ...counters };
    }
    return { ok: true, ...counters };
  } catch {
    // Do not expose fetch errors: they can retain headers and provider context.
    return { ok: false, alert: 'google_play_reconciliation_network_or_timeout' };
  }
}

if (require.main === module) {
  runGooglePlayReconciliation().then(result => {
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exitCode = result.ok ? 0 : 1;
  });
}

module.exports = { runGooglePlayReconciliation };
