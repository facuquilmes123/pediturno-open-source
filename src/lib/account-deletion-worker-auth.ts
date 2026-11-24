import 'server-only';
import { timingSafeEqual } from 'node:crypto';
export function isAccountDeletionWorkerAuthorized(request: Pick<Request, 'headers'>) {
  const expected = process.env.ACCOUNT_DELETION_WORKER_KEY;
  const supplied = request.headers.get('x-account-deletion-worker-key');
  if (!expected || expected.length < 24 || !supplied) return false;
  const left = Buffer.from(expected); const right = Buffer.from(supplied);
  return left.length === right.length && timingSafeEqual(left, right);
}
