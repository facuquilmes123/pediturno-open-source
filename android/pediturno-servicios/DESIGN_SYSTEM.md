# PediTurno — Design System & Visual Architecture
**Versión:** 2.0.0 (Material 3 Expressive + Ultra-Premium Mobile Standard)  
**Dominio:** Agendamiento Profesional de Servicios, Gestión de Turnos y Facturación  
**Stack de Destino:** Android Jetpack Compose (Kotlin 2.0+, M3 Expressive, UDF/MVI)  
**Alineación de Marca:** Idéntica a `https://pediturno.com/` (Mint Cyan + Midnight Obsidian)

---

## 1. Fundamentos de Identidad y Paleta Semántica M3

### 1.1 Paleta Primaria PediTurno (Identidad Web-to-Mobile)
La paleta se deriva rigurosamente de la identidad en producción de PediTurno (`HSL 178 51% 60%`), erradicando cualquier degradado genérico de IA (magenta/púrpura `#6366F1` a `#EC4899`) y adoptando una estética de lujo tecnológico (estilo *Linear* / *Revolut*):

| Rol Semántico | Hex | Nombre / Propósito | Contraste WCAG |
|---|---|---|---|
| **Primary (Brand Mint)** | `#4FB5AB` | Color insignia PediTurno (Botones primarios, acentos activos) | AAA vs `#0A0E1A` |
| **Primary Dark / Glow** | `#5EC7BF` | Resaltados en tema oscuro, glow sutil en estados seleccionados | AAA vs `#030712` |
| **Primary Container** | `#133834` | Contenedores sutiles de alta prioridad (fondo de chips activos) | AA+ |
| **On Primary** | `#041D1A` | Texto de alto contraste sobre botón primario | 11.2:1 (AAA) |
| **Secondary Accent** | `#38BDF8` | Cyan cielo para telemetría, enlaces informativos y deep links | AAA |
| **High-Intent CTA** | `#F97316` | Naranja de acción inmediata (ofertas, upgrades de plan, alertas) | AAA |

### 1.2 Superficies y Elevación Tonal Dark Mode (Zero-Muddy Shadows)
En pantallas OLED / AMOLED modernas, las sombras difusas oscuras generan "manchas" sucias. El estándar ultra-premium utiliza elevación tonal por capas luminosas continuas con micro-bordes de definición óptica:

| Capa / Superficie | Hex / Token | Función en la Interfaz |
|---|---|---|
| **Canvas Background** | `#0A0E1A` | Fondo inmersivo total (Midnight Obsidian) |
| **Surface Level 1** | `#111827` | Tarjetas de turnos, paneles de métricas, contenedores |
| **Surface Level 2** | `#1F293D` | Entradas de texto, chips inactivos, avatar backgrounds |
| **Surface Level 3** | `#28354D` | Modales, dialogs flotantes, hojas de acción inferior |
| **Border Hairline** | `rgba(255, 255, 255, 0.08)` (`#14FFFFFF`) | Micro-borde lúcido de 1dp que delimita tarjetas |
| **Border Focused** | `#4FB5AB` | Indicador de foco activo / turno seleccionado |

### 1.3 Semántica de Estados Operativos (Turnos y Sincronización)
- **Confirmado (Emerald):** `#10B981` (Fondo: `rgba(16, 185, 129, 0.15)`)
- **Pendiente (Amber):** `#F59E0B` (Fondo: `rgba(245, 158, 11, 0.15)`)
- **Completado (Mint):** `#4FB5AB` (Fondo: `rgba(79, 181, 171, 0.15)`)
- **Cancelado (Crimson):** `#EF4444` (Fondo: `rgba(239, 68, 68, 0.15)`)
- **Caché Offline (Amber Subtle):** `#F59E0B` con ícono de nube desconectada

---

## 2. Tipografía Móvil y Cifras Tabulares (`tnum`)

Para evitar saltos de línea y "jank" visual durante la actualización en tiempo real de turnos, precios, cronómetros y contadores, se exige el uso estricto de cifras tabulares (`FontFeatureSettings = "tnum"`).

### 2.1 Escala Tipográfica Material 3
```kotlin
val PediturnoTypography = Typography(
    displayLarge = TextStyle(
        fontSize = 28.sp,
        lineHeight = 34.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.5).sp,
        fontFeatureSettings = "tnum"
    ),
    headlineMedium = TextStyle(
        fontSize = 22.sp,
        lineHeight = 28.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = (-0.2).sp,
        fontFeatureSettings = "tnum"
    ),
    titleLarge = TextStyle(
        fontSize = 18.sp,
        lineHeight = 24.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = (-0.1).sp
    ),
    titleMedium = TextStyle(
        fontSize = 15.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.sp
    ),
    bodyLarge = TextStyle(
        fontSize = 14.sp,
        lineHeight = 20.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.15.sp
    ),
    bodyMedium = TextStyle(
        fontSize = 13.sp,
        lineHeight = 18.sp,
        fontWeight = FontWeight.Normal,
        letterSpacing = 0.25.sp
    ),
    labelLarge = TextStyle(
        fontSize = 12.sp,
        lineHeight = 16.sp,
        fontWeight = FontWeight.SemiBold,
        letterSpacing = 0.1.sp
    ),
    labelSmall = TextStyle(
        fontSize = 10.sp,
        lineHeight = 14.sp,
        fontWeight = FontWeight.Bold,
        letterSpacing = 0.2.sp,
        fontFeatureSettings = "tnum"
    )
)
```

---

## 3. Sistema de Formas (Squircles) y Dimensiones Espaciales

Se implementa una grilla espacial matemática basada en múltiplos de **4dp** y **8dp**:

- **Corner Radii:**
  - `extraSmall`: `6.dp` — Micro-tags y badges de buffer.
  - `small`: `10.dp` — Botones de acción, controles de filtro.
  - `medium`: `14.dp` — Píldoras de selector de fecha.
  - `large`: `18.dp` — Tarjetas principales (`AppointmentCard`, `ServiceCard`, `MetricCard`).
  - `extraLarge`: `24.dp` — Modales de diálogo y sheets de detalle.
  - `pill`: `9999.dp` — FAB flotante de "Nuevo Turno" y badges de estado.

- **Hit-Box Táctil:**
  - Mínimo absoluto de **48dp × 48dp** en cualquier elemento cliqueable (accesibilidad estricta Android).

---

## 4. Guía de Micro-interacciones y M3 Motion

1. **Retroalimentación Táctil (Press Physics):**
   - Reducción de escala suave al presionar tarjetas (`0.985f`) animada con física de resortes:
     `spring(dampingRatio = Spring.DampingRatioLowBouncy, stiffness = Spring.StiffnessMedium)`.
2. **Transiciones de Contenedor y Pestañas (`AnimatedContent`):**
   - Transiciones cruzadas de desvanecimiento y escala (`tween(200, easing = FastOutSlowInEasing)`).
3. **Animación en Listas (`LazyColumn` / `LazyRow`):**
   - Animación de colocación de items (`Modifier.animateItemPlacement()`).
4. **Shimmer Skeletons:**
   - Efecto de pulso lineal de gradiente plateado sobre `SurfaceLevel2` para estados de carga asíncrona.

---

## 5. Arquitectura de Componentes (Slot APIs)
Todos los componentes reutilizables deben admitir composición por slots:
- `AppointmentCard`: Slots para `leadingRail`, `timeBadge`, `clientInfo`, `priceTag`, `actions`.
- `WeeklyDateStrip`: Slot para renderizado de fecha y estado de ocupación.
- `GuidedTourOverlay`: Wizard por pasos animados con spotlight focal y micro-animaciones.
