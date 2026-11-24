import { NextRequest } from 'next/server';
import { getAuth } from 'firebase-admin/auth';
import { initializeAdminApp } from '@/lib/firebase-admin';
import { ADMIN_EMAILS } from '@/lib/config';

/**
 * Server-side authorization guard for admin API endpoints.
 * Verifies that the incoming request contains a valid Firebase ID Token belonging to an email in ADMIN_EMAILS.
 */
export async function verifyAdminRequest(
  request: NextRequest
): Promise<{ authorized: boolean; email?: string; error?: string }> {
  try {
    initializeAdminApp();
    const authHeader = request.headers.get('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return {
        authorized: false,
        error: 'No autorizado: Token de autenticación ausente.',
      };
    }

    const token = authHeader.split('Bearer ')[1]?.trim();
    if (!token) {
      return {
        authorized: false,
        error: 'No autorizado: Token vacío.',
      };
    }

    const decodedToken = await getAuth().verifyIdToken(token, true);
    const userEmail = decodedToken.email;

    if (!decodedToken.email_verified || !userEmail || !ADMIN_EMAILS.includes(userEmail)) {
      return {
        authorized: false,
        error: 'Acceso denegado: Se requieren privilegios de administrador.',
      };
    }

    return { authorized: true, email: userEmail };
  } catch (err: any) {
    console.error('[Admin Auth Guard] Error verifying admin token:', err);
    return {
      authorized: false,
      error: 'Token inválido o sesión expirada.',
    };
  }
}
