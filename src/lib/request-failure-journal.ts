import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Instrumentation } from 'next';

const allowedHosts = new Set([
  'pediturno.com', 'www.pediturno.com', 'canchas.pediturno.com', 'espacios.pediturno.com',
]);
const allowedMethods = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
const maxJournalBytes = 128 * 1024;

type FailureRecord = {
  timestamp: string;
  release: string;
  host: string;
  route: string;
  method: string;
  requestId: string;
} & (
  | { kind: 'http'; status: 503; causes: readonly string[] }
  | { kind: 'next-exception'; status: null; stage: string; digest?: string }
);

function host(value: string | string[] | null | undefined): string {
  const candidate = (Array.isArray(value) ? value[0] : value)?.toLowerCase().replace(/:\d+$/, '');
  return candidate && allowedHosts.has(candidate) ? candidate : 'unknown';
}

function baseRecord(method: string, publicHost: string, route: string) {
  return {
    timestamp: new Date().toISOString(),
    release: 'portfolio-20261119-pediturno-request-failures',
    requestId: randomUUID(),
    method: allowedMethods.has(method) ? method : 'OTHER',
    host: publicHost,
    route: /^\/[A-Za-z0-9_./\[\]()-]{0,160}$/.test(route) ? route : '/[unknown]',
  };
}

export async function appendFailure(record: FailureRecord, directory = join(homedir(), 'private', 'pediturno-request-failures')): Promise<void> {
  try {
    const owner = process.getuid?.();
    if (await realpath(directory) !== directory) return;
    const root = await lstat(directory);
    if (!root.isDirectory() || (root.mode & 0o777) !== 0o700 || root.uid !== owner) return;

    const path = join(directory, `requests-${record.timestamp.slice(0, 10)}.jsonl`);
    const line = Buffer.from(JSON.stringify(record) + '\n');
    const handle = await open(path, constants.O_APPEND | constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK, 0o600);
    try {
      const file = await handle.stat();
      if (!file.isFile() || file.nlink !== 1 || (file.mode & 0o777) !== 0o600 || file.uid !== owner) return;
      if (line.length > 1024 || file.size + line.length > maxJournalBytes) return;
      await handle.write(line);
    } finally {
      await handle.close();
    }
  } catch {
    // Diagnostics must never change a response or interrupt a maintenance job.
  }
}

export async function maintenanceFailureHeaders(
  request: Request,
  route: '/api/cron' | '/api/cron/payments',
  causes: readonly string[],
  headers: Record<string, string> = {},
): Promise<Record<string, string>> {
  if (!causes.length) return headers;
  const urlHost = host(new URL(request.url).hostname);
  const requestHost = host(request.headers.get('host'));
  const record = { ...baseRecord(request.method, requestHost === 'unknown' ? urlHost : requestHost, route), kind: 'http', status: 503, causes } as const;
  await appendFailure(record);
  return { ...headers, 'X-Request-Id': record.requestId };
}

export const reportNextRequestFailure: Instrumentation.onRequestError = async (error, request, context) => {
  try {
    const stage = ['render', 'route', 'action', 'middleware'].includes(context.routeType) ? context.routeType : 'unknown';
    const received = typeof error === 'object' && error !== null && 'digest' in error ? error.digest : undefined;
    const digest = typeof received === 'string' && /^\d{1,16}$/.test(received) ? received : undefined;
    await appendFailure({ ...baseRecord(request.method, host(request.headers.host), context.routePath), kind: 'next-exception', status: null, stage, digest });
  } catch {
    // An exception record may contain an unreadable digest.
  }
};
