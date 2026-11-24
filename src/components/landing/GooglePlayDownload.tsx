import Image from 'next/image';
import { SERVICE_PLAY_URL } from '@/lib/config';

export default function GooglePlayDownload({ available }: { available: boolean }) {
  if (!available) return <div className="inline-flex min-h-14 flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3" role="group" aria-label="Pediturno para Android: próximamente en Google Play">
    <Image src="/images/google-play/google-play-logo.png" alt="Google Play" width={183} height={39} className="h-auto w-[140px]" unoptimized />
    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-600">Próximamente</span>
  </div>;
  return <a href={SERVICE_PLAY_URL} target="_blank" rel="noopener noreferrer" aria-label="Descargar Pediturno Servicios en Google Play" className="inline-block rounded-lg p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
    <Image src="/images/google-play/es-419-badge.png" alt="Descargar en Google Play" width={646} height={250} className="h-auto w-[210px]" unoptimized />
  </a>;
}
