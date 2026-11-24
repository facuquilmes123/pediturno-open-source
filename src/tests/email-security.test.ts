import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { sendMail, createTransport } = vi.hoisted(() => ({ sendMail: vi.fn(), createTransport: vi.fn() }));

vi.mock('nodemailer', () => ({ default: { createTransport } }));
vi.mock('next/headers', () => ({ headers: vi.fn(() => new Headers()) }));

// Warm transforms outside each case's 5s budget; cases still import with their
// own synthetic environment and keep the same assertions and time limits.
beforeAll(async () => { await import('@/services/email'); vi.resetModules(); });

beforeEach(() => {
  sendMail.mockResolvedValue({ messageId: 'test' });
  createTransport.mockReturnValue({ sendMail });
});

const originalEnvironment = { EMAIL_USER: process.env.EMAIL_USER, EMAIL_PASS: process.env.EMAIL_PASS };

afterEach(() => {
  vi.resetModules();
  sendMail.mockClear();
  if (originalEnvironment.EMAIL_USER === undefined) delete process.env.EMAIL_USER; else process.env.EMAIL_USER = originalEnvironment.EMAIL_USER;
  if (originalEnvironment.EMAIL_PASS === undefined) delete process.env.EMAIL_PASS; else process.env.EMAIL_PASS = originalEnvironment.EMAIL_PASS;
});

describe('server email confirmation', () => {
  it('sends sports owners and customers back to their own portal', async () => {
    process.env.EMAIL_USER = 'mailer@example.test';
    process.env.EMAIL_PASS = 'test-password';
    const mail = await import('@/services/email');
    await mail.sendWelcomeEmail({ name: 'Club', email: 'owner@example.test', businessType: 'sports_facility' });
    expect(sendMail.mock.calls[0][0].html).toContain('https://canchas.pediturno.com/');
    const input = {
      appointment: { client: 'Cliente', clientEmail: 'client@example.test', date: '2026-10-09T03:00:00Z', time: '10:00', cancha: 'Pádel' },
      business: { name: 'Club', slug: 'club', businessType: 'sports_facility', bookingSettings: { notificationEmail: 'owner@example.test' } },
    };
    await mail.sendCancellationEmail({ ...input, recipient: 'client' } as never);
    expect(sendMail.mock.calls[1][0].html).toContain('https://canchas.pediturno.com/club');
    await mail.sendNewAppointmentNotificationEmail(input as never);
    expect(sendMail.mock.calls[2][0].html).toContain('https://canchas.pediturno.com/dashboard/calendario');
  });
  it('uses encrypted domain SMTP and the configured reply address for every mail flow', async () => {
    vi.stubEnv('EMAIL_USER', 'notificaciones@pediturno.com');
    vi.stubEnv('EMAIL_PASS', 'test-only-password');
    vi.stubEnv('EMAIL_FROM', 'notificaciones@pediturno.com');
    vi.stubEnv('EMAIL_HOST', 'smtp.hostinger.com');
    vi.stubEnv('EMAIL_PORT', '465');
    vi.stubEnv('EMAIL_SECURE', 'true');
    vi.stubEnv('EMAIL_REPLY_TO', 'notificaciones@pediturno.com');
    try {
      const mail = await import('@/services/email');
      const input = {
        appointment: { client: 'Prueba', clientEmail: 'client@example.test', status: 'Confirmado', date: '2026-10-09T03:00:00Z', time: '10:00', service: 'Consulta' },
        business: { name: 'Negocio', slug: 'negocio', bookingSettings: { notificationEmail: 'owner@example.test' } },
        capabilityUrl: `https://pediturno.com/cancel/${'A'.repeat(43)}`,
      };
      await mail.sendWelcomeEmail({ name: 'Prueba', email: 'client@example.test' });
      await mail.sendConfirmationEmail(input as never);
      await mail.sendReminderEmail(input as never);
      await mail.sendCancellationEmail({ ...input, recipient: 'client' } as never);
      await mail.sendNewAppointmentNotificationEmail(input as never);
      expect(sendMail).toHaveBeenCalledTimes(5);
      for (const [options] of sendMail.mock.calls) {
        expect(options.from).toBe('Pediturno <notificaciones@pediturno.com>');
        expect(options.replyTo).toBe('notificaciones@pediturno.com');
      }
      expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({
        host: 'smtp.hostinger.com', port: 465, secure: true, requireTLS: true,
        tls: { minVersion: 'TLSv1.2' },
      }));
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it('identifies pending requests without telling customers they are confirmed', async () => {
    process.env.EMAIL_USER = 'mailer@example.test';
    process.env.EMAIL_PASS = 'test-password';
    const { sendConfirmationEmail } = await import('@/services/email');
    await sendConfirmationEmail({
      appointment: { client: 'Cliente', clientEmail: 'client@example.test', status: 'Pendiente', date: '2026-10-09T03:00:00Z', time: '10:00', service: 'Consulta' },
      business: { name: 'Negocio', slug: 'negocio' }, capabilityUrl: `https://pediturno.com/cancel/${'A'.repeat(43)}`,
    } as never);
    expect(sendMail.mock.calls[0][0].subject).toContain('pendiente');
    expect(sendMail.mock.calls[0][0].html).not.toContain('¡Turno Confirmado!');
    expect(createTransport).toHaveBeenCalledWith(expect.objectContaining({ socketTimeout: 15000 }));
  });
  it('rejects legacy appointment-id links and only emits a capability URL', async () => {
    process.env.EMAIL_USER = 'mailer@example.test';
    process.env.EMAIL_PASS = 'test-password';
    const { sendConfirmationEmail } = await import('@/services/email');
    const input = {
      appointment: { id: 'known-appointment-id', businessId: 'business_1', client: 'Cliente', clientEmail: 'client@example.test', clientPhone: '123456', service: 'Corte', time: '10:00', avatar: '', status: 'Confirmado' as const, date: '2026-10-01T00:00:00.000Z' },
      business: { name: 'Negocio', slug: 'negocio', logo: '', address: {}, bookingSettings: {} },
    };
    await expect(sendConfirmationEmail({ ...input, capabilityUrl: 'https://pediturno.com/cancel/known-appointment-id' })).resolves.toMatchObject({ success: false });
    expect(sendMail).not.toHaveBeenCalled();

    const token = 'A'.repeat(43);
    await expect(sendConfirmationEmail({ ...input, capabilityUrl: `https://pediturno.com/cancel/${token}` })).resolves.toMatchObject({ success: true });
    const message = sendMail.mock.calls[0][0].html as string;
    expect(message).toContain(`/cancel/${token}`);
    expect(message).not.toContain('/cancel/known-appointment-id');
  });

  it('does not turn customer or business text into HTML or an image URL', async () => {
    process.env.EMAIL_USER = 'mailer@example.test';
    process.env.EMAIL_PASS = 'test-password';
    const { sendConfirmationEmail } = await import('@/services/email');
    const attack = '<a href="https://evil.test">click</a><img src="https://evil.test/pixel">';
    await sendConfirmationEmail({
      appointment: { id: 'test', businessId: 'owner', client: attack, clientEmail: 'client@example.test', clientPhone: '123456', service: attack, time: '10:00', avatar: '', status: 'Confirmado', date: '2026-10-01T00:00:00.000Z' },
      business: { name: attack, slug: 'owner', logo: 'javascript:alert(1)', address: { street: attack }, bookingSettings: {} },
      capabilityUrl: `https://pediturno.com/cancel/${'A'.repeat(43)}`,
    } as never);
    const message = sendMail.mock.calls[0][0].html as string;
    expect(message).not.toContain('<a href="https://evil.test">');
    expect(message).not.toContain('<img src="https://evil.test/pixel">');
    expect(message).not.toContain('javascript:alert(1)');
    expect(message).toContain('&lt;a href=&quot;https://evil.test&quot;&gt;');
  });

  it('renders a cancha reservation as a cancha in email and calendar content', async () => {
    process.env.EMAIL_USER = 'mailer@example.test';
    process.env.EMAIL_PASS = 'test-password';
    const { sendConfirmationEmail } = await import('@/services/email');
    await sendConfirmationEmail({
      appointment: {
        id: 'appointment_1', businessId: 'owner', client: 'Equipo Azul', clientEmail: 'client@example.test',
        clientPhone: '123456', cancha: 'Cancha 2', time: '20:00', avatar: '', status: 'Confirmado',
        date: '2026-10-10T00:00:00.000Z', durationMinutes: 60,
      },
      business: { name: 'Club Norte', slug: 'club-norte', logo: '', address: {}, bookingSettings: {} },
      capabilityUrl: `https://pediturno.com/cancel/${'B'.repeat(43)}`,
    } as never);

    const mail = sendMail.mock.calls[0][0];
    expect(mail.html).toContain('<strong>Cancha:</strong> Cancha 2');
    expect(mail.html).toContain('Cancha+2');
    expect(mail.html).not.toContain('undefined');
  });
  it('names the booked space in confirmation email and calendar link', async () => {
    process.env.EMAIL_USER = 'mailer@example.test';
    process.env.EMAIL_PASS = 'test-password';
    const { sendConfirmationEmail } = await import('@/services/email');
    await sendConfirmationEmail({
      appointment: {
        id: 'appointment_2', businessId: 'owner', client: 'Cliente', clientEmail: 'client@example.test',
        clientPhone: '123456', space: 'Salón del Jardín', spaceId: 'space_1', time: '18:00', avatar: '', status: 'Confirmado',
        date: '2026-10-10T00:00:00.000Z', durationMinutes: 480,
      },
      business: { name: 'Eventos Norte', slug: 'eventos-norte', businessType: 'spaces', logo: '', address: {}, bookingSettings: {} },
      capabilityUrl: `https://pediturno.com/cancel/${'C'.repeat(43)}`,
    } as never);
    const mail = sendMail.mock.calls[0][0];
    expect(mail.html).toContain('<strong>Espacio:</strong> Salón del Jardín');
    expect(mail.html).toContain('Sal%C3%B3n+del+Jard%C3%ADn');
  });
});
