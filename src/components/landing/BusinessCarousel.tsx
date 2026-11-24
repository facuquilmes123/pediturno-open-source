"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProductVertical } from "@/lib/verticals";

const AUTOPLAY_INTERVAL_MS = 6000;

const serviceScenes = [
  {
    src: "/images/landing/servicios-agenda-20261010.webp",
    alt: "Escena ilustrativa de una barbería con un profesional y una agenda en el celular",
    eyebrow: "Tu jornada organizada",
    title: "Tu tiempo vale. Dale orden a tu agenda.",
    description: "Publicá servicios, precios y horarios. Reuní tus turnos en un solo lugar y dedicá más tiempo a atender.",
  },
  {
    src: "/images/landing/servicios-enlace-20261010.webp",
    alt: "Escena ilustrativa de una clienta eligiendo un turno desde su teléfono en un salón",
    eyebrow: "Un enlace, menos mensajes",
    title: "Que reservar sea tan fácil como abrir tu enlace",
    description: "Tus clientes eligen un horario desde el celular, sin instalar una app. Compartí tu página en redes y WhatsApp.",
  },
  {
    src: "/images/landing/clases.webp",
    alt: "Ilustración de una clase guiada organizada mediante reservas online",
    eyebrow: "Clases y actividades",
    title: "Un calendario simple para coordinar cada encuentro",
    description: "Compartí un único enlace para que tus clientes encuentren un horario disponible.",
  },
  {
    src: "/images/landing/taller.webp",
    alt: "Ilustración de un taller de servicios con citas ordenadas en un calendario",
    eyebrow: "Talleres y atención con cita",
    title: "Menos cruces de mensajes, más orden en la jornada",
    description: "Reuní servicios, solicitudes y datos de clientes en Pediturno.",
  },
] as const;

const sportsScenes = [
  {
    src: "/images/landing/canchas-disponibilidad-20261010.webp",
    alt: "Escena ilustrativa de un complejo de pádel con jugadores y un encargado organizando la jornada",
    eyebrow: "Complejos deportivos",
    title: "Todas tus canchas. Una sola grilla.",
    description: "Definí horarios, duración y precios por cancha. Consultá las reservas de tu complejo sin perderte entre mensajes.",
  },
  {
    src: "/images/landing/canchas-reserva-20261010.webp",
    alt: "Escena ilustrativa de un jugador usando su celular junto a una cancha de fútbol iluminada",
    eyebrow: "Fútbol, pádel y tenis",
    title: "La próxima reserva empieza en el celular",
    description: "Un enlace propio para elegir cancha y horario disponible. Fácil de compartir con cada equipo de tu comunidad.",
  },
] as const;

const spacesScenes = [
  {
    src: "/images/landing/espacios-fechas-20261010.webp",
    alt: "Escena ilustrativa de un salón ambientado para eventos y su coordinadora con una agenda",
    eyebrow: "Salones y celebraciones",
    title: "Cada fecha especial, en una agenda clara",
    description: "Organizá fechas y franjas por espacio. Mostrá precios, capacidad y fotos antes de recibir una solicitud.",
  },
  {
    src: "/images/landing/espacios-reserva-20261010.webp",
    alt: "Escena ilustrativa de un quincho con jardín preparado para recibir un encuentro",
    eyebrow: "Quinchos, quintas y jardines",
    title: "Mostrá tu espacio. Facilitá la próxima reserva.",
    description: "Una página con tu identidad, fotos y opciones de varias horas. Compartila en Instagram, WhatsApp o con tu QR.",
  },
  {
    src: "/images/landing/espacios-sum-auditorio.webp",
    alt: "SUM y auditorio moderno con sillas dispuestas frente a un escenario",
    eyebrow: "SUM, auditorios y capacitaciones",
    title: "Una agenda a la altura de cada encuentro",
    description: "Mantené a la vista las franjas que ofrecés para reuniones, talleres y jornadas.",
  },
  {
    src: "/images/landing/espacios-estudio-foto.webp",
    alt: "Estudio de foto y video con fondos, luces y sector de producción",
    eyebrow: "Producción foto y video",
    title: "Tu espacio creativo, disponible para reservar",
    description: "Compartí el enlace del estudio y ordená cada consulta desde un único lugar.",
  },
] as const;

export default function BusinessCarousel({ vertical = "services" }: { vertical?: ProductVertical }) {
  const scenes = vertical === "sports_facility" ? sportsScenes : vertical === "spaces" ? spacesScenes : serviceScenes;
  const productDomain = vertical === "sports_facility" ? "canchas.pediturno.com" : vertical === "spaces" ? "espacios.pediturno.com" : "pediturno.com";
  const regionLabel = vertical === "sports_facility"
    ? "Ejemplos de complejos que organizan sus reservas con Pediturno Canchas"
    : vertical === "spaces"
      ? "Ejemplos ilustrativos de espacios que organizan sus reservas con Pediturno Espacios"
      : "Ejemplos de negocios que organizan sus turnos con Pediturno";
  const [activeIndex, setActiveIndex] = useState(0);
  const [manuallyPaused, setManuallyPaused] = useState(false);
  const [hoverPaused, setHoverPaused] = useState(false);
  const [focusPaused, setFocusPaused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
  const carouselRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updatePreference = () => setPrefersReducedMotion(mediaQuery.matches);
    updatePreference();
    mediaQuery.addEventListener?.("change", updatePreference);
    return () => mediaQuery.removeEventListener?.("change", updatePreference);
  }, []);

  useEffect(() => {
    const updateVisibility = () => setPageHidden(document.visibilityState === "hidden");
    updateVisibility();
    document.addEventListener("visibilitychange", updateVisibility);
    return () => document.removeEventListener("visibilitychange", updateVisibility);
  }, []);

  const autoplayPaused = manuallyPaused || hoverPaused || focusPaused || pageHidden || prefersReducedMotion;

  useEffect(() => {
    if (autoplayPaused) return;
    const timer = window.setInterval(() => {
      setActiveIndex((current) => (current + 1) % scenes.length);
    }, AUTOPLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [autoplayPaused, scenes.length]);

  const showPrevious = () => {
    setActiveIndex((current) => (current - 1 + scenes.length) % scenes.length);
  };

  const showNext = () => {
    setActiveIndex((current) => (current + 1) % scenes.length);
  };

  return (
    <div
      ref={carouselRef}
      role="region"
      aria-roledescription="carrusel"
      aria-label={regionLabel}
      className="mx-auto w-full max-w-[960px]"
      onMouseEnter={() => setHoverPaused(true)}
      onMouseLeave={() => setHoverPaused(false)}
      onFocusCapture={() => setFocusPaused(true)}
      onBlurCapture={(event) => {
        if (!carouselRef.current?.contains(event.relatedTarget as Node | null)) {
          setFocusPaused(false);
        }
      }}
    >
      <div className="relative isolate overflow-hidden rounded-[1.75rem] border border-border/80 bg-card shadow-[0_30px_90px_-35px_rgba(15,23,42,0.55)] sm:rounded-[2rem]">
        <div
          className="flex items-stretch will-change-transform transition-transform duration-700 ease-out motion-reduce:transition-none"
          style={{ transform: `translate3d(-${activeIndex * 100}%, 0, 0)` }}
        >
          {scenes.map((scene, index) => (
            <article
              key={scene.src}
              role="group"
              aria-roledescription="diapositiva"
              aria-label={`${index + 1} de ${scenes.length}: ${scene.eyebrow}`}
              aria-hidden={index !== activeIndex}
              className="min-w-full overflow-hidden"
            >
              <div className="relative aspect-[3/2] max-h-[640px] w-full overflow-hidden bg-slate-100 dark:bg-slate-900">
                <Image
                  src={scene.src}
                  alt={scene.alt}
                  fill
                  sizes="(max-width: 640px) 100vw, (max-width: 1024px) 92vw, 960px"
                  className="object-cover"
                  {...(index === 0 ? { priority: true } : { loading: "lazy" as const })}
                />
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full border border-white/30 bg-slate-950/65 px-3 py-1.5 text-[11px] font-semibold text-white shadow-md backdrop-blur-md sm:left-5 sm:top-5 sm:text-xs">
                  <CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />
                  {vertical === "spaces" ? `Pediturno Espacios · ${productDomain}` : `Ilustración · ${productDomain}`}
                </span>
              </div>
              <div className="min-h-40 border-t border-border/70 bg-card p-5 text-left sm:min-h-36 sm:p-6">
                <p className={`text-xs font-bold uppercase tracking-[0.14em] sm:text-sm ${vertical === 'spaces' ? 'text-violet-700 dark:text-violet-300' : vertical === 'sports_facility' ? 'text-emerald-700 dark:text-emerald-300' : 'text-cyan-700 dark:text-cyan-300'}`}>{scene.eyebrow}</p>
                <h2 className="mt-1.5 text-xl font-black leading-tight tracking-tight text-foreground sm:text-2xl">{scene.title}</h2>
                <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-base">{scene.description}</p>
              </div>
            </article>
          ))}
        </div>

        <Button
          type="button"
          size="icon"
          variant="secondary"
          className="absolute right-3 top-3 z-10 rounded-full border border-white/30 bg-slate-950/65 text-white shadow-lg backdrop-blur-md hover:bg-slate-950/80 disabled:cursor-default disabled:opacity-80 sm:right-5 sm:top-5"
          onClick={() => setManuallyPaused((paused) => !paused)}
          disabled={prefersReducedMotion}
          aria-label={prefersReducedMotion
            ? "Movimiento automático desactivado por tu preferencia"
            : manuallyPaused
              ? "Reanudar recorrido automático"
              : "Pausar recorrido automático"}
        >
          {manuallyPaused || prefersReducedMotion
            ? <Play className="h-4 w-4" aria-hidden="true" />
            : <Pause className="h-4 w-4" aria-hidden="true" />}
        </Button>
      </div>

      <div className="mt-5 flex flex-col items-center justify-between gap-4 sm:flex-row">
        <p className="text-xs text-slate-600 dark:text-slate-300 sm:text-sm">
          Escenas ilustrativas: no representan instalaciones ni clientes reales.
        </p>
        <div className="flex items-center gap-2">
          <Button type="button" size="icon" variant="outline" className="h-11 w-11 rounded-full" onClick={showPrevious} aria-label="Ver ejemplo anterior">
            <ChevronLeft className="h-4 w-4" aria-hidden="true" />
          </Button>
          <div className="flex items-center" aria-label="Elegir ejemplo">
            {scenes.map((scene, index) => (
              <button
                key={scene.src}
                type="button"
                onClick={() => setActiveIndex(index)}
                aria-label={`Ver ejemplo ${index + 1}: ${scene.eyebrow}`}
                aria-current={index === activeIndex ? "true" : undefined}
                className="group flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                <span className={`h-2.5 rounded-full transition-[width,background-color] duration-300 motion-reduce:transition-none ${
                  index === activeIndex ? "w-7 bg-primary" : "w-2.5 bg-muted-foreground/30 group-hover:bg-muted-foreground/55"
                }`} />
              </button>
            ))}
          </div>
          <Button type="button" size="icon" variant="outline" className="h-11 w-11 rounded-full" onClick={showNext} aria-label="Ver ejemplo siguiente">
            <ChevronRight className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
    </div>
  );
}
