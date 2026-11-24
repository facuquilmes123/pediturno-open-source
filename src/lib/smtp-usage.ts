import { randomUUID } from 'node:crypto';

export const SMTP_WINDOW_MS = 86_400_000;
export const SMTP_ALERT_THRESHOLD = 80;
export const SMTP_DAILY_LIMIT = 100;
export const SMTP_ALERT_RECIPIENT = 'admin@example.com';
export const SMTP_MAILBOX = 'notificaciones@pediturno.com';
type Event = { at: number; units: number; id?: string };
export type SmtpUsageState = {
  events?: Event[];
  provider?: { count: number; asOf: number; from: number };
  lastAlertAt?: number;
  lastTestAt?: number;
  retryAt?: number;
  lease?: { id: string; until: number };
};
export type SmtpUsageStore = {
  transaction<T>(fn: (state: SmtpUsageState) => { state: SmtpUsageState; result: T }): Promise<T>;
  appendAccepted?(event: { at: number; units: number; id: string }): Promise<void>;
};
export type SmtpUsageSummary = { appAcceptedUnits24h: number; providerObservedUnits: number | null; providerAsOf: number | null; usageEstimate: number; threshold: number; limit: number };
export type SmtpAlertSender = (summary: SmtpUsageSummary, test: boolean) => Promise<boolean>;

function prune(input: SmtpUsageState, now: number): SmtpUsageState {
  if (!input || typeof input !== 'object' || (input.events !== undefined && !Array.isArray(input.events))) throw new Error('Invalid SMTP usage state');
  for (const key of ['lastAlertAt', 'lastTestAt', 'retryAt'] as const) {
    if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || input[key]! < 0)) throw new Error('Invalid SMTP alert timestamp');
  }
  if (input.lease && (typeof input.lease.id !== 'string' || !input.lease.id || input.lease.id.length > 128 || !Number.isSafeInteger(input.lease.until) || input.lease.until < 0)) throw new Error('Invalid SMTP alert lease');
  if (input.provider && (!Number.isSafeInteger(input.provider.count) || input.provider.count < 0 || !Number.isSafeInteger(input.provider.asOf) || !Number.isSafeInteger(input.provider.from))) throw new Error('Invalid SMTP observation state');
  const events = (input.events ?? []).filter(e => {
    if (!Number.isSafeInteger(e.at) || !Number.isSafeInteger(e.units) || e.units < 1 || e.units > 1_000_000 || e.at > now + 60_000) throw new Error('Invalid SMTP usage event');
    return e.at > now - SMTP_WINDOW_MS;
  }).sort((a, b) => a.at - b.at);
  // Bound storage. Merging at the later time is conservative at expiration.
  while (events.length > 512) {
    const a = events.shift()!; const b = events.shift()!;
    events.unshift({ at: b.at, units: a.units + b.units });
  }
  return { ...input, events };
}

export function summarizeSmtpUsage(state: SmtpUsageState, now: number): SmtpUsageSummary {
  const clean = prune(state, now);
  const app = clean.events!.reduce((sum, e) => sum + e.units, 0);
  const p = clean.provider;
  const fresh = p && Number.isSafeInteger(p.count) && p.count >= 0 && p.asOf <= now + 60_000 && p.asOf >= now - 20 * 60_000 && p.from <= p.asOf - SMTP_WINDOW_MS && p.from >= p.asOf - SMTP_WINDOW_MS - 60_000;
  return { appAcceptedUnits24h: app, providerObservedUnits: fresh ? p.count : null, providerAsOf: fresh ? p.asOf : null,
    usageEstimate: Math.max(app, fresh ? p.count : 0), threshold: SMTP_ALERT_THRESHOLD, limit: SMTP_DAILY_LIMIT };
}

export function createSmtpUsageController(store: SmtpUsageStore, now = () => Date.now()) {
  async function recordAccepted(units: number) {
    if (!Number.isSafeInteger(units) || units < 1 || units > 1000) throw new Error('Invalid SMTP accepted units');
    if (store.appendAccepted) {
      await store.appendAccepted({ at: now(), units, id: randomUUID() });
      return;
    }
    await store.transaction(state => {
      const time = now(); const next = prune(state, time);
      next.events!.push({ at: time, units });
      return { state: prune(next, time), result: undefined };
    });
  }
  async function observeProvider(observation: { count: number; asOf: number; from: number }) {
    const time = now();
    if (!Number.isSafeInteger(observation.count) || observation.count < 0 || observation.count > 1_000_000 ||
      !Number.isSafeInteger(observation.asOf) || !Number.isSafeInteger(observation.from) || observation.asOf > time + 60_000 ||
      observation.asOf < time - 20 * 60_000 || observation.from > observation.asOf - SMTP_WINDOW_MS || observation.from < observation.asOf - SMTP_WINDOW_MS - 60_000) throw new Error('Invalid SMTP provider observation');
    await store.transaction(state => {
      const next = prune(state, time);
      if (!next.provider || observation.asOf >= next.provider.asOf) next.provider = observation;
      return { state: next, result: undefined };
    });
  }
  async function monitor(send: SmtpAlertSender, test = false) {
    const time = now(); const id = randomUUID();
    const claim = await store.transaction(state => {
      const next = prune(state, time); const summary = summarizeSmtpUsage(next, time);
      const previous = test ? next.lastTestAt : next.lastAlertAt;
      const status = previous !== undefined && previous > time - SMTP_WINDOW_MS ? 'deduplicated' :
        next.lease && next.lease.until > time ? 'busy' : (next.retryAt ?? 0) > time ? 'retry_later' :
          !test && summary.usageEstimate < SMTP_ALERT_THRESHOLD ? 'not_needed' : 'claimed';
      if (status === 'claimed') next.lease = { id, until: time + 120_000 };
      return { state: next, result: { summary, status } };
    });
    if (claim.status !== 'claimed') return { ...claim.summary, alert: claim.status, test };
    let accepted = false;
    try { accepted = await send(claim.summary, test); } catch { /* No provider errors or recipients in logs. */ }
    await store.transaction(state => {
      const current = prune(state, now());
      if (current.lease?.id !== id) return { state: current, result: undefined };
      delete current.lease;
      if (accepted) {
        if (test) current.lastTestAt = now(); else current.lastAlertAt = now();
        current.events!.push({ at: now(), units: 1 });
        delete current.retryAt;
      } else current.retryAt = now() + 15 * 60_000;
      return { state: prune(current, now()), result: undefined };
    });
    return { ...claim.summary, alert: accepted ? 'sent' : 'failed', test };
  }
  return { recordAccepted, observeProvider, monitor };
}
