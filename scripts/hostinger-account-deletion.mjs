// Install in hbuilds/config alongside the existing cron runner, only after authorization.
// Node22 --env-file loads the independent key. No secret belongs in cron arguments.
import { pathToFileURL } from 'node:url';

const endpoint = 'https://pediturno.com/api/v1/internal/account-deletion/process';
const counters = ['attempted', 'deleted', 'financialReviewRequired', 'processing', 'skipped', 'failed'];
export async function runAccountDeletionCron({ env = process.env, fetchImpl = fetch, checkOnly = false, monitorOnly = false } = {}) {
  const key = env.ACCOUNT_DELETION_WORKER_KEY;
  if (env.ACCOUNT_DELETION_SCHEDULE_ENABLED !== 'true' || !key || key.length < 24) return { ok: false, error: 'DELETION_SCHEDULE_NOT_CONFIGURED' };
  if (checkOnly && monitorOnly) return { ok: false, error: 'AMBIGUOUS_MODE' };
  try {
    const response = await fetchImpl(monitorOnly ? endpoint.replace('/process', '/monitor') : endpoint, {
      method: checkOnly ? 'GET' : 'POST', headers: { 'x-account-deletion-worker-key': key, 'content-type': 'application/json' },
      ...(checkOnly ? {} : { body: JSON.stringify(monitorOnly ? {} : { limit: 5 }) }), redirect: 'error', signal: AbortSignal.timeout(90_000),
    });
    const body = await response.json().catch(() => null);
    if (monitorOnly) return { ok: response.ok && body?.healthy === true && body?.alerts?.failed === 0 && body?.alerts?.pending === 0, http: response.status, healthy: body?.healthy === true, alertsSent: Number.isInteger(body?.alerts?.sent) ? body.alerts.sent : 0 };
    if (checkOnly) return { ok: response.ok && body?.healthy === true, http: response.status, healthy: body?.healthy === true, overdue: Number.isInteger(body?.overdue) ? body.overdue : null, unknownDeadline: Number.isInteger(body?.unknownDeadline) ? body.unknownDeadline : null };
    const valid = body && counters.every(name => Number.isInteger(body[name]) && body[name] >= 0);
    return { ok: response.ok && valid && body.failed === 0, http: response.status, ...(valid ? { counters: Object.fromEntries(counters.map(name => [name, body[name]])) } : { error: 'INVALID_WORKER_RESPONSE' }) };
  } catch { return { ok: false, error: 'DELETION_WORKER_UNAVAILABLE' }; }
}
if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const result = await runAccountDeletionCron({ checkOnly: process.argv.includes('--check'), monitorOnly: process.argv.includes('--monitor') });
  console.log(JSON.stringify({ subsystem: 'account-deletion', ...result }));
  if (!result.ok) process.exitCode = 1;
}
