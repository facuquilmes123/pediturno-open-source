import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const monitor = vi.hoisted(() => vi.fn());
vi.mock('@/services/email', () => ({ runSmtpUsageMonitor: monitor }));
import { GET, POST } from '@/app/api/cron/email-usage/route';
const secret = 'synthetic-cron-secret-12345678901234567890';
const request = (value: unknown, token = secret) => new Request('https://pediturno.com/api/cron/email-usage', {
  method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify(value),
});
beforeEach(() => { vi.stubEnv('CRON_SECRET', secret); monitor.mockResolvedValue({ alert: 'not_needed', usageEstimate: 0 }); });
afterEach(() => vi.unstubAllEnvs());
it('requires the existing private cron secret before accepting observations', async () => {
  expect((await POST(request({}, 'wrong'))).status).toBe(401); expect(monitor).not.toHaveBeenCalled();
});
it('does not accept arbitrary recipients or credential fields', async () => {
  expect((await POST(request({ to: 'unapproved@example.test', test: true }))).status).toBe(400); expect(monitor).not.toHaveBeenCalled();
});
it('bounds the body and rejects invalid observation shapes', async () => {
  expect((await POST(request({ unknown: 'a'.repeat(3000) }))).status).toBe(400);
  expect((await POST(request({ observation: { count: 80, recipient: 'x' } }))).status).toBe(400);
});
it('passes a well-shaped snapshot and keeps output private', async () => {
  const observation = { count: 80, asOf: 2 * 86400000, from: 86400000 };
  const response = await POST(request({ observation }));
  expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store');
  expect(monitor).toHaveBeenCalledWith(observation, false);
});
it('allows a bounded delivery test independently of real quota warnings', async () => {
  expect((await POST(request({ test: true }))).status).toBe(200); expect(monitor).toHaveBeenCalledWith(undefined, true);
});
it('returns failure rather than claiming an email was delivered', async () => {
  monitor.mockResolvedValue({ alert: 'failed' }); expect((await POST(request({}))).status).toBe(503);
});
it('does not expose a provider error or the cron secret', async () => {
  monitor.mockRejectedValue(new Error('private synthetic token')); const response = await POST(request({}));
  expect(response.status).toBe(503); expect(await response.text()).not.toContain('private synthetic token');
});
it('GET cannot trigger an email', () => { expect(GET().status).toBe(405); expect(monitor).not.toHaveBeenCalled(); });
