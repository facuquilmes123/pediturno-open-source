// Private operator bridge. Fixed destination; credentials only from the existing environment.
// Feed a provider aggregate via stdin; never put CRON_SECRET or email credentials in argv.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; if (input.length > 2048) process.exit(2); });
process.stdin.on('end', async () => {
  try {
    if (!process.env.CRON_SECRET || process.env.CRON_SECRET.length < 24 || process.env.FIREBASE_PROJECT_ID !== 'pediturno-app') throw Error();
    const payload = JSON.parse(input);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).some(k => !['observation', 'test'].includes(k))) throw Error();
    const response = await fetch('https://pediturno.com/api/cron/email-usage', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + process.env.CRON_SECRET }, body: JSON.stringify(payload),
    });
    const result = await response.json();
    const safe = { at: new Date().toISOString(), http: response.status };
    for (const key of ['alert', 'test', 'usageEstimate', 'appAcceptedUnits24h', 'providerObservedUnits', 'providerAsOf', 'threshold', 'limit']) {
      if (typeof result[key] === 'number' || typeof result[key] === 'boolean' || result[key] === null || ['sent', 'failed', 'deduplicated', 'not_needed', 'busy', 'retry_later'].includes(result[key])) safe[key] = result[key];
    }
    console.log(JSON.stringify(safe)); if (!response.ok) process.exitCode = 1;
  } catch { console.error('Pediturno email monitor bridge failed; private details omitted'); process.exitCode = 1; }
  finally { input = ''; }
});
