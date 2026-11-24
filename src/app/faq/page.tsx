
import Link from 'next/link';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from '@/components/ui/button';
import { ArrowLeft, LifeBuoy } from 'lucide-react';
import Image from 'next/image';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Preguntas frecuentes',
  description: 'Respuestas sobre el sistema de turnos online, el plan Gratis de Servicios y Pro mensual de Pediturno.',
  alternates: {
    canonical: '/faq',
  },
};

function Logo({ asH1 = false }: { asH1?: boolean }) {
  const Comp = asH1 ? 'h1' : 'div';
  return (
    <Link href="/" className="flex items-center gap-2">
      <Image src="/logo.webp" alt="Pediturno Logo" width={32} height={32} />
      <Comp className="text-2xl font-bold">Pediturno</Comp>
    </Link>
  )
}

const faqs = [
    {
        category: 'Preguntas Generales',
        questions: [
            {
                q: '¿Qué es Pediturno?',
                a: 'Pediturno es una herramienta digital que te permite crear una página web simple para que tus clientes puedan ver tus servicios y agendar turnos por sí mismos, 24/7. También te proporciona un panel para gestionar esos turnos, tus servicios y tu lista de clientes.'
            },
            {
                q: '¿Para qué tipo de negocios es ideal?',
                a: 'Tiene portales para servicios profesionales, complejos deportivos y espacios para eventos. Para servicios, por ejemplo: peluquerías, barberías, salones de belleza, estudios de tatuajes, talleres y clases particulares. Su función es organizar la agenda comercial y los datos de contacto de clientes.'
            },
            {
                q: '¿Qué incluye Gratis y qué cambia con Pro?',
                a: 'Servicios incluye Gratis permanente con todas las funciones y hasta 40 turnos por mes, sin anuncios. Pro permite turnos ilimitados. Canchas y Espacios conservan su prueba de 15 días.'
            }
        ]
    },
    {
        category: 'Configuración y Uso del Panel',
        questions: [
            {
                q: '¿Cómo configuro mi página de reservas?',
                a: 'Es muy fácil. Una vez que te registras, ve a la sección "Mi Negocio" en tu panel. Allí podrás ponerle un nombre a tu negocio, una descripción, subir tu logo y elegir la URL única que compartirás (ej: pediturno.com/tu-barberia).'
            },
            {
                q: '¿Dónde configuro mis horarios de atención?',
                a: 'Puedes definir un horario general para todo tu negocio en "Ajustes" > "Configurar Horario General". Si un servicio tiene un horario especial (por ejemplo, solo lo ofreces por la tarde), puedes configurarlo individualmente en "Servicios" > "Acciones" > "Ajustes de Disponibilidad" para ese servicio en particular.'
            },
             {
                q: '¿Cómo comparto mi página para que los clientes reserven?',
                a: 'En la sección "Inicio" de tu panel, encontrarás tu "link de reserva". Simplemente cópialo y pégalo en tu perfil de Instagram, biografía de WhatsApp, estados, o envíalo directamente a tus clientes. También puedes generar y descargar un código QR para imprimir y poner en tu local.'
            },
            {
                q: '¿Puedo bloquear fechas específicas, como vacaciones o feriados?',
                a: '¡Sí! En la configuración de disponibilidad (tanto la general como la de cada servicio), hay una pestaña de "Fechas Bloqueadas". Allí puedes seleccionar en un calendario los días que no trabajarás. También puedes importar automáticamente los feriados nacionales.'
            },
            {
                q: '¿Puedo crear un turno manualmente para un cliente?',
                a: 'Por supuesto. En la página de "Inicio" de tu panel, haz clic en el botón "Crear Turno". Se abrirá un formulario para que ingreses los datos del cliente, elijas el servicio, la fecha y la hora. Es ideal para agendar turnos que te piden por teléfono o en persona.'
            }
        ]
    },
    {
        category: 'Suscripción y Pagos',
        questions: [
            {
                q: '¿Qué pasa al vencer Pro o la prueba?',
                a: 'Servicios continúa en Gratis al vencer Pro: conserva sus turnos y dispone de hasta 40 turnos por mes. Canchas y Espacios requieren plan vigente después de la prueba. No se borran automáticamente tus datos.'
            },
            {
                q: '¿Qué métodos de pago aceptan?',
                a: 'Servicios incluye un plan Gratis de hasta 40 turnos al mes. Pro se contrata mediante Google Play desde Pediturno para Android, con precio base de USD 7 por mes; Google informa el precio local antes de confirmar. En esta versión, las reservas de Servicios se realizan sin seña automática y el cobro se acuerda directamente con el negocio. Canchas y Espacios conservan su circuito actual.'
            },
            {
                q: '¿Cuál es el precio del servicio y es final?',
                a: 'El plan mensual se muestra en el panel antes de activarlo. Allí podrás revisar el importe y sus condiciones vigentes.'
            },
             {
                q: '¿El plan se renueva automáticamente?',
                a: 'En Servicios, la suscripción mensual se gestiona desde Google Play y puede renovarse automáticamente según las condiciones confirmadas al contratar. Podés cancelarla desde Google Play. Los períodos prepagados anteriores conservan su vigencia y no se convierten automáticamente en suscripciones.'
            }
        ]
    },
    {
        category: 'Clientes y Turnos',
        questions: [
            {
                q: '¿Mis clientes necesitan registrarse o descargar una app?',
                a: 'No. Esa es una de las grandes ventajas de Pediturno. Tus clientes solo necesitan hacer clic en tu link, elegir el servicio y el horario. Es un proceso rápido y directo desde cualquier navegador web, sin necesidad de crear cuentas ni instalar nada.'
            },
            {
                q: '¿Cómo se notifican los nuevos turnos?',
                a: 'Recibirás una notificación push en tu dispositivo (si las activas) y un email a tu correo (si lo configuras en "Ajustes") cada vez que un cliente agende un nuevo turno. Además, siempre podrás ver todos tus turnos en la sección "Calendario" de tu panel.'
            },
            {
                q: '¿Se envían recordatorios a los clientes?',
                a: 'Si activas los recordatorios y el cliente proporciona un correo válido, el sistema programa un aviso aproximadamente 24 horas antes del turno. La entrega depende del servicio de correo.'
            },
            {
                q: '¿Puedo cancelar o reprogramar un turno?',
                a: 'Sí. Desde tu "Calendario", puedes cancelar cualquier turno. Esto también enviará una notificación al cliente. El cliente, por su parte, puede cancelar o reprogramar su turno desde el email de confirmación que recibió, dándote más libertad.'
            }
        ]
    }
];

export default function FAQPage() {
    const faqSchema = {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        "mainEntity": faqs.flatMap(cat => 
            cat.questions.map(q => ({
                "@type": "Question",
                "name": q.q,
                "acceptedAnswer": {
                    "@type": "Answer",
                    "text": q.a
                }
            }))
        )
    };

    return (
        <div className="flex min-h-screen flex-col bg-background">
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(faqSchema) }}
            />
            <header className="container sticky top-0 z-50 mx-auto bg-background/95 backdrop-blur-sm px-4 sm:px-6 lg:px-8">
                <div className="flex h-20 items-center justify-between">
                    <Logo />
                    <Button asChild variant="ghost">
                        <Link href="/">
                            <ArrowLeft className="mr-2 h-4 w-4" />
                            Volver al Inicio
                        </Link>
                    </Button>
                </div>
            </header>

            <main className="flex-grow py-16 md:py-24">
                <div className="container mx-auto px-4 sm:px-6 lg:px-8 max-w-4xl">
                    <div className="text-center mb-16">
                         <div className="inline-block p-4 bg-primary/10 rounded-full mb-4">
                            <LifeBuoy className="h-10 w-10 text-primary" />
                        </div>
                        <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight">Preguntas Frecuentes</h1>
                        <p className="mt-4 max-w-2xl mx-auto text-lg text-muted-foreground">
                            Hemos recopilado las dudas más comunes para ayudarte a sacar el máximo provecho de Pediturno.
                        </p>
                    </div>

                    <div className="space-y-12">
                        {faqs.map((category) => (
                             <section key={category.category}>
                                <h2 className="text-2xl font-bold tracking-tight border-b pb-2 mb-6">{category.category}</h2>
                                <Accordion type="single" collapsible className="w-full space-y-4">
                                {category.questions.map((item, index) => (
                                    <AccordionItem key={index} value={`item-${index}`} className="bg-secondary/30 border rounded-lg px-6 shadow-sm">
                                        <AccordionTrigger className="text-left font-semibold text-lg hover:no-underline">{item.q}</AccordionTrigger>
                                        <AccordionContent className="text-muted-foreground text-base leading-relaxed">
                                        {item.a}
                                        </AccordionContent>
                                    </AccordionItem>
                                ))}
                                </Accordion>
                            </section>
                        ))}
                    </div>

                    <div className="mt-16 p-8 bg-secondary/40 border border-border/80 rounded-2xl text-center max-w-xl mx-auto space-y-3">
                        <h3 className="text-xl font-bold">¿Necesitás ayuda con tu cuenta?</h3>
                        <p className="text-sm text-muted-foreground">
                            Ingresá a tu cuenta para encontrar el correo de soporte en el panel.
                        </p>
                        <div className="pt-2">
                            <Link
                                href="/"
                                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary text-primary-foreground font-semibold text-sm hover:opacity-90 transition-opacity"
                            >
                                Ir a Pediturno
                            </Link>
                        </div>
                    </div>
                </div>
            </main>

            <footer className="bg-background border-t">
                <div className="container mx-auto py-8 px-4 sm:px-6 lg:px-8">
                    <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
                        <Logo />
                        <div className="flex items-center gap-6 text-sm text-muted-foreground">
                            <Link href="/terminos">Términos</Link><Link href="/privacy-policy">Privacidad</Link><p>&copy; {new Date().getFullYear()} Pediturno. Todos los derechos reservados.</p>
                        </div>
                    </div>
                </div>
            </footer>
        </div>
    );
}
