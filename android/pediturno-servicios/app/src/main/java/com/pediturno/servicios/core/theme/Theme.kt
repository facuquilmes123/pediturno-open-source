package com.pediturno.servicios.core.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val PediturnoDarkColorScheme = darkColorScheme(
    primary = MintPrimary,
    onPrimary = OnMintPrimary,
    primaryContainer = MintContainer,
    onPrimaryContainer = MintPrimaryDark,
    secondary = SkyAccent,
    onSecondary = Color.Black,
    secondaryContainer = SkyContainer,
    onSecondaryContainer = SkyAccent,
    tertiary = OrangeCta,
    onTertiary = Color.Black,
    tertiaryContainer = OrangeContainer,
    onTertiaryContainer = OrangeCta,
    background = ObsidianCanvas,
    onBackground = TextHighEmphasis,
    surface = SurfaceLevel1,
    onSurface = TextHighEmphasis,
    surfaceVariant = SurfaceLevel2,
    onSurfaceVariant = TextMediumEmphasis,
    surfaceTint = MintPrimary,
    outline = BorderSubtle,
    outlineVariant = BorderHairline,
    error = CrimsonCancelled,
    onError = Color.Black,
    errorContainer = CrimsonContainer,
    onErrorContainer = CrimsonCancelled
)

@Composable
fun PediturnoTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = PediturnoDarkColorScheme,
        typography = PediturnoTypography,
        shapes = PediturnoShapes,
        content = content
    )
}
