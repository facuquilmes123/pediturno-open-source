'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { DollarSign, Loader2, Unlink } from 'lucide-react';
import { disconnectMercadoPagoAccount, updateMercadoPagoSettings } from '@/services/mercadopago';
import { BusinessProfile } from '@/services/data';
import { auth } from '@/lib/firebase';
import { canUseOnlineDeposits } from '@/lib/release-features';

export default function MercadoPagoSettingsCard({ profile, userId, onProfileUpdated }: { profile: BusinessProfile; userId: string; onProfileUpdated: () => void }) {
  const { toast } = useToast();
  const [availability, setAvailability] = useState({ configured: false, connected: false, depositsEnabled: false });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [requireDeposit, setRequireDeposit] = useState(profile.mercadopago?.requireDeposit === true);
  const [depositType, setDepositType] = useState<'fixed' | 'percentage'>(profile.mercadopago?.depositType || 'percentage');
  const [value, setValue] = useState(String(profile.mercadopago?.depositValue ?? 30));
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const user = auth?.currentUser;
        if (!user || user.uid !== userId) return;
        const response = await fetch('/api/auth/mercadopago/start', { headers: { Authorization: `Bearer ${await user.getIdToken()}` }, cache: 'no-store' });
        if (!response.ok) throw new Error('Availability failed');
        const data = await response.json();
        if (!cancelled) setAvailability(data);
      } catch { if (!cancelled) setAvailability({ configured: false, connected: false, depositsEnabled: false }); }
      finally { if (!cancelled) setLoading(false); }
    };
    void load();
    setRequireDeposit(profile.mercadopago?.requireDeposit === true);
    return () => { cancelled = true; };
  }, [userId, profile]);
  const token = async () => {
    const user = auth?.currentUser;
    if (!user || user.uid !== userId) throw new Error('La sesión cambió. Volvé a iniciar sesión.');
    return user.getIdToken();
  };
  const connect = async () => {
    setBusy(true);
    try {
      const response = await fetch('/api/auth/mercadopago/start', { method: 'POST', headers: { Authorization: `Bearer ${await token()}` } });
      const result = await response.json();
      if (!response.ok || !result.url) throw new Error(result.error || 'No se pudo iniciar la vinculación.');
      window.location.assign(result.url);
    } catch (error) { toast({ variant: 'destructive', title: 'No se pudo vincular', description: error instanceof Error ? error.message : 'Volvé a intentar.' }); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    if (!confirm('¿Querés desvincular Mercado Pago? Las reservas con señas pendientes deben resolverse primero.')) return;
    setBusy(true);
    try {
      const result = await disconnectMercadoPagoAccount(await token());
      if (!result.success) throw new Error(result.message);
      onProfileUpdated(); toast({ title: 'Cuenta desvinculada' });
    } catch (error) { toast({ variant: 'destructive', title: 'No se pudo desvincular', description: error instanceof Error ? error.message : 'Volvé a intentar.' }); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true);
    try {
      const result = await updateMercadoPagoSettings(await token(), { requireDeposit, depositType, depositValue: Number(value.replace(',', '.')) });
      if (!result.success) throw new Error(result.message);
      onProfileUpdated(); toast({ title: 'Señas actualizadas' });
    } catch (error) { toast({ variant: 'destructive', title: 'No se pudo guardar', description: error instanceof Error ? error.message : 'Volvé a intentar.' }); }
    finally { setBusy(false); }
  };
  if (!canUseOnlineDeposits(profile.businessType)) {
    if (!availability.connected && !profile.mercadopago?.isConnected) return null;
    return <Card><CardHeader><CardTitle>Cuenta de Mercado Pago vinculada</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p>Las nuevas reservas se realizan sin seña. El historial de pagos existentes se conserva.</p><Button variant="outline" onClick={disconnect} disabled={busy}><Unlink className="mr-2 h-4 w-4" />Desvincular cuenta</Button></CardContent></Card>;
  }
  return <Card className="border-primary/20"><CardHeader><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="flex items-center gap-2 text-xl"><DollarSign className="h-5 w-5 text-sky-600" />Señas con Mercado Pago</CardTitle><Badge variant="secondary">{loading ? 'Consultando' : availability.connected ? 'Cuenta vinculada' : 'Vinculá tu cuenta'}</Badge></div></CardHeader><CardContent className="space-y-4 text-sm">
    <p className="text-muted-foreground">Recibí las señas en tu propia cuenta. Mercado Pago gestiona el cobro y aplica sus cargos habituales. Pediturno no agrega una comisión a estas señas.</p>
    {!availability.configured && !loading && <p className="rounded-lg bg-secondary p-3">La vinculación está pendiente de la configuración del servicio. Las reservas actuales siguen disponibles sin seña.</p>}
    <div className="flex flex-wrap gap-2"><Button onClick={connect} disabled={loading || busy || !availability.configured}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{availability.connected ? 'Volver a vincular' : 'Vincular Mercado Pago'}</Button>{(availability.connected || profile.mercadopago?.isConnected) && <Button variant="outline" onClick={disconnect} disabled={busy}><Unlink className="mr-2 h-4 w-4" />Desvincular</Button>}</div>
    {availability.connected && <div className="space-y-4 rounded-lg border p-4">
      {!availability.depositsEnabled && <p className="text-muted-foreground">Tu cuenta está vinculada. La recepción de señas estará disponible cuando se complete la activación del servicio.</p>}
      <div className="flex items-center justify-between gap-3"><Label htmlFor="require-deposit">Pedir seña al reservar</Label><Switch id="require-deposit" checked={requireDeposit} onCheckedChange={setRequireDeposit} disabled={busy || !availability.depositsEnabled} /></div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="deposit-type">Tipo de seña</Label><select id="deposit-type" className="h-10 w-full rounded-md border bg-background px-3" value={depositType} onChange={event => setDepositType(event.target.value as 'fixed' | 'percentage')}><option value="percentage">Porcentaje del precio</option><option value="fixed">Importe fijo en pesos</option></select></div><div className="space-y-2"><Label htmlFor="deposit-value">{depositType === 'percentage' ? 'Porcentaje (1 a 100)' : 'Importe en ARS'}</Label><Input id="deposit-value" inputMode="decimal" value={value} onChange={event => setValue(event.target.value)} /></div></div>
      <p className="text-xs text-muted-foreground">La seña no puede superar el precio de la reserva. El horario se guarda durante el pago por hasta 30 minutos. Si un cliente cancela después de pagar, revisá la devolución en tu cuenta de Mercado Pago.</p>
      <Button onClick={save} disabled={busy || requireDeposit && !availability.depositsEnabled}>Guardar señas</Button>
    </div>}
  </CardContent></Card>;
}
