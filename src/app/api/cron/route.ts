import { maintenanceFailureHeaders } from '@/lib/request-failure-journal';
import { runOwnedImageCleanup } from '@/lib/owned-image-cleanup';
import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { deliverBookingOutbox } from '@/lib/booking-outbox';
import { runReminderBatch } from '@/lib/reminders';
import { expireDepositHolds } from '@/lib/payments/deposits';
import { runSmtpUsageMonitor } from '@/services/email';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function authorized(header: string | null): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected || expected.length < 24 || !header?.startsWith('Bearer ')) return false;
  const a = Buffer.from(header.slice(7).trim());
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: Request) {
  if (!authorized(request.headers.get('authorization'))) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getAdminFirestore();
  let emailUsage: { alert: string } = { alert: 'unavailable' };
  try { emailUsage = await runSmtpUsageMonitor(); } catch { /* Other maintenance subsystems continue independently. */ }
  let confirmationsSent = 0;
  let confirmationsRetry = 0;
  let queueFailed = false;
  let depositHolds: { expired: number; failed: number } = { expired: 0, failed: 0 };
  // Each subsystem runs independently: a malformed appointment must not stop confirmations.
  try {
    const queued = await db.collection('bookingEmailOutbox').where('status', 'in', ['pending', 'processing'])
      .where('availableAt', '<=', Timestamp.now()).orderBy('availableAt').limit(10).get();
    for (let offset = 0; offset < queued.docs.length; offset += 5) {
      await Promise.all(queued.docs.slice(offset, offset + 5).map(async item => {
        try {
          const outcome = await deliverBookingOutbox(item.id);
          if (outcome === 'sent') confirmationsSent++;
          if (outcome === 'retry') confirmationsRetry++;
        } catch { confirmationsRetry++; }
      }));
    }
  } catch { queueFailed = true; }
  try {
    const images = await runOwnedImageCleanup(db);
    const reminders = await runReminderBatch(db);
    try { depositHolds = await expireDepositHolds(); } catch { depositHolds.failed++; }
    const causes: string[] = [];
    if (images.failed) causes.push('IMAGE_CLEANUP_FAILED');
    if (reminders.failed) causes.push('REMINDER_BATCH_FAILED');
    if (confirmationsRetry) causes.push('CONFIRMATION_RETRY');
    if (queueFailed) causes.push('BOOKING_OUTBOX_FAILED');
    if (depositHolds.failed) causes.push('DEPOSIT_EXPIRY_FAILED');
    if (['failed', 'unavailable'].includes(emailUsage.alert)) causes.push('SMTP_USAGE_UNAVAILABLE');
    return NextResponse.json({ ...reminders, images, confirmationsSent, confirmationsRetry, queueFailed, depositHolds, emailUsage }, {
      status: causes.length ? 503 : 200,
      headers: await maintenanceFailureHeaders(request, '/api/cron', causes, { 'Cache-Control': 'no-store' }),
    });
  } catch {
    const headers = await maintenanceFailureHeaders(request, '/api/cron', ['MAINTENANCE_BATCH_UNAVAILABLE']);
    return NextResponse.json({ error: 'Reminder job unavailable', confirmationsSent, confirmationsRetry, queueFailed }, { status: 503, headers });
  }
}

export async function GET() { return NextResponse.json({ error: 'Method not allowed' }, { status: 405 }); }
