import { after } from 'next/server';
import { deliverBookingOutbox } from '@/lib/booking-outbox';

/** The durable outbox is committed first. Cron recovers interrupted/failed immediate delivery. */
export function scheduleBookingDelivery(outboxId: string | undefined): void {
  if (!outboxId) return;
  // Test bookings remain durable locally without contacting SMTP/FCM providers.
  if (process.env.FIREBASE_PROJECT_ID?.startsWith('demo-') || process.env.FIRESTORE_EMULATOR_HOST) return;
  after(async () => {
    try { await deliverBookingOutbox(outboxId); }
    catch { console.error('No se pudo procesar el aviso inmediato; permanece en la cola de reintentos.'); }
  });
}
