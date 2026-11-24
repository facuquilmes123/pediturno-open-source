export type EmailActionMode = 'resetPassword' | 'verifyEmail' | 'recoverEmail' | 'verifyAndChangeEmail';
export type EmailActionInput = { mode: EmailActionMode; code: string; returnUrl: string };

export const EMAIL_ACTION_OPERATIONS = {
  verifyEmail: 'VERIFY_EMAIL',
  recoverEmail: 'RECOVER_EMAIL',
  verifyAndChangeEmail: 'VERIFY_AND_CHANGE_EMAIL',
} as const;

const origins = new Set(['https://pediturno.com', 'https://canchas.pediturno.com', 'https://espacios.pediturno.com']);

/** The link cannot choose a Firebase project, tenant, or arbitrary redirect. */
export function parseEmailAction(search: string): EmailActionInput | null {
  const params = new URLSearchParams(search);
  const mode = params.get('mode'); const code = params.get('oobCode');
  if (params.getAll('mode').length !== 1 || params.getAll('oobCode').length !== 1
      || !['resetPassword', 'verifyEmail', 'recoverEmail', 'verifyAndChangeEmail'].includes(mode || '')
      || !code || code.length > 2048 || /\s/.test(code) || params.has('tenantId')) return null;
  let origin = 'https://pediturno.com';
  try {
    const target = new URL(params.get('continueUrl') || '');
    if (!target.username && !target.password && origins.has(target.origin)) origin = target.origin;
  } catch { /* A missing or invalid continuation uses Services. */ }
  return { mode: mode as EmailActionMode, code, returnUrl: origin + '/?login=1' };
}

export function emailActionIssue(error: unknown): { message: string; retryable: boolean } {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
  if (code === 'auth/expired-action-code' || code === 'auth/invalid-action-code') {
    return { message: 'Este enlace venció o ya fue usado. Volvé al ingreso y solicitá uno nuevo.', retryable: false };
  }
  if (code === 'auth/weak-password' || code === 'auth/password-does-not-meet-requirements') {
    return { message: 'La contraseña no cumple los requisitos de seguridad. Elegí otra y volvé a intentar.', retryable: false };
  }
  if (code === 'auth/user-disabled') {
    return { message: 'No pudimos completar esta acción. Contactá a soporte para revisar tu cuenta.', retryable: false };
  }
  return { message: 'No pudimos completar la conexión segura. Revisá tu conexión y volvé a intentar.', retryable: true };
}
