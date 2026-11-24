import { randomUUID } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { androidError, requireAndroidOwner, type AndroidOwnerApiError } from '@/lib/android-owner-api';
import { ACCOUNT_DELETION_OPERATIONAL_SLA_DAYS, ACCOUNT_DELETION_OPERATIONAL_SLA_MS } from '@/lib/account-deletion-policy';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
const MAX_REAUTH_AGE_SECONDS = 5 * 60;

/**
 * This is a durable privacy request, not a pretend instant deletion. The admin
 * deletion workflow retains financial history and performs the anonymisation
 * stage only after review. Repeating DELETE returns the same persisted ticket.
 */
export async function DELETE(request: NextRequest) {
  try {
    const owner = await requireAndroidOwner(request, { allowDeletionRequested: true, allowOtherBusinessTypes: true });
    if (owner.authTime === null || owner.authTime < Math.floor(Date.now() / 1000) - MAX_REAUTH_AGE_SECONDS) {
      return androidError('Recent sign-in required before requesting deletion', 403, 'REAUTH_REQUIRED');
    }
    const requestRef = owner.db.collection('accountDeletionRequests').doc(owner.uid);
    const businessRef = owner.db.collection('businesses').doc(owner.uid);
    const result = await owner.db.runTransaction(async transaction => {
      const existing = await transaction.get(requestRef);
      if (existing.exists) {
        const requestId = existing.get('requestId');
        const status = existing.get('status');
        if (typeof requestId === 'string' && typeof status === 'string') return { requestId, status, repeated: true };
        throw new Error('CORRUPT_REQUEST');
      }
      const requestId = randomUUID();
      const identityVerifiedAt = Timestamp.now();
      transaction.create(requestRef, {
        requestId, ownerId: owner.uid, status: 'deletion_requested', source: 'android',
        // Makes the first cron attempt queryable alongside retries. A missing
        // value would be invisible to the due-time index and could starve.
        nextAttemptAt: Timestamp.fromMillis(0), requestedAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(),
        identityVerifiedAt,
        operationalDueAt: Timestamp.fromMillis(identityVerifiedAt.toMillis() + ACCOUNT_DELETION_OPERATIONAL_SLA_MS),
        operationalSlaDays: ACCOUNT_DELETION_OPERATIONAL_SLA_DAYS,
        retention: {
          financialRecords: 'preserve',
          operationalRecords: 'closed_immediately_anonymize_after_review',
          authentication: 'revoke_only_when_execution_begins',
        },
      });
      transaction.create(owner.db.collection('accountDeletionAudit').doc(requestId), {
        requestId, ownerId: owner.uid, event: 'requested', source: 'android', createdAt: FieldValue.serverTimestamp(),
      });
      transaction.update(businessRef, {
        // Closing the public surface is an immediate, auditable effect. The later
        // deletion worker keeps financial records and performs anonymisation.
        status: 'deletion_requested', deletionRequestId: requestId,
        deletionRequestedAt: FieldValue.serverTimestamp(), deletionRequestStatus: 'deletion_requested',
      });
      return { requestId, status: 'deletion_requested', repeated: false };
    });
    return NextResponse.json({ requestId: result.requestId, status: result.status }, { status: result.repeated ? 200 : 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    const error = cause as AndroidOwnerApiError;
    if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
    return androidError('Deletion request unavailable', 503, 'DELETION_REQUEST_UNAVAILABLE');
  }
}
