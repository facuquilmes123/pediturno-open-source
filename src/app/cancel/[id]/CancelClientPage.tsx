"use client";

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import { AlertCircle, Briefcase, Calendar, CheckCircle, Clock, Home, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

type PublicAppointment = { businessName: string; businessSlug: string | null; businessUrl: string | null; service: string; kind: 'service' | 'cancha' | 'space'; date: string; time: string };
type Status = 'loading' | 'ready' | 'submitting' | 'success' | 'invalid' | 'error';

function actionErrorMessage(error?: string): string {
  switch (error) {
    case 'Invalid or expired link': return 'El enlace no es válido, venció o ya fue utilizado.';
    case 'Slot already booked': return 'Ese horario ya fue reservado. Elegí otra fecha u horario.';
    case 'Selected time is unavailable': return 'La fecha u horario elegido ya no está disponible. Elegí otra opción.';
    case 'Invalid booking details': return 'Ingresá una fecha y un horario válidos.';
    case 'Invalid request': return 'No se pudo procesar la solicitud. Intentá nuevamente.';
    case 'Service unavailable': return 'El servicio no está disponible en este momento. Intentá más tarde.';
    default: return 'No se pudo procesar la solicitud. Intentá nuevamente.';
  }
}

export default function CancelClientPage() {
  const params = useParams();
  // This dynamic segment is an opaque capability token, never an appointment ID.
  const token = typeof params.id === 'string' ? params.id : '';
  const [status, setStatus] = useState<Status>('loading');
  const [appointment, setAppointment] = useState<PublicAppointment | null>(null);
  const [mode, setMode] = useState<'cancel' | 'reschedule'>('cancel');
  const [newDate, setNewDate] = useState('');
  const [newTime, setNewTime] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (!token) { setStatus('invalid'); return; }
    let active = true;
    void fetch(`/api/public/appointments/capability?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async response => ({ response, body: await response.json() as { appointment?: PublicAppointment } }))
      .then(({ response, body }) => {
        if (!active) return;
        if (!response.ok || !body.appointment) { setStatus('invalid'); return; }
        setAppointment(body.appointment); setStatus('ready');
      }).catch(() => { if (active) setStatus('error'); });
    return () => { active = false; };
  }, [token]);

  async function submit() {
    if (!appointment || status === 'submitting') return;
    if (mode === 'reschedule' && (!newDate || !newTime)) { setMessage('Elegí una nueva fecha y hora.'); return; }
    setStatus('submitting'); setMessage('');
    try {
      const response = await fetch('/api/public/appointments/action', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, action: mode, ...(mode === 'reschedule' ? { dateKey: newDate, time: newTime } : {}) }),
      });
      const result = await response.json() as { error?: string; action?: 'cancel' | 'reschedule'; nextToken?: string };
      if (response.ok && result.action) {
        if (result.action === 'reschedule' && result.nextToken) window.history.replaceState(null, '', `/cancel/${encodeURIComponent(result.nextToken)}`);
        setStatus('success'); return;
      }
      setMessage(actionErrorMessage(result.error));
      setStatus(result.error === 'Invalid or expired link' ? 'invalid' : 'ready');
    } catch { setMessage('No se pudo conectar con el servicio. Intentá nuevamente.'); setStatus('ready'); }
  }

  const originalDate = appointment ? new Date(appointment.date) : null;
  return <div className="flex min-h-screen items-center justify-center bg-secondary p-4">
    <Link href="/" className="absolute left-6 top-6 flex items-center gap-2 text-sm font-semibold text-muted-foreground hover:text-foreground"><Image src="/logo.webp" alt="Pediturno Online Logo" width={24} height={24} /> Pediturno Online</Link>
    <Card className="w-full max-w-md shadow-lg">
      {status === 'loading' ? <div className="flex flex-col items-center p-8 text-center"><Loader2 className="h-12 w-12 animate-spin text-primary" /><p className="mt-4">Verificando el enlace…</p></div>
        : status === 'success' ? <><CardHeader className="items-center"><CheckCircle className="mb-4 h-16 w-16 text-green-500" /><CardTitle>{mode === 'cancel' ? '¡Reserva cancelada!' : '¡Reserva reprogramada!'}</CardTitle><CardDescription>{mode === 'cancel' ? 'El horario quedó liberado.' : 'Guardamos tu nueva fecha y hora.'}</CardDescription></CardHeader><CardContent><Button asChild className="w-full"><Link href="/"><Home className="mr-2 h-4 w-4" />Volver al inicio</Link></Button></CardContent></>
        : status === 'invalid' || status === 'error' ? <><CardHeader className="items-center"><AlertCircle className="mb-4 h-16 w-16 text-destructive" /><CardTitle>{status === 'invalid' ? 'Enlace no válido' : 'Servicio no disponible'}</CardTitle><CardDescription>{status === 'invalid' ? 'El enlace puede haber vencido o ya fue utilizado.' : 'Intentá de nuevo más tarde o contactá al negocio.'}</CardDescription></CardHeader><CardContent><Button asChild className="w-full"><Link href="/"><Home className="mr-2 h-4 w-4" />Volver al inicio</Link></Button></CardContent></>
        : appointment ? <><CardHeader><CardTitle className="text-center">{mode === 'cancel' ? '¿Cancelar esta reserva?' : 'Reprogramar reserva'}</CardTitle><CardDescription className="text-center">{appointment.businessName}</CardDescription></CardHeader><CardContent className="space-y-4"><div className="space-y-2 rounded-lg border bg-secondary/50 p-4 text-sm"><p className="flex items-center gap-3"><Briefcase className="h-4 w-4" />{appointment.service}</p><p className="flex items-center gap-3"><Calendar className="h-4 w-4" />{originalDate ? format(originalDate, 'PPP', { locale: es }) : ''}</p><p className="flex items-center gap-3"><Clock className="h-4 w-4" />{appointment.time}</p></div><div className="flex gap-2"><Button className="flex-1" type="button" variant={mode === 'cancel' ? 'destructive' : 'outline'} onClick={() => setMode('cancel')}>Cancelar</Button><Button className="flex-1" type="button" variant={mode === 'reschedule' ? 'default' : 'outline'} onClick={() => setMode('reschedule')}>Reprogramar</Button></div>{mode === 'reschedule' && <div className="grid grid-cols-2 gap-2"><Input aria-label="Nueva fecha" type="date" value={newDate} onChange={event => setNewDate(event.target.value)} /><Input aria-label="Nueva hora" type="time" value={newTime} onChange={event => setNewTime(event.target.value)} /></div>}{message && <p className="text-sm text-destructive" role="alert">{message}</p>}</CardContent><CardFooter className="flex gap-2"><Button asChild className="flex-1" variant="outline"><Link href={appointment.businessUrl || '/'}>Volver</Link></Button><Button className="flex-1" disabled={status === 'submitting'} onClick={submit}>{status === 'submitting' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{mode === 'cancel' ? 'Confirmar cancelación' : 'Confirmar cambio'}</Button></CardFooter></>
        : null}
    </Card>
  </div>;
}
