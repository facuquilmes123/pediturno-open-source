package com.pediturno.servicios.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Language
import androidx.compose.material.icons.outlined.LocationOn
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import coil3.compose.AsyncImage
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.R
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import com.pediturno.servicios.data.model.BusinessProfile

data class ThemePalette(
    val name: String,
    val primary: Color,
    val background: Color,
    val surface: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val accent: Color
)

fun resolveThemePalette(themeName: String, customPrimary: String?, customBg: String?, customAccent: String?): ThemePalette {
    return when (themeName.lowercase()) {
        "ocaso" -> ThemePalette(
            name = "Ocaso",
            primary = Color(0xFFD97706),
            background = Color(0xFFFAF5EF),
            surface = Color(0xFFFFFFFF),
            textPrimary = Color(0xFF291E16),
            textSecondary = Color(0xFF786253),
            accent = Color(0xFFB45309)
        )
        "bosque" -> ThemePalette(
            name = "Bosque",
            primary = Color(0xFF15803D),
            background = Color(0xFFF2F7F3),
            surface = Color(0xFFFFFFFF),
            textPrimary = Color(0xFF14301B),
            textSecondary = Color(0xFF4A6851),
            accent = Color(0xFF166534)
        )
        "noche" -> ThemePalette(
            name = "Noche",
            primary = Color(0xFFFACC15),
            background = Color(0xFF111827),
            surface = Color(0xFF1F2937),
            textPrimary = Color(0xFFF9FAFB),
            textSecondary = Color(0xFF9CA3AF),
            accent = Color(0xFFEAB308)
        )
        "cielo" -> ThemePalette(
            name = "Cielo",
            primary = Color(0xFF2563EB),
            background = Color(0xFFEFF6FF),
            surface = Color(0xFFFFFFFF),
            textPrimary = Color(0xFF1E293B),
            textSecondary = Color(0xFF64748B),
            accent = Color(0xFF1D4ED8)
        )
        "coral" -> ThemePalette(
            name = "Coral",
            primary = Color(0xFFE11D48),
            background = Color(0xFFFFF1F2),
            surface = Color(0xFFFFFFFF),
            textPrimary = Color(0xFF2B171C),
            textSecondary = Color(0xFF884D5B),
            accent = Color(0xFFBE123C)
        )
        "lavanda" -> ThemePalette(
            name = "Lavanda",
            primary = Color(0xFF7C3AED),
            background = Color(0xFFF5F3FF),
            surface = Color(0xFFFFFFFF),
            textPrimary = Color(0xFF231838),
            textSecondary = Color(0xFF6B588C),
            accent = Color(0xFF6D28D9)
        )
        "custom" -> ThemePalette(
            name = "Personalizado",
            primary = parseHexColor(customPrimary ?: "#4FB5AB"),
            background = parseHexColor(customBg ?: "#F0F0F0"),
            surface = Color.White,
            textPrimary = Color(0xFF111827),
            textSecondary = Color(0xFF4B5563),
            accent = parseHexColor(customAccent ?: "#3B998F")
        )
        else -> ThemePalette( // "menta"
            name = "Menta",
            primary = Color(0xFF0D9488),
            background = Color(0xFFF0FDFA),
            surface = Color(0xFFFFFFFF),
            textPrimary = Color(0xFF134E4A),
            textSecondary = Color(0xFF2D6A66),
            accent = Color(0xFF0F766E)
        )
    }
}

private fun parseHexColor(hex: String): Color {
    val clean = hex.removePrefix("#").trim()
    return try {
        if (clean.length == 6) {
            Color(android.graphics.Color.parseColor("#$clean"))
        } else {
            Color(0xFF4FB5AB)
        }
    } catch (_: Exception) {
        Color(0xFF4FB5AB)
    }
}

@Composable
fun LiveStorefrontPreview(
    profile: BusinessProfile,
    modifier: Modifier = Modifier
) {
    val palette = resolveThemePalette(
        profile.theme,
        profile.customTheme.primary,
        profile.customTheme.background,
        profile.customTheme.accent
    )

    val animatedBg by animateColorAsState(palette.background, tween(400), label = "bg")
    val animatedPrimary by animateColorAsState(palette.primary, tween(400), label = "primary")
    val animatedSurface by animateColorAsState(palette.surface, tween(400), label = "surface")

    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(SurfaceLevel1)
            .border(1.dp, BorderHairline, RoundedCornerShape(20.dp))
            .padding(16.dp)
    ) {
        Column {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(animatedPrimary)
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "VISTA PREVIA EN VIVO DE TU PÁGINA",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextHighEmphasis
                    )
                }

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(9999.dp))
                        .background(animatedPrimary.copy(alpha = 0.15f))
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                ) {
                    Text(
                        text = "Tema: ${palette.name}",
                        fontSize = 10.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextMediumEmphasis
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Marco simulado de celular
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .border(2.dp, BorderHairline, RoundedCornerShape(16.dp))
                    .background(animatedBg)
                    .padding(14.dp)
            ) {
                Column(
                    horizontalAlignment = Alignment.CenterHorizontally,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    // Logo o Inicial en círculo
                    Box(
                        modifier = Modifier
                            .size(52.dp)
                            .clip(CircleShape)
                            .background(animatedSurface)
                            .border(2.dp, animatedPrimary, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = profile.name.take(2).uppercase(),
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = animatedPrimary
                        )
                        if (!profile.logoUrl.isNullOrBlank()) {
                            AsyncImage(
                                model = profile.logoUrl,
                                contentDescription = "Logo de ${profile.name}",
                                contentScale = ContentScale.Crop,
                                modifier = Modifier.matchParentSize().clip(CircleShape)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(8.dp))

                    Text(
                        text = profile.name,
                        fontSize = 16.sp,
                        fontWeight = FontWeight.Bold,
                        color = palette.textPrimary,
                        textAlign = TextAlign.Center,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )

                    Text(
                        text = "pediturno.com/${profile.slug}",
                        fontSize = 11.sp,
                        color = animatedPrimary,
                        fontWeight = FontWeight.SemiBold
                    )

                    if (profile.description.isNotBlank()) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = profile.description,
                            fontSize = 11.sp,
                            color = palette.textSecondary,
                            textAlign = TextAlign.Center,
                            maxLines = 2,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    // Tarjeta de información de contacto en la web
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                            .background(animatedSurface)
                            .padding(10.dp)
                    ) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Outlined.LocationOn,
                                    contentDescription = null,
                                    tint = animatedPrimary,
                                    modifier = Modifier.size(14.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = profile.address.formatted.ifBlank { "Ubicación en mapa" },
                                    fontSize = 10.sp,
                                    color = palette.textPrimary,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    Icons.Outlined.Schedule,
                                    contentDescription = null,
                                    tint = animatedPrimary,
                                    modifier = Modifier.size(14.dp)
                                )
                                Spacer(modifier = Modifier.width(6.dp))
                                Text(
                                    text = "Horarios según el servicio",
                                    fontSize = 10.sp,
                                    color = palette.textSecondary
                                )
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    // Botón principal de reserva simulado
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(38.dp)
                            .clip(RoundedCornerShape(9999.dp))
                            .background(animatedPrimary),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "Reservar turno en línea",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = Color.White
                        )
                    }

                    // La página pública muestra sólo que el negocio configuró una seña.
                    if (profile.mercadopago.requireDeposit) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(Color.White)
                                .border(1.dp, Color(0xFFE2E8F0), RoundedCornerShape(8.dp))
                                .padding(horizontal = 8.dp, vertical = 5.dp),
                            horizontalArrangement = Arrangement.Center,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Image(
                                painter = painterResource(id = R.drawable.mpago),
                                contentDescription = "Mercado Pago",
                                modifier = Modifier.height(14.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "Seña configurada por el negocio",
                                fontSize = 9.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = Color(0xFF0082BD)
                            )
                        }
                    }
                }

                // Botón flotante de WhatsApp oficial simulado
                if (profile.whatsappButtonEnabled && profile.whatsappNumber.isNotBlank()) {
                    Box(
                        modifier = Modifier
                            .align(Alignment.BottomEnd)
                            .padding(4.dp)
                            .size(34.dp)
                            .clip(CircleShape)
                            .background(Color(0xFF25D366))
                            .border(1.5.dp, Color.White, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Image(
                            painter = painterResource(id = R.drawable.ic_whatsapp),
                            contentDescription = "WhatsApp flotante",
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            }
        }
    }
}
