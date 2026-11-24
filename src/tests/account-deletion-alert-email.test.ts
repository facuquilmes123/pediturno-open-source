import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const smtp = vi.hoisted(() => ({ send: vi.fn(), transport: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.transport } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => new Headers()) }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); vi.stubEnv('EMAIL_USER', 'mailer@example.test'); vi.stubEnv('EMAIL_PASS', 'synthetic-test-only');
  vi.stubEnv('ACCOUNT_DELETION_ALERT_TO', 'ops@example.test'); vi.stubEnv('FIREBASE_PROJECT_ID', 'pediturno-app');
  vi.stubEnv('FIRESTORE_EMULATOR_HOST', ''); vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '');
  smtp.transport.mockReturnValue({ sendMail: smtp.send }); smtp.send.mockResolvedValue({ accepted: ['ops@example.test'] });
});
afterEach(() => vi.unstubAllEnvs());
it('uses only the configured recipient, fixed subject and allowed nonnegative counters', async () => {
  const { sendAccountDeletionOperationalAlert } = await import('@/services/email');
  expect(await sendAccountDeletionOperationalAlert({ overdue: 1, workerFailed: 2, purchaseToken: 123456 })).toBe(true);
  const message = smtp.send.mock.calls[0][0];
  expect(message.to).toBe('ops@example.test'); expect(message.text).toContain('overdue: 1'); expect(message.text).not.toContain('purchaseToken'); expect(message.text).not.toContain('123456');
});
it('does not claim SMTP delivery when a recipient is rejected', async () => {
  const { sendAccountDeletionOperationalAlert } = await import('@/services/email'); smtp.send.mockResolvedValue({ accepted: [] });
  expect(await sendAccountDeletionOperationalAlert({ overdue: 1 })).toBe(false);
});
it('blocks recipient header injection before creating a transport', async () => {
  vi.stubEnv('ACCOUNT_DELETION_ALERT_TO', 'ops@example.test\r\nBcc: other@example.test');
  const { sendAccountDeletionOperationalAlert } = await import('@/services/email'); expect(await sendAccountDeletionOperationalAlert({})).toBe(false); expect(smtp.transport).not.toHaveBeenCalled();
});
