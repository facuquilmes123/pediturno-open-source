
import type { Metadata } from 'next';
import { notFound, permanentRedirect } from 'next/navigation';
import { headers } from 'next/headers';
import { getPublicBusinessBySlug } from '@/lib/public-business';
import BookingClientPage from './BookingClientPage';
import { safeJsonForScript } from '@/lib/safe-json-script';
import { getBusinessBookingUrl } from '@/lib/verticals';
import Image from 'next/image';
import type { Cancha, Service, Space } from '@/services/data';

type Props = {
  params: Promise<{ slug: string }>
}

type PublicResource = Service | Cancha | Space;

function publicResources(view: Awaited<ReturnType<typeof getPublicBusinessBySlug>>): PublicResource[] {
  return view ? [...view.services, ...view.canchas, ...view.spaces] : [];
}

function resourcePriceLabel(resource: PublicResource): string {
  if ('packages' in resource) return resource.packages.map((item) => `${item.durationMinutes === 1440 ? 'jornada completa' : `${item.durationMinutes / 60} h`}: $${item.price}`).join(' · ');
  return `$${resource.price}`;
}
 
function businessPresentation(publicView: NonNullable<Awaited<ReturnType<typeof getPublicBusinessBySlug>>>) {
  const slug = publicView.business.slug!;
  const businessData = publicView.business;
  const resources = publicResources(publicView);
  const isSpaces = businessData.businessType === 'spaces';
  const isSports = businessData.businessType === 'sports_facility';
  const action = isSpaces ? 'Reservá un espacio' : isSports ? 'Reservá una cancha' : 'Reservá un turno';
  const title = `${action} en ${businessData.name}`;
  const resourceNames = resources.slice(0, 4).map((resource) => resource.name).join(', ');
  const city = businessData.address?.city?.trim();
  const editorialFallback = `${action} online en ${businessData.name}${city ? `, ${city}` : ''}. Consultá disponibilidad${resourceNames ? ` para ${resourceNames}` : ''}, elegí fecha y horario y enviá tu reserva.`;
  const description = businessData.description?.trim() && businessData.description.trim().length >= 50 ? businessData.description.trim() : editorialFallback;

  const openingHoursSpecification: any[] = [];
  if (resources.length > 0) {
    const aggregatedWorkingHours: { [key: number]: { start: string; end: string }[] } = {};

    resources.forEach(service => {
      if (service.workingHours) {
        for (const day in service.workingHours) {
          const dayNum = parseInt(day);
          if (!aggregatedWorkingHours[dayNum]) {
            aggregatedWorkingHours[dayNum] = [];
          }
          service.workingHours[dayNum].slots.forEach(slot => {
            // Avoid duplicate slots if multiple services have the same hours
            if (!aggregatedWorkingHours[dayNum].some(existingSlot => existingSlot.start === slot.start && existingSlot.end === slot.end)) {
              aggregatedWorkingHours[dayNum].push(slot);
            }
          });
        }
      }
    });

    for (const day in aggregatedWorkingHours) {
      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][parseInt(day)];
      aggregatedWorkingHours[day].forEach(slot => {
        openingHoursSpecification.push({
          "@type": "OpeningHoursSpecification",
          "dayOfWeek": dayName,
          "opens": slot.start,
          "closes": slot.end
        });
      });
    }
  }

  const structuredData: any = {
    '@context': 'https://schema.org',
    '@type': isSpaces ? ['LocalBusiness', 'EventVenue'] : isSports ? 'SportsActivityLocation' : 'LocalBusiness',
    name: businessData?.name,
    description: description,
    image: businessData?.logo,
    url: getBusinessBookingUrl(businessData.businessType, slug),
    ...(businessData?.address?.city && businessData?.address?.province ? { address: {
        '@type': 'PostalAddress',
        ...(businessData?.address?.street ? { streetAddress: `${businessData.address.street} ${businessData.address.number || ''}`.trim() } : {}),
        addressLocality: businessData?.address?.city,
        addressRegion: businessData?.address?.province,
        ...(businessData?.address?.postalCode ? { postalCode: businessData.address.postalCode } : {}),
        addressCountry: businessData?.address?.country,
    }} : {}),
    ...(businessData.whatsappButtonEnabled && businessData?.whatsappNumber && /^\+?\d{10,15}$/.test(businessData.whatsappNumber.replace(/[\s()-]/g, ''))
      ? { telephone: businessData.whatsappNumber.replace(/[\s()-]/g, '') } : {}),
    makesOffer: resources.flatMap((resource) => 'packages' in resource
      ? resource.packages.map((item) => ({ '@type': 'Offer', name: `${resource.name} · ${item.durationMinutes === 1440 ? 'Jornada completa' : `${item.durationMinutes / 60} horas`}`, price: item.price, priceCurrency: 'ARS' }))
      : [{ '@type': 'Offer', name: resource.name, price: resource.price, priceCurrency: 'ARS' }]),
  };

  if (openingHoursSpecification.length > 0) {
    structuredData.openingHoursSpecification = openingHoursSpecification;
  }

  if (businessData?.socialLinks && businessData.socialLinks.length > 0) {
    structuredData.sameAs = businessData.socialLinks.map(link => link.url);
  }

  return { title, description, businessData, structuredData };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const publicView = await getPublicBusinessBySlug(slug);

  if (!publicView) {
    return {
        title: 'Página no encontrada',
        description: 'El enlace de reserva que has seguido no existe o ha sido movido.',
        robots: { index: false, follow: false },
    }
  }

  const { title, description, businessData } = businessPresentation(publicView);
  return {
    title: title,
    description: description,
    ...(slug === 'prueba' || publicView.isQaFixture ? { robots: { index: false, follow: false } } : {}),
    openGraph: {
        title: title,
        description: description,
        images: [
            {
                url: businessData?.logo || '/pediturno.png',
                width: 800,
                height: 600,
                alt: `Logo de ${businessData?.name}`
            }
        ]
    },
    twitter: {
        card: "summary_large_image",
        title: title,
        description: description,
        images: [businessData?.logo || '/pediturno.png'],
    },
    alternates: {
        canonical: getBusinessBookingUrl(businessData.businessType, slug),
    },
  }
}


export default async function PublicBookingPage({ params }: Props) {
    const { slug } = await params;
    const publicView = await getPublicBusinessBySlug(slug);

    if (!publicView) {
        notFound();
    }
    
    // Fetch data once and pass as props
    const businessData = publicView.business;
    const host = (await headers()).get('host')?.toLowerCase().split(':')[0];
    const canonicalUrl = getBusinessBookingUrl(businessData.businessType, slug);
    if (host && ['pediturno.com', 'www.pediturno.com', 'canchas.pediturno.com', 'espacios.pediturno.com'].includes(host)
        && host !== new URL(canonicalUrl).hostname) {
        permanentRedirect(canonicalUrl);
    }
    const activeServices = publicView.services;
    const activeCanchas = publicView.canchas;
    const activeSpaces = publicView.spaces;
    const resources = publicResources(publicView);
    const city = businessData.address?.city?.trim();
    const fallbackDescription = businessData.businessType === 'spaces'
      ? `Encontrá el espacio y el bloque de horas adecuado para tu evento${city ? ` en ${city}` : ''}.`
      : businessData.businessType === 'sports_facility'
        ? `Consultá canchas, fechas y horarios disponibles${city ? ` en ${city}` : ''}.`
        : `Consultá servicios, fechas y horarios disponibles${city ? ` en ${city}` : ''}.`;
    
    // Get structured data for the page
    const structuredData = safeJsonForScript(businessPresentation(publicView).structuredData);

    return (
        <>
            {structuredData && (
                 <script 
                    type="application/ld+json" 
                    dangerouslySetInnerHTML={{ __html: structuredData }} 
                />
            )}
            <section className="border-b bg-background px-4 py-8 sm:py-10">
              <div className="mx-auto max-w-2xl text-center">
                {businessData.logo && <Image src={businessData.logo} alt={`Logo de ${businessData.name}`} width={240} height={120} className="mx-auto mb-5 max-h-28 w-auto rounded-xl object-contain" />}
                <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{businessData.name}</h1>
                <p className="mx-auto mt-3 max-w-prose text-muted-foreground">{businessData.description?.trim() || fallbackDescription}</p>
                {city && <p className="mt-2 text-sm text-muted-foreground">Reservas en {city}{businessData.address?.province ? `, ${businessData.address.province}` : ''}</p>}
                {resources.length > 0 && <div className="mt-6 grid gap-3 text-left sm:grid-cols-2">{resources.map((resource) => (
                  <a key={`${'packages' in resource ? 'space' : 'sport' in resource ? 'cancha' : 'service'}-${resource.id}`} href="#reservar" className="rounded-xl border bg-card p-4 transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <h2 className="font-semibold">{resource.name}</h2>
                    {'description' in resource && resource.description && <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{resource.description}</p>}
                    <p className="mt-2 text-sm font-medium text-primary">{resourcePriceLabel(resource)}</p>
                  </a>
                ))}</div>}
                <a href="#reservar" className="mt-6 inline-flex rounded-md bg-primary px-5 py-2.5 font-semibold text-primary-foreground">Ver disponibilidad y reservar</a>
              </div>
            </section>
            <div id="reservar"><BookingClientPage businessData={businessData} services={activeServices} canchas={activeCanchas} spaces={activeSpaces} businessId={publicView.businessId} showBusinessHeader={false} /></div>
        </>
    );
}
