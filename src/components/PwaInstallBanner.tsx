'use client';

import { useEffect, useState } from 'react';
import { Download, Share, PlusSquare, Smartphone, X, Loader2, Ellipsis } from 'lucide-react';
import { useAuth } from '@/hooks/useAuthRedirect';
import { getInstallPrompt, INSTALL_STATE_EVENT, isInstalled, isIosDevice, promptInstall } from '@/lib/pwa-install';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { useToast } from '@/hooks/use-toast';

const DISMISSED_KEY = 'pediturno_install_later';
const WEEK = 7 * 86400000;

export function IosInstallSteps() {
  return <ol className="space-y-4 text-sm">
    <li className="flex items-start gap-3"><Share className="h-7 w-7 shrink-0 text-primary" /><span><strong>1. Tocá Compartir</strong><br />Abrí esta página en Safari y tocá el ícono de compartir. Según la versión, está en la barra o dentro del menú <Ellipsis className="inline h-4 w-4" />.</span></li>
    <li className="flex items-start gap-3"><PlusSquare className="h-7 w-7 shrink-0 text-primary" /><span><strong>2. Agregar a pantalla de inicio</strong><br />Deslizá las opciones del menú hasta encontrarla.</span></li>
    <li className="flex items-start gap-3"><Smartphone className="h-7 w-7 shrink-0 text-primary" /><span><strong>3. Tocá Agregar y abrí Pediturno</strong><br />Si aparece “Abrir como app”, dejalo activado. Abrí el nuevo ícono e iniciá sesión para activar las notificaciones.</span></li>
  </ol>;
}

export default function PwaInstallBanner({ alwaysShow = false }: { alwaysShow?: boolean }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [visible, setVisible] = useState(false);
  const [ios, setIos] = useState(false);
  const [canPrompt, setCanPrompt] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const update = () => {
      const iosDevice = isIosDevice();
      const available = !!getInstallPrompt();
      let dismissedAt = 0;
      try { dismissedAt = Number(localStorage.getItem(DISMISSED_KEY) || 0); } catch { /* Storage may be disabled. */ }
      setIos(iosDevice);
      setCanPrompt(available);
      setVisible(!!user && !isInstalled() && (alwaysShow || iosDevice || available) && (alwaysShow || Date.now() - dismissedAt > WEEK));
    };
    update();
    window.addEventListener(INSTALL_STATE_EVENT, update);
    return () => window.removeEventListener(INSTALL_STATE_EVENT, update);
  }, [user, alwaysShow]);

  const dismiss = () => {
    try { localStorage.setItem(DISMISSED_KEY, String(Date.now())); } catch { /* Keep dismissal in memory. */ }
    setVisible(false);
  };
  const install = async () => {
    if (ios || !canPrompt) { setGuideOpen(true); return; }
    setInstalling(true);
    try {
      if (await promptInstall() === 'accepted') setVisible(false);
    } catch {
      toast({ title: 'No se pudo abrir la instalación', description: 'Podés instalar desde el menú de tu navegador.' });
      setGuideOpen(true);
    } finally { setInstalling(false); }
  };
  if (!visible || !user) return null;
  return <>
    <Card className="mb-6 border-primary/20 bg-secondary/40"><CardContent className="flex flex-wrap items-center gap-3 p-4">
      <Smartphone className="h-7 w-7 shrink-0 text-primary" />
      <div className="min-w-0 flex-1 basis-48"><h3 className="font-semibold">Llevá tu agenda en el celular</h3><p className="text-sm text-muted-foreground">Instalá Pediturno para acceder rápido a tus turnos, canchas y espacios.</p></div>
      <Button onClick={install} disabled={installing} className="max-w-full whitespace-normal">{installing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}{ios ? 'Cómo instalar en iPhone' : 'Instalar Pediturno'}</Button>
      {!alwaysShow && <Button variant="ghost" size="icon" onClick={dismiss} aria-label="Recordar instalación más adelante"><X className="h-4 w-4" /></Button>}
    </CardContent></Card>
    <Dialog open={guideOpen} onOpenChange={setGuideOpen}><DialogContent className="w-[calc(100vw-2rem)] max-w-md rounded-xl"><DialogHeader><DialogTitle>{ios ? 'Pediturno en tu iPhone o iPad' : 'Instalar Pediturno'}</DialogTitle><DialogDescription>Tu agenda, a un toque desde la pantalla de inicio.</DialogDescription></DialogHeader>
      {ios ? <IosInstallSteps /> : <p className="text-sm">Abrí el menú de Chrome o Edge y elegí “Instalar aplicación” o “Agregar a pantalla de inicio”. Si usás el navegador de otra app, abrí primero el enlace en Chrome.</p>}
      <Button onClick={() => setGuideOpen(false)}>Entendido</Button>
    </DialogContent></Dialog>
  </>;
}
