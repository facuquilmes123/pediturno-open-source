import 'server-only';
import { createHash } from 'node:crypto';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';

const WINDOW_MS = 60_000;
const READS_PER_WINDOW = 60;
const BURST_MS = 5_000;
const BURST_ATTEMPTS = 12;
const MAX_MEMORY_OWNERS = 1_000;

type MemoryEntry = { attempts: number[]; blockedUntil: number };
export type OwnerReadDecision =
  | { allowed: true; status: 200; retryAfterSeconds: 0 }
  | { allowed: false; status: 429 | 503; retryAfterSeconds: number };

/** Expensive read admission only. No response cache and no commercial/data quota. */
export function createOwnerReadLimiter(now: () => number = Date.now) {
  const memory = new Map<string, MemoryEntry>();
  return async (db: Firestore, uid: string): Promise<OwnerReadDecision> => {
    if (!uid || uid.length > 128) throw new Error('Expected verified owner UID');
    const time = now();
    const denied = (until: number): OwnerReadDecision => ({
      allowed: false, status: 429, retryAfterSeconds: Math.max(1, Math.ceil((until - time) / 1_000)),
    });
    let entry = memory.get(uid);
    if (!entry) {
      // Capacity eviction is needed only for a new owner, never to reset an
      // existing owner's gate. The distributed gate still bounds evicted keys.
      if (memory.size >= MAX_MEMORY_OWNERS) {
        const oldest = memory.keys().next().value;
        if (oldest !== undefined) memory.delete(oldest);
      }
      entry = { attempts: [], blockedUntil: 0 };
    }
    memory.delete(uid); memory.set(uid, entry);
    entry.attempts = entry.attempts.filter(at => time - at < BURST_MS);
    if (entry.blockedUntil > time) return denied(entry.blockedUntil);
    if (entry.attempts.length >= BURST_ATTEMPTS) return denied(entry.attempts[0] + BURST_MS);
    // Count attempts, including storage failures, to prevent retry floods.
    entry.attempts.push(time);

    const start = Math.floor(time / WINDOW_MS) * WINDOW_MS;
    // Existing operational collection is also purged by the previous release
    // and admin deletion path. Prefix is disjoint from public counters' hex IDs,
    // so rollback cannot orphan a deleted owner's counter or change public quotas.
    const ref = db.collection('bookingRateLimits').doc('owner-read-v1_' + createHash('sha256').update(uid).digest('hex'));
    try {
      const admission = await db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        const stored = snapshot.data();
        if (snapshot.exists && (
          stored?.businessId !== uid || stored?.kind !== 'owner-read' || !Number.isSafeInteger(stored?.windowStartMs) ||
          !Number.isSafeInteger(stored?.count) || stored!.count < 0 ||
          !Array.isArray(stored?.recentAdmissionsMs) || stored!.recentAdmissionsMs.length > BURST_ATTEMPTS ||
          stored!.recentAdmissionsMs.some((value: unknown) => !Number.isSafeInteger(value))
        )) throw new Error('Invalid rate-limit state');
        const count = stored?.windowStartMs === start ? stored.count as number : 0;
        if (count >= READS_PER_WINDOW) return { allowed: false, retryAt: start + WINDOW_MS };
        // The burst also survives cold starts/multiple processes, including a
        // burst spanning a fixed-minute boundary. At most twelve timestamps.
        const recent: number[] = (stored?.recentAdmissionsMs ?? []).filter((at: number) => time - at < BURST_MS);
        if (recent.length >= BURST_ATTEMPTS) return { allowed: false, retryAt: Math.min(...recent) + BURST_MS };
        tx.set(ref, { businessId: uid, kind: 'owner-read', windowStartMs: start, count: count + 1,
          recentAdmissionsMs: [...recent, time], updatedAt: FieldValue.serverTimestamp() });
        return { allowed: true, retryAt: 0 };
      });
      if (!admission.allowed) {
        entry.blockedUntil = admission.retryAt;
        return denied(entry.blockedUntil);
      }
      return { allowed: true, status: 200, retryAfterSeconds: 0 };
    } catch {
      // Do not log UID, credentials, provider response or return stale data.
      return { allowed: false, status: 503, retryAfterSeconds: 15 };
    }
  };
}

export const checkOwnerReadRateLimit = createOwnerReadLimiter();

export function ownerReadRateLimitResponse(decision: OwnerReadDecision): Response {
  if (decision.allowed) throw new Error('Cannot reject an admitted read');
  const unavailable = decision.status === 503;
  return Response.json({
    error: unavailable ? 'No pudimos verificar el acceso. Volvé a intentar en unos segundos.' : 'Demasiadas consultas. Volvé a intentar en unos segundos.',
    code: unavailable ? 'OWNER_READ_LIMIT_UNAVAILABLE' : 'OWNER_READ_RATE_LIMITED',
  }, { status: decision.status, headers: { 'Retry-After': String(decision.retryAfterSeconds), 'Cache-Control': 'no-store' } });
}
