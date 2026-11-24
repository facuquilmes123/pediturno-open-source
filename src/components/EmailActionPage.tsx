"use client";

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { applyActionCode, checkActionCode, confirmPasswordReset, verifyPasswordResetCode } from 'firebase/auth';
import { ArrowLeft, CheckCircle2, KeyRound, Loader2, MailCheck, ShieldCheck } from 'lucide-react';
import { auth, ensureFirebaseReady } from '@/lib/firebase';
import { EMAIL_ACTION_OPERATIONS, emailActionIssue, parseEmailAction, type EmailActionInput, type EmailActionMode } from '@/lib/email-actions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const titles: Record<EmailActionMode, string> = {
  resetPassword: 'Elegí tu nueva contraseña',
  verifyEmail: 'Verificá tu correo',
  recoverEmail: 'Recuperá tu correo anterior',
  verifyAndChangeEmail: 'Confirmá tu nuevo correo',
};

export default function EmailActionPage() {
  // Keep the one-time code in memory, never in storage, telemetry, or a return link.
  const input = useRef<EmailActionInput | null | undefined>(undefined);
  const pending = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'working' | 'success' | 'error'>('loading');
  const [mode, setMode] = useState<EmailActionMode>('verifyEmail');
  const [returnUrl, setReturnUrl] = useState('https://pediturno.com/?login=1');
  const [issue, setIssue] = useState<{ message: string; retryable: boolean } | null>(null);
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');

  useEffect(() => {
    let active = true;
    if (input.current === undefined) {
      input.current = parseEmailAction(window.location.search);
      window.history.replaceState(window.history.state, '', window.location.pathname);
    }
    const action = input.current;
    if (!action) {
      setIssue({ message: 'El enlace está incompleto o no corresponde a una acción disponible. Solicitá uno nuevo desde el ingreso.', retryable: false });
      setPhase('error');
      return;
    }
    setMode(action.mode); setReturnUrl(action.returnUrl); setPhase('loading'); setIssue(null);
    void (async () => {
      try {
        await ensureFirebaseReady();
        if (!active) return;
        if (!auth) throw new Error('Auth unavailable');
        if (action.mode === 'resetPassword') {
          await verifyPasswordResetCode(auth, action.code);
        } else {
          const info = await checkActionCode(auth, action.code);
          if (info.operation !== EMAIL_ACTION_OPERATIONS[action.mode]) throw Object.assign(new Error('Invalid action'), { code: 'auth/invalid-action-code' });
        }
        if (active) setPhase('ready');
      } catch (error) {
        if (active) { setIssue(emailActionIssue(error)); setPhase('error'); }
      }
    })();
    return () => { active = false; };
  }, [attempt]);

  async function complete(event: FormEvent) {
    event.preventDefault();
    const action = input.current;
    if (!action || phase !== 'ready' || pending.current) return;
    if (action.mode === 'resetPassword' && (password.length < 6 || password !== confirmation)) {
      setIssue({ message: password.length < 6 ? 'Usá al menos 6 caracteres.' : 'Las contraseñas no coinciden.', retryable: false });
      return;
    }
    pending.current = true; setPhase('working'); setIssue(null);
    try {
      await ensureFirebaseReady();
      if (!auth) throw new Error('Auth unavailable');
      if (action.mode === 'resetPassword') await confirmPasswordReset(auth, action.code, password);
      else await applyActionCode(auth, action.code);
      input.current = null; setPassword(''); setConfirmation(''); setPhase('success');
    } catch (error) {
      const nextIssue = emailActionIssue(error); setIssue(nextIssue);
      const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
      setPhase(code === 'auth/expired-action-code' || code === 'auth/invalid-action-code' || code === 'auth/user-disabled' ? 'error' : 'ready');
    } finally { pending.current = false; }
  }

  const loading = phase === 'loading' || phase === 'working';
  return <main className="flex min-h-dvh items-center justify-center bg-background px-5 py-12">
    <section aria-labelledby="email-action-title" className="w-full max-w-md rounded-3xl border bg-card p-7 shadow-xl shadow-primary/5 sm:p-9">
      <Link href="https://pediturno.com/" className="text-lg font-bold tracking-tight">Pediturno<span className="text-primary">.</span></Link>
      <div className="mb-6 mt-8 inline-flex rounded-2xl bg-primary/10 p-3 text-primary" aria-hidden="true">
        {phase === 'success' ? <CheckCircle2 className="h-7 w-7" /> : mode === 'resetPassword' ? <KeyRound className="h-7 w-7" /> : <MailCheck className="h-7 w-7" />}
      </div>
      <h1 id="email-action-title" className="text-2xl font-semibold tracking-tight">{phase === 'success' ? 'Listo, tu cuenta está actualizada' : titles[mode]}</h1>
      <div className="mt-3 text-sm leading-relaxed text-muted-foreground" aria-live="polite">
        {loading && <p role="status" className="flex items-center gap-2"><Loader2 aria-hidden="true" className="h-4 w-4 shrink-0 animate-spin" />{phase === 'working' ? 'Guardando el cambio…' : 'Comprobando tu enlace seguro…'}</p>}
        {phase === 'success' && <p>{mode === 'resetPassword' ? 'Ya podés ingresar con tu nueva contraseña.' : 'La acción se completó. Podés volver a Pediturno para continuar.'}</p>}
        {phase === 'ready' && <p>{mode === 'resetPassword' ? 'Usá una contraseña única que no hayas usado en otro sitio.' : mode === 'recoverEmail' ? 'Si no reconocés el cambio de dirección, confirmá para restaurar el correo anterior.' : 'Confirmá para completar la verificación de tu dirección de correo.'}</p>}
      </div>
      {issue && <p role="alert" className="mt-5 rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-sm">{issue.message}</p>}
      {(phase === 'ready' || phase === 'working') && <form onSubmit={complete} className="mt-6 space-y-4">
        {mode === 'resetPassword' && <>
          <div className="space-y-2"><Label htmlFor="new-password">Nueva contraseña</Label><Input id="new-password" type="password" autoComplete="new-password" minLength={6} maxLength={4096} required disabled={loading} value={password} onChange={e => setPassword(e.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="confirm-password">Repetí la contraseña</Label><Input id="confirm-password" type="password" autoComplete="new-password" minLength={6} maxLength={4096} required disabled={loading} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></div>
        </>}
        <Button type="submit" className="min-h-11 w-full" disabled={loading}>{phase === 'working' ? 'Guardando…' : mode === 'resetPassword' ? 'Guardar nueva contraseña' : mode === 'recoverEmail' ? 'Restaurar mi correo' : 'Confirmar verificación'}</Button>
      </form>}
      {phase === 'error' && issue?.retryable && <Button type="button" variant="outline" className="mt-5 min-h-11 w-full" onClick={() => setAttempt(value => value + 1)}>Volver a intentar</Button>}
      <Link href={returnUrl} className="mt-6 inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"><ArrowLeft aria-hidden="true" className="h-4 w-4" />Volver al ingreso</Link>
      <p className="mt-6 flex items-center gap-2 border-t pt-5 text-xs text-muted-foreground"><ShieldCheck aria-hidden="true" className="h-4 w-4 shrink-0" />Nunca te pediremos códigos ni contraseñas por chat.</p>
    </section>
  </main>;
}
