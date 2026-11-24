import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const smtp = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.createTransport } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => new Headers()) }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('EMAIL_USER', 'synthetic-mailer@example.test'); vi.stubEnv('EMAIL_PASS', 'synthetic-test-only');
  vi.stubEnv('GOOGLE_PLAY_OPS_ALERT_EMAIL', 'ops@example.test'); vi.stubEnv('FIREBASE_PROJECT_ID', 'pediturno-app');
  vi.stubEnv('FIRESTORE_EMULATOR_HOST', ''); vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '');
  smtp.sendMail.mockResolvedValue({ accepted: ['ops@example.test'] });
  smtp.createTransport.mockReturnValue({ sendMail: smtp.sendMail });
});
afterEach(() => vi.unstubAllEnvs());
describe('operator mail privacy and actual SMTP acceptance', () => {
  it('sends only approved numeric counters and a fixed action, without copying arbitrary provider fields', async () => {
    const { sendGooglePlayOperationalAlert } = await import('@/services/email');
    expect(await sendGooglePlayOperationalAlert({ kind: 'reconciliation_failed', counts: { failed: 1, checked: 2, purchaseToken: 123456, negative: -1 } })).toBe(true);
    const message = smtp.sendMail.mock.calls[0][0];
    expect(message.to).toBe('ops@example.test');
    expect(message.text).toContain('failed: 1'); expect(message.text).toContain('pediturno-play-reconcile');
    expect(message.text).not.toContain('123456'); expect(message.text).not.toContain('purchaseToken');
  });
  it('rejects header injection in operator configuration before creating a transport', async () => {
    vi.stubEnv('GOOGLE_PLAY_OPS_ALERT_EMAIL', 'ops@example.test\r\nBcc: other@example.test');
    const { sendGooglePlayOperationalAlert } = await import('@/services/email');
    expect(await sendGooglePlayOperationalAlert({ kind: 'reconciliation_failed', counts: {} })).toBe(false);
    expect(smtp.createTransport).not.toHaveBeenCalled();
  });
  it('does not mark delivery successful when SMTP rejects the recipient or throws', async () => {
    const { sendGooglePlayOperationalAlert } = await import('@/services/email');
    smtp.sendMail.mockResolvedValueOnce({ accepted: [], rejected: ['ops@example.test'] });
    expect(await sendGooglePlayOperationalAlert({ kind: 'reconciliation_failed', counts: {} })).toBe(false);
    smtp.sendMail.mockRejectedValueOnce(new Error('synthetic-sensitive-provider-detail'));
    expect(await sendGooglePlayOperationalAlert({ kind: 'reconciliation_failed', counts: {} })).toBe(false);
  });
});
