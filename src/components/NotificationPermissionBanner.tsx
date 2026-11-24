'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@/hooks/useAuthRedirect';
import { pushReadiness, requestPermissionAndSubscribe, unsubscribePushNotifications } from '@/lib/push-client';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Bell, Loader2, X } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

const KEY = 'pediturno_notifications_later';

export default function NotificationPermissionBanner({ settings = false }: { settings?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [readiness, setReadiness] = useState<ReturnType<typeof pushReadiness>>('unsupported');
  const [permission, setPermission] = useState<NotificationPermission>('default');
  const [subscribed, setSubscribed] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const update = async () => {
      setReadiness(pushReadiness());
      setPermission('Notification' in window ? Notification.permission : 'default');
      try { setDismissed(Date.now() - Number(localStorage.getItem(`${KEY}:${user?.uid}`) || 0) < 7 * 86400000); } catch { /* Optional storage. */ }
      if ('serviceWorker' in navigator) {
        const registration = await navigator.serviceWorker.getRegistration('/service-worker.js').catch(() => undefined);
        const subscription = await registration?.pushManager?.getSubscription().catch(() => null);
        setSubscribed(!!subscription);
      }
    };
    void update();
    window.addEventListener('focus', update);
    return () => window.removeEventListener('focus', update);
  }, [user]);

  const dismiss = () => {
    try { localStorage.setItem(`${KEY}:${user?.uid}`, String(Date.now())); } catch { /* Optional storage. */ }
    setDismissed(true);
  };
  const activate = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const success = await requestPermissionAndSubscribe(user.uid);
      const currentPermission = 'Notification' in window ? Notification.permission : 'default';
      setPermission(currentPermission);
      setSubscribed(success);
      toast(success ? { title: 'Notificaciones activadas', description: 'Recibirás avisos de nuevas reservas y turnos por empezar.' } : {
        variant: 'destructive', title: currentPermission === 'denied' ? 'Permiso bloqueado' : 'No se pudo activar',
        description: currentPermission === 'denied' ? 'Habilitá las notificaciones de Pediturno en los ajustes del navegador o del dispositivo.' : 'No quedó activa la suscripción. Revisá tu conexión y volvé a intentar.',
      });
    } finally { setBusy(false); }
  };
  const deactivate = async () => {
    if (!user) return;
    setBusy(true);
    try { await unsubscribePushNotifications(user.uid); setSubscribed(false); dismiss(); }
    finally { setBusy(false); }
  };
  const test = async () => {
    if (!user) return;
    setBusy(true);
    try {
      const result = await fetch('/api/push/test', { method: 'POST', headers: { Authorization: `Bearer ${await user.getIdToken()}` } });
      if (!result.ok) throw new Error('Test failed');
      toast({ title: 'Aviso de prueba enviado', description: 'Comprobá que aparezca en tu dispositivo.' });
    } catch { toast({ variant: 'destructive', title: 'No se pudo enviar el aviso de prueba' }); }
    finally { setBusy(false); }
  };

  if (!user || (!settings && (dismissed || subscribed || readiness !== 'ready'))) return null;
  const description = readiness === 'install-ios'
    ? 'En iPhone o iPad, instalá Pediturno y abrila desde la pantalla de inicio. Después activá los avisos aquí. Requiere iOS/iPadOS 16.4 o posterior.'
    : readiness === 'unsupported' ? 'Este navegador no permite avisos push. Usá una versión actual de Chrome, Edge o Safari con conexión segura.'
    : readiness === 'unconfigured' ? 'Los avisos en este dispositivo estarán disponibles cuando se complete la configuración del servicio.'
    : permission === 'denied' ? 'El permiso está bloqueado. Habilitá las notificaciones para Pediturno en los ajustes del navegador o del dispositivo y volvé a esta pantalla.'
    : subscribed ? 'Este dispositivo está suscrito a nuevas reservas y avisos 30 minutos antes. Podés probarlos o desactivarlos.'
    : 'Recibí avisos de nuevas reservas y 30 minutos antes de comenzar, aunque la app esté cerrada. Podés desactivarlos cuando quieras.';
  return <Card className="mb-6 border-primary/20 bg-secondary/40"><CardContent className="flex flex-wrap items-center gap-3 p-4">
    <Bell className="h-7 w-7 shrink-0 text-primary" />
    <div className="min-w-0 flex-1 basis-48"><h3 className="font-semibold">{subscribed ? 'Notificaciones activas' : 'Tu agenda te avisa'}</h3><p className="text-sm text-muted-foreground">{description}</p></div>
    {readiness === 'ready' && permission !== 'denied' && !subscribed && <Button onClick={activate} disabled={busy}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Activar notificaciones</Button>}
    {settings && subscribed && <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={test} disabled={busy}>Probar aviso</Button><Button variant="ghost" onClick={deactivate} disabled={busy}>Desactivar en este dispositivo</Button></div>}
    {!settings && <Button variant="ghost" size="icon" onClick={dismiss} aria-label="Recordar notificaciones más adelante"><X className="h-4 w-4" /></Button>}
  </CardContent></Card>;
}
