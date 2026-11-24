'use client';
import { Copy, Share2 } from 'lucide-react';
import { Button } from './ui/button';
import { useToast } from '@/hooks/use-toast';
import { shareBookingLink } from '@/lib/share-booking';

export default function BookingLinkActions({ url, name }: { url: string; name?: string }) {
  const { toast } = useToast();
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); toast({ title: 'Enlace copiado' }); }
    catch { toast({ variant: 'destructive', title: 'No se pudo copiar', description: url }); }
  };
  const share = async () => {
    try {
      if (await shareBookingLink(url, name) === 'copied') toast({ title: 'Enlace copiado', description: 'Podés pegarlo en la app que prefieras.' });
    } catch { toast({ variant: 'destructive', title: 'No se pudo compartir', description: 'Usá Copiar enlace o copiá la URL de tu página.' }); }
  };
  return <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={copy}><Copy className="mr-2 h-4 w-4" />Copiar enlace</Button><Button type="button" size="sm" onClick={share}><Share2 className="mr-2 h-4 w-4" />Compartir</Button></div>;
}
