import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type AlertRecord = Record<string, unknown>;
type AlertRef = { id: string };
type AlertTransaction = { get: (ref: AlertRef) => Promise<{ get: (key: string) => unknown }>; set: (ref: AlertRef, value: AlertRecord) => void };
const mocks = vi.hoisted(() => ({ send: vi.fn(), db: vi.fn(), records: new Map<string, AlertRecord>(), tail: Promise.resolve() }));
vi.mock('@/services/email', () => ({ sendGooglePlayOperationalAlert: mocks.send }));
vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { fromMillis: (value: number) => ({ toMillis: () => value }) },
  FieldValue: { serverTimestamp: () => { const value = Date.now(); return { toMillis: () => value }; } },
}));
vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: mocks.db }));

import { reportGooglePlayOperationalIncident } from '@/lib/payments/google-play-alerts';

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-29T19:00:00Z'));
  vi.stubEnv('GOOGLE_PLAY_OPS_ALERT_EMAIL', 'ops@example.test');
  vi.stubEnv('FIREBASE_PROJECT_ID', 'pediturno-app');
  vi.stubEnv('FIRESTORE_EMULATOR_HOST', ''); vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '');
  mocks.records.clear(); mocks.tail = Promise.resolve(); vi.clearAllMocks(); mocks.send.mockResolvedValue(true);
  mocks.db.mockReturnValue({
    collection: (name: string) => {
      expect(name).toBe('googlePlayOperationalAlerts');
      return { doc: (id: string) => ({ id }) };
    },
    runTransaction: (callback: (tx: AlertTransaction) => Promise<unknown>) => {
      const run = mocks.tail.then(() => callback({
        get: async (ref: { id: string }) => ({ get: (key: string) => mocks.records.get(ref.id)?.[key] }),
        set: (ref: { id: string }, value: Record<string, unknown>) => mocks.records.set(ref.id, { ...mocks.records.get(ref.id), ...value }),
      }));
      mocks.tail = run.then(() => undefined, () => undefined);
      return run;
    },
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('private Play operational alerts', () => {
  it('does nothing until the operator recipient is configured', async () => {
    vi.stubEnv('GOOGLE_PLAY_OPS_ALERT_EMAIL', '');
    await reportGooglePlayOperationalIncident({ kind: 'reconciliation_failed', failed: 1 });
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('never sends external mail from isolated emulator runs', async () => {
    vi.stubEnv('FIREBASE_PROJECT_ID', 'demo-pediturno-audit');
    await reportGooglePlayOperationalIncident({ kind: 'reconciliation_failed', failed: 1 });
    expect(mocks.db).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('leases concurrent reports once, limits repeats, and only sends numeric counters', async () => {
    const incident = { kind: 'reconciliation_failed' as const, failed: 1, checked: 3, processed: -1, pending: NaN, purchaseToken: 'synthetic-not-for-delivery' };
    await Promise.all([reportGooglePlayOperationalIncident(incident), reportGooglePlayOperationalIncident(incident)]);
    await reportGooglePlayOperationalIncident(incident);
    expect(mocks.send).toHaveBeenCalledTimes(1);
    expect(mocks.send).toHaveBeenCalledWith({ kind: 'reconciliation_failed', counts: { checked: 3, failed: 1 } });
    expect(mocks.records.get('reconciliation_failed')?.lastDeliverySucceeded).toBe(true);
    vi.advanceTimersByTime(60 * 60_000 + 1);
    await reportGooglePlayOperationalIncident(incident);
    expect(mocks.send).toHaveBeenCalledTimes(2);
  });
  it('retries after failed SMTP delivery instead of consuming the hourly allowance', async () => {
    mocks.send.mockResolvedValueOnce(false);
    await reportGooglePlayOperationalIncident({ kind: 'reconciliation_failed', failed: 1 });
    expect(mocks.records.get('reconciliation_failed')?.lastSentAt).toBeUndefined();
    await reportGooglePlayOperationalIncident({ kind: 'reconciliation_failed', failed: 1 });
    expect(mocks.send).toHaveBeenCalledTimes(2);
    expect(mocks.records.get('reconciliation_failed')?.lastDeliverySucceeded).toBe(true);
  });
  it('contains provider exceptions without disclosing details or changing entitlement data', async () => {
    mocks.send.mockRejectedValue(new Error('synthetic-secret-provider-diagnostic'));
    await expect(reportGooglePlayOperationalIncident({ kind: 'rtdn_unmapped', pending: 2 })).resolves.toBeUndefined();
    expect(mocks.records.get('rtdn_unmapped')?.lastDeliverySucceeded).toBe(false);
  });
});
