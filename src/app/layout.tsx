
import type {Metadata, Viewport} from 'next';
import './globals.css';
import { ClientProviders } from '@/components/ClientProviders';
import { Inter } from 'next/font/google';
import { cn } from '@/lib/utils';
import AnalyticsConsent from '@/components/AnalyticsConsent';

const fontSans = Inter({ 
  subsets: ['latin'], 
  variable: '--font-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  metadataBase: new URL('https://pediturno.com'),
  applicationName: 'Pediturno',
  title: {
    default: 'Sistema de turnos y reservas online | Pediturno',
    template: '%s | Pediturno',
  },
  description:
    'Publicá tus servicios y horarios, recibí solicitudes de turnos y organizá tu agenda desde un solo lugar. Gratis incluye hasta 40 turnos por mes.',
  authors: [{ name: 'Pediturno', url: 'https://pediturno.com' }],
  creator: 'Pediturno',
  category: 'Business & Productivity',
  openGraph: {
    title: 'Sistema de turnos y reservas online | Pediturno',
    description:
      'Publicá tus servicios y horarios, recibí solicitudes de turnos y organizá tu agenda desde un solo lugar.',
    siteName: 'Pediturno',
    images: [
      {
        url: '/images/pediturno-servicios.webp',
        width: 1536,
        height: 1024,
        alt: 'Imagen ilustrativa de un negocio de servicios que organiza turnos con Pediturno',
      },
    ],
    locale: 'es_AR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Sistema de turnos y reservas online | Pediturno',
    description:
      'Publicá tus servicios y horarios y organizá tu agenda online. Gratis incluye hasta 40 turnos por mes.',
    images: ['/images/pediturno-servicios.webp'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  icons: {
    icon: '/favicon.ico',
    shortcut: '/favicon-16x16.png',
    apple: '/apple-icon.png',
  },
  manifest: '/manifest.json',
};

export const viewport: Viewport = {
  themeColor: '#64CCC9',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://apis.google.com" crossOrigin="anonymous" />
      </head>
      <body className={cn("font-sans antialiased", fontSans.variable)}>
        <ClientProviders>
          {children}
          <AnalyticsConsent />
        </ClientProviders>
      </body>
    </html>
  );
}
