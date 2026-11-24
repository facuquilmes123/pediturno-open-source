import { describe, expect, it, vi } from 'vitest';
import { createSmtpUsageController, summarizeSmtpUsage, SMTP_WINDOW_MS, type SmtpUsageState, type SmtpUsageStore } from '@/lib/smtp-usage';

function harness(initial: SmtpUsageState = {}) {
  let state = structuredClone(initial); let time = 2 * SMTP_WINDOW_MS; let queue = Promise.resolve();
  const store: SmtpUsageStore = { transaction: fn => {
    const task = queue.then(() => { const outcome = fn(structuredClone(state)); state = structuredClone(outcome.state); return outcome.result; });
    queue = task.then(() => undefined, () => undefined);
    return task;
  } };
  return { controller: createSmtpUsageController(store, () => time), state: () => state, now: () => time, advance: (ms: number) => { time += ms; } };
}

describe('SMTP rolling usage and alert delivery', () => {
  it('alerts at 80, includes its own accepted recipient and does not send at 79', async () => {
    const h = harness(); const send = vi.fn().mockResolvedValue(true);
    await h.controller.recordAccepted(79);
    expect((await h.controller.monitor(send)).alert).toBe('not_needed'); expect(send).not.toHaveBeenCalled();
    await h.controller.recordAccepted(1);
    expect((await h.controller.monitor(send)).alert).toBe('sent'); expect(send).toHaveBeenCalledTimes(1);
    expect(summarizeSmtpUsage(h.state(), h.now()).appAcceptedUnits24h).toBe(81);
    expect((await h.controller.monitor(send)).alert).toBe('deduplicated');
  });
  it('only one of concurrent workers sends an alert', async () => {
    const h = harness(); await h.controller.recordAccepted(80);
    const send = vi.fn().mockResolvedValue(true);
    const results = await Promise.all(Array.from({ length: 20 }, () => h.controller.monitor(send)));
    expect(send).toHaveBeenCalledTimes(1); expect(results.filter(r => r.alert === 'sent')).toHaveLength(1);
  });
  it('preserves concurrent accepted events while the alert is in flight', async () => {
    const h = harness(); await h.controller.recordAccepted(80);
    await h.controller.monitor(async () => { await h.controller.recordAccepted(7); return true; });
    expect(summarizeSmtpUsage(h.state(), h.now()).appAcceptedUnits24h).toBe(88);
  });
  it('expires accepted units after 24 hours rather than at local midnight', async () => {
    const h = harness(); await h.controller.recordAccepted(80); h.advance(SMTP_WINDOW_MS - 1);
    expect(summarizeSmtpUsage(h.state(), h.now()).usageEstimate).toBe(80);
    h.advance(1); expect(summarizeSmtpUsage(h.state(), h.now()).usageEstimate).toBe(0);
  });
  it('does not double count provider logs and application counts', async () => {
    const h = harness(); await h.controller.recordAccepted(60);
    await h.controller.observeProvider({ count: 85, asOf: h.now(), from: h.now() - SMTP_WINDOW_MS });
    const send = vi.fn().mockResolvedValue(true); const result = await h.controller.monitor(send);
    expect(result.usageEstimate).toBe(85); expect(result.appAcceptedUnits24h).toBe(60); expect(result.alert).toBe('sent');
  });
  it('can alert from provider counts when no application email was recorded', async () => {
    const h = harness(); await h.controller.observeProvider({ count: 80, asOf: h.now(), from: h.now() - SMTP_WINDOW_MS });
    expect((await h.controller.monitor(async () => true)).alert).toBe('sent');
  });
  it('does not present a stale provider count as current quota usage', async () => {
    const h = harness(); await h.controller.observeProvider({ count: 99, asOf: h.now(), from: h.now() - SMTP_WINDOW_MS });
    h.advance(21 * 60_000); const result = await h.controller.monitor(async () => true);
    expect(result.providerObservedUnits).toBeNull(); expect(result.alert).toBe('not_needed');
  });
  it('does not roll the observation backward when another poll finishes late', async () => {
    const h = harness(); const latest = { count: 90, asOf: h.now(), from: h.now() - SMTP_WINDOW_MS };
    await h.controller.observeProvider(latest);
    await h.controller.observeProvider({ count: 0, asOf: h.now() - 60_000, from: h.now() - SMTP_WINDOW_MS - 60_000 });
    expect(h.state().provider).toEqual(latest);
  });
  it('retries failed delivery after a cooldown without consuming the sent deduplication', async () => {
    const h = harness(); await h.controller.recordAccepted(80);
    const send = vi.fn().mockRejectedValue(new Error('synthetic SMTP failure'));
    expect((await h.controller.monitor(send)).alert).toBe('failed'); expect(h.state().lastAlertAt).toBeUndefined();
    expect((await h.controller.monitor(send)).alert).toBe('retry_later'); expect(send).toHaveBeenCalledTimes(1);
    h.advance(15 * 60_000); send.mockResolvedValue(true); expect((await h.controller.monitor(send)).alert).toBe('sent');
  });
  it('the controlled test does not fabricate 80 sends or silence a future real alert', async () => {
    const h = harness(); const send = vi.fn().mockResolvedValue(true);
    expect((await h.controller.monitor(send, true)).alert).toBe('sent');
    expect(summarizeSmtpUsage(h.state(), h.now()).appAcceptedUnits24h).toBe(1);
    expect(h.state().lastAlertAt).toBeUndefined(); expect((await h.controller.monitor(send, true)).alert).toBe('deduplicated');
    await h.controller.recordAccepted(79); expect((await h.controller.monitor(send)).alert).toBe('sent');
  });
  it('permits a new real warning after 24 hours when new usage again reaches the threshold', async () => {
    const h = harness(); await h.controller.recordAccepted(80); await h.controller.monitor(async () => true);
    h.advance(SMTP_WINDOW_MS + 1); await h.controller.recordAccepted(80);
    expect((await h.controller.monitor(async () => true)).alert).toBe('sent');
  });
  it('an expired worker lease can be recovered without keeping the old owner', async () => {
    const h = harness({ events: [{ at: 2 * SMTP_WINDOW_MS, units: 80 }], lease: { id: 'old-worker', until: 1 } });
    expect((await h.controller.monitor(async () => true)).alert).toBe('sent'); expect(h.state().lease).toBeUndefined();
  });
  it.each([-1, 0, 1.5, NaN, Infinity, 1001])('rejects invalid accepted units %s', async count => {
    await expect(harness().controller.recordAccepted(count)).rejects.toThrow();
  });
  it('rejects fabricated future or stale provider observations', async () => {
    const h = harness();
    await expect(h.controller.observeProvider({ count: 90, asOf: h.now() + 120_000, from: h.now() - SMTP_WINDOW_MS })).rejects.toThrow();
    await expect(h.controller.observeProvider({ count: 90, asOf: h.now() - 21 * 60_000, from: h.now() - SMTP_WINDOW_MS - 21 * 60_000 })).rejects.toThrow();
    expect(h.state().provider).toBeUndefined();
  });
  it('bounds the stored event history without understating high volume', async () => {
    const h = harness(); for (let i = 0; i < 600; i++) { await h.controller.recordAccepted(1); h.advance(1); }
    expect(h.state().events!.length).toBeLessThanOrEqual(512); expect(summarizeSmtpUsage(h.state(), h.now()).appAcceptedUnits24h).toBe(600);
  });
  it('does not treat corrupted private state as a trustworthy zero', async () => {
    const h = harness({ events: [{ at: 2 * SMTP_WINDOW_MS, units: -1 }] });
    await expect(h.controller.monitor(async () => true)).rejects.toThrow();
  });
  it.each(['lastAlertAt', 'lastTestAt', 'retryAt'])('does not accept a corrupt %s marker', async field => {
    const h = harness({ [field]: 'invalid-marker' } as unknown as SmtpUsageState);
    await expect(h.controller.monitor(async () => true)).rejects.toThrow();
  });
});
