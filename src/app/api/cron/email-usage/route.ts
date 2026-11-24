import { timingSafeEqual } from 'node:crypto';
import { runSmtpUsageMonitor } from '@/services/email';
import { readLimitedJson } from '@/lib/request-body';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get('authorization');
  if (!secret || secret.length < 24 || !header?.startsWith('Bearer ')) return false;
  const value = Buffer.from(header.slice(7)); const expected = Buffer.from(secret);
  return value.length === expected.length && timingSafeEqual(value, expected);
}
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  let input: { observation?: { count: number; asOf: number; from: number }; test?: boolean };
  try {
    const data = await readLimitedJson(request, 2048);
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).some(k => !['observation', 'test'].includes(k))) throw new Error('Invalid input');
    input = data as typeof input;
    if (input.test !== undefined && typeof input.test !== 'boolean') throw new Error('Invalid test');
    if (input.observation !== undefined && (!input.observation || typeof input.observation !== 'object' || Array.isArray(input.observation) || Object.keys(input.observation).sort().join(',') !== 'asOf,count,from')) throw new Error('Invalid observation');
  } catch { return Response.json({ error: 'Invalid monitor input' }, { status: 400 }); }
  try {
    const result = await runSmtpUsageMonitor(input.observation, input.test === true);
    return Response.json(result, { status: result.alert === 'failed' ? 503 : 200, headers: { 'Cache-Control': 'no-store' } });
  } catch { return Response.json({ error: 'Email usage monitor unavailable' }, { status: 503, headers: { 'Cache-Control': 'no-store' } }); }
}
export function GET() { return Response.json({ error: 'Method not allowed' }, { status: 405 }); }
