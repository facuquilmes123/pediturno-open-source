'use client';
import { useEffect, useState } from 'react';
import type { User } from 'firebase/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function DeliveryHealth({ user }: { user: User }) {
  const [health, setHealth] = useState<{ failed: number; more: boolean } | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    async function load() {
      try {
        const token = await user.getIdToken();
        const result = await fetch('/api/admin/delivery-health', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store', signal: controller.signal });
        if (!result.ok) throw new Error('Unavailable');
        const data = await result.json();
        if (active) { setHealth(data); setError(false); }
      } catch { if (active) setError(true); }
    }
    void load();
    const timer = setInterval(() => { void load(); }, 60_000);
    return () => { active = false; clearInterval(timer); controller.abort(); };
  }, [user]);
  return <Card><CardHeader><CardTitle className="text-base">Entrega de confirmaciones</CardTitle></CardHeader><CardContent className="text-sm">
    {error ? 'No se pudo comprobar la cola de correo.' : !health ? 'Comprobando la cola…' : health.failed ? <><p className="font-semibold text-destructive">{health.more ? 'Más de 100' : health.failed} confirmaciones requieren revisión.</p><p className="mt-2">Revisá estado de la reserva, dirección y entrega antes de reenviar. Esta alerta no ejecuta envíos ni modifica reservas.</p></> : 'No hay confirmaciones fallidas registradas en la cola.'}
  </CardContent></Card>;
}
