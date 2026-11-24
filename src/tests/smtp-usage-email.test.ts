import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const smtp = vi.hoisted(() => ({ send: vi.fn(), transport: vi.fn(), record: vi.fn(), monitor: vi.fn(), observe: vi.fn() }));
vi.mock('nodemailer', () => ({ default: { createTransport: smtp.transport } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => new Headers()) }));
vi.mock('@/lib/smtp-usage-store', () => ({ getSmtpUsageController: () => ({ recordAccepted: smtp.record, monitor: smtp.monitor, observeProvider: smtp.observe }) }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv('EMAIL_USER', 'notificaciones@pediturno.com'); vi.stubEnv('EMAIL_PASS', 'synthetic-mail-test'); vi.stubEnv('FIREBASE_PROJECT_ID', 'pediturno-app');
  vi.stubEnv('FIRESTORE_EMULATOR_HOST', ''); vi.stubEnv('FIREBASE_AUTH_EMULATOR_HOST', '');
  smtp.transport.mockReturnValue({ sendMail: smtp.send }); smtp.send.mockResolvedValue({ accepted: ['client@example.test'] });
  smtp.record.mockResolvedValue(undefined); smtp.monitor.mockResolvedValue({ alert: 'not_needed' });
});
afterEach(() => vi.unstubAllEnvs());
it('records accepted SMTP recipients once and preserves the original mail result', async () => {
  const { sendWelcomeEmail } = await import('@/services/email');
  expect((await sendWelcomeEmail({ name: 'Synthetic', email: 'client@example.test' })).success).toBe(true);
  expect(smtp.record).toHaveBeenCalledExactlyOnceWith(1); expect(smtp.monitor).toHaveBeenCalledTimes(1); expect(smtp.send).toHaveBeenCalledTimes(1);
});
it('does not turn an already accepted SMTP message into a retry because telemetry failed', async () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  smtp.record.mockRejectedValue(new Error('synthetic private detail'));
  try {
    const { sendWelcomeEmail } = await import('@/services/email');
    expect((await sendWelcomeEmail({ name: 'Synthetic', email: 'client@example.test' })).success).toBe(true);
    expect(smtp.send).toHaveBeenCalledTimes(1); expect(warn).toHaveBeenCalledWith('smtp_usage_record_unavailable');
  } finally { warn.mockRestore(); }
});
it('does not fabricate accepted quota when the relay accepted no recipient', async () => {
  smtp.send.mockResolvedValue({ accepted: [] }); const { sendWelcomeEmail } = await import('@/services/email');
  await sendWelcomeEmail({ name: 'Synthetic', email: 'client@example.test' }); expect(smtp.record).not.toHaveBeenCalled();
});
it('uses only the fixed operator recipient and sends the alert without recursive metering', async () => {
  const summary = { appAcceptedUnits24h: 80, providerObservedUnits: null, providerAsOf: null, usageEstimate: 80, threshold: 80, limit: 100 };
  smtp.monitor.mockImplementation(async send => ({ alert: await send(summary, false) ? 'sent' : 'failed' }));
  smtp.send.mockResolvedValueOnce({ accepted: ['client@example.test'] }).mockResolvedValueOnce({ accepted: ['admin@example.com'] });
  const { sendWelcomeEmail } = await import('@/services/email');
  await sendWelcomeEmail({ name: 'Synthetic', email: 'client@example.test' });
  expect(smtp.send).toHaveBeenCalledTimes(2); expect(smtp.record).toHaveBeenCalledTimes(1); expect(smtp.monitor).toHaveBeenCalledTimes(1);
  const alert = smtp.send.mock.calls[1][0]; expect(alert.to).toBe('admin@example.com');
  expect(alert.subject).toBe('[Pediturno] Correo cerca del límite: 80/100'); expect(alert.text).not.toContain('client@example.test');
});
it('separates the delivery test from a real threshold and requires SMTP acceptance', async () => {
  smtp.monitor.mockImplementation(async (send, test) => ({ alert: await send({ appAcceptedUnits24h: 0, providerObservedUnits: null, providerAsOf: null, usageEstimate: 0, threshold: 80, limit: 100 }, test) ? 'sent' : 'failed' }));
  smtp.send.mockResolvedValue({ accepted: [] }); const { runSmtpUsageMonitor } = await import('@/services/email');
  expect((await runSmtpUsageMonitor(undefined, true)).alert).toBe('failed'); expect(smtp.send.mock.calls[0][0].text).toContain('no representa un umbral real alcanzado');
});
