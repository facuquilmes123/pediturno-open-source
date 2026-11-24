import Link from 'next/link';
import type { ReactNode } from 'react';
export default function PublicInfoLayout({ title, children, updatedAt = '9 de octubre de 2026' }: { title: string; children: ReactNode; updatedAt?: string }) {
  return <div className="min-h-screen bg-background text-foreground">
    <header className="border-b"><nav aria-label="Navegación" className="container flex min-h-16 flex-wrap items-center justify-between gap-4 px-4 py-3"><Link href="/" className="text-xl font-bold">Pediturno</Link><Link href="/" className="text-sm underline">Volver al inicio</Link></nav></header>
    <main className="container max-w-3xl px-4 py-12 sm:py-16"><h1 className="text-3xl font-bold sm:text-4xl">{title}</h1><p className="mt-3 text-sm text-muted-foreground">Actualizado el {updatedAt}</p><div className="prose mt-8 max-w-none dark:prose-invert">{children}</div></main>
    <footer className="border-t px-4 py-8"><nav aria-label="Información de la plataforma" className="mx-auto flex max-w-3xl flex-wrap gap-5 text-sm"><Link href="/faq">Preguntas frecuentes</Link><Link href="/terminos">Términos y condiciones</Link><Link href="/privacy-policy">Privacidad</Link><a href="mailto:contacto@pediturno.com">Contacto</a></nav><p className="mx-auto mt-5 max-w-3xl text-xs text-muted-foreground">BelgranoApps · General Belgrano, Buenos Aires, Argentina.</p></footer>
  </div>;
}
