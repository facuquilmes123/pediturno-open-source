package com.pediturno.servicios.core.theme

import androidx.compose.ui.graphics.Color

// ============================================================================
// Pediturno Design System Tokens (Aligned with https://pediturno.com)
// Mint Cyan + Midnight Obsidian Prestige (M3 Expressive)
// ============================================================================

// Superficies y Lienzo Principal (Dark Obsidian OLED)
val ObsidianCanvas = Color(0xFF0A0E1A)
val SlateDeep = Color(0xFF0D1322)
val SurfaceLevel1 = Color(0xFF111827)
val SurfaceLevel2 = Color(0xFF1F293D)
val SurfaceLevel3 = Color(0xFF28354D)

// Bordes Lúcidos y Remates
val BorderHairline = Color(0x14FFFFFF) // rgba(255, 255, 255, 0.08) - Micro-border
val BorderSubtle = Color(0xFF2E3A52)
val BorderFocused = Color(0xFF4FB5AB)

// Color Primario de Marca (Mint Cyan de Pediturno)
val MintPrimary = Color(0xFF4FB5AB)
val MintPrimaryDark = Color(0xFF5EC7BF)
val MintContainer = Color(0xFF133834)
val MintGlow = Color(0x334FB5AB)
val OnMintPrimary = Color(0xFF041D1A)

// Alias de retrocompatibilidad
val CobaltPrimary = MintPrimary
val CobaltHover = MintPrimaryDark
val CobaltGlow = MintGlow

// Acentos de Telemetría y Llamados a la Acción
val SkyAccent = Color(0xFF38BDF8)
val SkyContainer = Color(0x2638BDF8)
val OrangeCta = Color(0xFFF97316)
val OrangeContainer = Color(0x26F97316)

// Semántica de Estados Operativos (Turnos y Citas)
val EmeraldConfirmed = Color(0xFF10B981)
val EmeraldContainer = Color(0x2610B981)

val AmberPending = Color(0xFFF59E0B)
val AmberContainer = Color(0x26F59E0B)

val CrimsonCancelled = Color(0xFFEF4444)
val CrimsonContainer = Color(0x26EF4444)

val IndigoVip = Color(0xFF818CF8)
val IndigoContainer = Color(0x26818CF8)

// Jerarquía Tipográfica Móvil
val TextHighEmphasis = Color(0xFFF9FAFB)
val TextMediumEmphasis = Color(0xFF9CA3AF)
// Ordinary small text must remain readable even on SurfaceLevel3 (>=4.5:1).
val TextSubtle = Color(0xFF98A2B3)

// Tokens de Tema Claro (para consistencia de renderizado)
val Slate50 = Color(0xFFF8FAFC)
val Slate100 = Color(0xFFF1F5F9)
val Slate200 = Color(0xFFE2E8F0)
val Slate600 = Color(0xFF475569)
val Slate800 = Color(0xFF1E293B)
val Slate900 = Color(0xFF0F172A)
val Green600 = Color(0xFF16A34A)
val Amber600 = Color(0xFFD97706)
val Red600 = Color(0xFFDC2626)
