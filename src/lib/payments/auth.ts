import { getAuth } from 'firebase-admin/auth';
import { initializeAdminApp } from '@/lib/firebase-admin';

export async function requireFirebaseUser(idToken: unknown): Promise<{ uid: string; email?: string }> {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 16_384) {
    throw new Error('Sesión inválida o expirada.');
  }

  initializeAdminApp();
  const decoded = await getAuth().verifyIdToken(idToken, true);
  return { uid: decoded.uid, email: decoded.email };
}
