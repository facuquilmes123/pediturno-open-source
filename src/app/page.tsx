import type { Metadata } from 'next';
import { headers } from 'next/headers';

import LandingPortal from '@/components/landing/LandingPortal';
import { isServicePlayDownloadAvailable } from '@/lib/service-play-download';
import { getMembershipPriceArs, getMembershipPriceLabel, SERVICE_MEMBERSHIP_PRICE_USD } from '@/lib/config';
import {
  getVerticalFromHost,
  getVerticalOrigin,
  type ProductVertical,
} from '@/lib/verticals';

const metadataByVertical: Record<ProductVertical, {
  title: string;
  description: string;
  image: string;
  imageAlt: string;
}> = {
  services: {
    title: 'Sistema de turnos online para servicios | Pediturno',
    description: 'Publicá tus servicios y horarios, recibí solicitudes de turnos y organizá tu agenda desde un solo lugar. Gratis incluye hasta 40 turnos por mes. Pro permite turnos ilimitados.',
    image: '/images/producto/demo-servicios-20261010.webp',
    imageAlt: 'Pantalla de reservas de servicios con datos de demostración',
  },
  sports_facility: {
    title: 'Reservas online para canchas y complejos | Pediturno Canchas',
    description: 'Publicá cada cancha con sus horarios y precios, evitá superposiciones y gestioná las reservas de tu complejo desde una sola grilla.',
    image: '/images/producto/demo-canchas-20261010.webp',
    imageAlt: 'Pantalla de reservas de canchas con datos de demostración',
  },
  spaces: {
    title: 'Reservas online para salones, quinchos y espacios | Pediturno Espacios',
    description: 'Publicá salones, quinchos, SUM, quintas, auditorios y estudios con fechas y franjas disponibles. Organizá cada reserva desde una sola agenda.',
    image: '/images/producto/demo-espacios-20261010.webp',
    imageAlt: 'Pantalla de reservas de espacios con datos de demostración',
  },
};

function getProductName(vertical: ProductVertical) {
  if (vertical === 'sports_facility') return 'Pediturno Canchas';
  if (vertical === 'spaces') return 'Pediturno Espacios';
  return 'Pediturno';
}

async function getRequestVertical(): Promise<ProductVertical> {
  return getVerticalFromHost((await headers()).get('host'));
}

export async function generateMetadata(): Promise<Metadata> {
  const vertical = await getRequestVertical();
  const origin = getVerticalOrigin(vertical);
  const content = metadataByVertical[vertical];

  return {
    metadataBase: new URL(origin),
    title: { absolute: content.title },
    description: content.description,
    alternates: { canonical: origin },
    openGraph: {
      title: content.title,
      description: content.description,
      url: origin,
      siteName: getProductName(vertical),
      locale: 'es_AR',
      type: 'website',
      images: [{ url: content.image, width: 1200, height: 1000, alt: content.imageAlt }],
    },
    twitter: {
      card: 'summary_large_image',
      title: content.title,
      description: content.description,
      images: [content.image],
    },
  };
}

export default async function Home() {
  const vertical = await getRequestVertical();
  const origin = getVerticalOrigin(vertical);
  const price = vertical === 'services' ? SERVICE_MEMBERSHIP_PRICE_USD : getMembershipPriceArs(vertical);
  const currency = vertical === 'services' ? 'USD' : 'ARS';
  const priceLabel = getMembershipPriceLabel(vertical);
  const content = metadataByVertical[vertical];

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'SoftwareApplication',
        '@id': `${origin}/#app`,
        name: getProductName(vertical),
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Web',
        url: origin,
        description: content.description,
        offers: {
          '@type': 'Offer',
          price,
          priceCurrency: currency,
          priceSpecification: {
            '@type': 'UnitPriceSpecification',
            price,
            priceCurrency: currency,
            billingDuration: 'P1M',
          },
        },
      },
      {
        '@type': 'WebSite',
        '@id': `${origin}/#website`,
        name: getProductName(vertical),
        url: origin,
        inLanguage: 'es-AR',
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData).replace(/</g, '\\u003c') }}
      />
      <LandingPortal vertical={vertical} priceLabel={priceLabel} playDownloadAvailable={vertical === 'services' && await isServicePlayDownloadAvailable()} />
    </>
  );
}
