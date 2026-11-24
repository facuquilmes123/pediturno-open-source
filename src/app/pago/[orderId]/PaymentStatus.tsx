'use client';

import { useEffect, useState } from 'react';
import { CheckCircle, Clock, Loader2, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { publicAppCheckHeaders } from '@/lib/app-check-client';

type PaymentState = { status: string; amount: number; checkoutUrl?: string | null; businessUrl?: string | null; expiresAt: string };
export default function PaymentStatus({ orderId }: { orderId: string }) {
  const [state, setState] = useState<PaymentState | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const load = async () => {
      try {
        const response = await fetch(`/api/public/deposits/${encodeURIComponent(orderId)}`, { cache: 'no-store' });
        if (!response.ok) throw new Error('No se pudo consultar esta reserva.');
        const data = await response.json() as PaymentState;
        if (cancelled) return;
        setState(data); setError('');
        if (!['approved', 'expired', 'review', 'cancelled'].includes(data.status) && ++attempts < 60) timer = setTimeout(load, 5000);
      } catch { if (!cancelled) setError('No se pudo consultar el estado. Volvé a intentar.'); }
    };
    void load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [orderId, refresh]);
  const pay = async () => {
    setBusy(true); setError('');
    try {
      const response = await fetch(`/api/public/deposits/${encodeURIComponent(orderId)}`, { method: 'POST', headers: await publicAppCheckHeaders({ consume: true }) });
      const data = await response.json();
      if (!response.ok || !data.checkoutUrl) throw new Error('El pago aún no está disponible. Actualizá el estado antes de volver a intentar.');
      window.location.assign(data.checkoutUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo abrir el pago.'); }
    finally { setBusy(false); }
  };
  const paid = state?.status === 'approved';
  const expired = state?.status === 'expired';
  const review = state?.status === 'review';
  const cancelled = state?.status === 'cancelled';
  return <main className="flex min-h-screen items-center justify-center bg-secondary/30 p-4"><Card className="w-full max-w-md"><CardContent className="space-y-5 p-6 text-center">
    {paid ? <CheckCircle className="mx-auto h-12 w-12 text-green-600" /> : expired || review || cancelled ? <AlertCircle className="mx-auto h-12 w-12 text-amber-600" /> : <Clock className="mx-auto h-12 w-12 text-primary" />}
    <h1 className="text-2xl font-bold">{paid ? 'Seña acreditada' : cancelled ? 'La reserva fue cancelada' : expired ? 'El plazo de pago venció' : review ? 'Tu pago necesita revisión' : 'Completá la seña de tu reserva'}</h1>
    <p className="text-sm text-muted-foreground">{paid ? 'El negocio recibió tu seña. Recibirás por correo el estado de tu reserva y sus detalles.' : cancelled ? 'No pagues esta seña. Podés volver al negocio para elegir una nueva reserva.' : expired ? 'El horario fue liberado. Podés volver a elegir una reserva.' : review ? 'Contactá al negocio para revisar el pago. Evitá pagar nuevamente.' : 'El horario se guarda temporalmente mientras completás el pago. La reserva queda asignada después de verificar la seña en Mercado Pago.'}</p>
    {state && <p className="text-xl font-semibold">{new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(state.amount)}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {state && !paid && !expired && !review && !cancelled && new Date(state.expiresAt).getTime() > Date.now() && <Button className="w-full" onClick={pay} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Pagar seña con Mercado Pago</Button>}
    {!paid && !expired && !review && !cancelled && <Button className="w-full" variant="outline" onClick={() => setRefresh(value => value + 1)}>Actualizar estado</Button>}
    {state?.businessUrl && <Button asChild variant="ghost" className="w-full"><a href={state.businessUrl}>Volver al negocio</a></Button>}
  </CardContent></Card></main>;
}
