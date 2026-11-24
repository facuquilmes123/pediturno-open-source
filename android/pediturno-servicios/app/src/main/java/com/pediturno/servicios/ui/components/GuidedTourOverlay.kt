package com.pediturno.servicios.ui.components

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.TrendingUp
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.QrCode2
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.CobaltPrimary
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.ObsidianCanvas
import com.pediturno.servicios.core.theme.OnMintPrimary
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle

data class TourStepData(
    val stepIndex: Int,
    val badge: String,
    val title: String,
    val description: String,
    val highlightTips: List<String>,
    val icon: ImageVector,
    val accentColor: Color
)

val PediturnoTourSteps: List<TourStepData> = listOf(
    TourStepData(
        stepIndex = 0,
        badge = "BIENVENIDO A PEDITURNO",
        title = "Tu Centro de Control Profesional",
        description = "Diseñado exclusivamente para prestadores y negocios de servicios. Administra citas, optimiza tu tiempo y atiende sin fricciones.",
        highlightTips = listOf(
            "Consultá la última agenda guardada sin conexión",
            "También gestioná tu negocio desde una PC en pediturno.com"
        ),
        icon = Icons.Outlined.AutoAwesome,
        accentColor = CobaltPrimary
    ),
    TourStepData(
        stepIndex = 1,
        badge = "AGENDA INTELIGENTE",
        title = "Selector Semanal & Control de Turnos",
        description = "Navega entre fechas con un toque. Consulta el estado de cada cita, abre WhatsApp con tu cliente y reprograma con horarios libres calculados.",
        highlightTips = listOf(
            "Filtro rápido por estado: Confirmados, Pendientes, etc.",
            "Acciones de 1 toque: Llamar, WhatsApp y Reprogramar"
        ),
        icon = Icons.Outlined.CalendarMonth,
        accentColor = CobaltPrimary
    ),
    TourStepData(
        stepIndex = 2,
        badge = "MÉTRICAS & RENDIMIENTO",
        title = "Resumen de tu jornada",
        description = "Consultá las citas de la fecha elegida, su valor pactado y el primer turno pendiente. El valor de turnos no representa efectivo cobrado.",
        highlightTips = listOf(
            "Cifras tabulares precisas sin saltos de interfaz",
            "Huso horario comercial fijado para evitar confusiones"
        ),
        icon = Icons.AutoMirrored.Outlined.TrendingUp,
        accentColor = EmeraldConfirmed
    ),
    TourStepData(
        stepIndex = 3,
        badge = "CATÁLOGO DE SERVICIOS",
        title = "Precios, Duración & Tiempos de Descanso",
        description = "Definí tus servicios, precios y duración. Elegí cuánto tiempo dejar entre turnos para descansar o preparar tu espacio.",
        highlightTips = listOf(
            "Pausá las reservas en línea cuando lo necesites",
            "Cálculo estricto contra solapamientos de horario"
        ),
        icon = Icons.Outlined.Category,
        accentColor = CobaltPrimary
    ),
    TourStepData(
        stepIndex = 4,
        badge = "CRECIMIENTO & RESERVAS WEB",
        title = "Tu Enlace y Código QR Público",
        description = "Tus clientes reservan directamente en la web sin descargar ninguna app. Comparte tu link único o imprime tu QR para el mostrador.",
        highlightTips = listOf(
            "Enlace web público autoverificado https://pediturno.com/...",
            "Código QR vectorial nativo de alta resolución"
        ),
        icon = Icons.Outlined.QrCode2,
        accentColor = CobaltPrimary
    ),
    TourStepData(
        stepIndex = 5,
        badge = "GESTIÓN DE RESERVAS",
        title = "Reservas bajo tu control",
        description = "Tus clientes reservan desde tu página web. Consultá el estado del turno, confirmá o reprogramá según tu disponibilidad y acordá el cobro directamente con ellos.",
        highlightTips = listOf(
            "Confirmación automática o aprobación del negocio",
            "Cancelación y reprogramación con horarios disponibles"
        ),
        icon = Icons.Outlined.Payments,
        accentColor = MercadoPagoBlue
    )
)

/**
 * Wizard interactivo de onboarding por pasos para la primera apertura
 * o para repaso bajo demanda desde 'Mi Negocio'.
 */
@Composable
fun GuidedTourOverlay(
    currentStep: Int,
    onStepChange: (Int) -> Unit,
    onDismiss: () -> Unit
) {
    val totalSteps = PediturnoTourSteps.size
    val stepData = PediturnoTourSteps.getOrElse(currentStep) { PediturnoTourSteps.first() }

    val iconScale by animateFloatAsState(
        targetValue = 1f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow),
        label = "iconScale"
    )

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            decorFitsSystemWindows = false,
            dismissOnBackPress = true,
            dismissOnClickOutside = false
        )
    ) {
        Box(
            modifier = Modifier
                .fillMaxSize()
                .background(ObsidianCanvas.copy(alpha = 0.94f))
                .clickable(enabled = false) {}
                .safeDrawingPadding()
                .padding(20.dp),
            contentAlignment = Alignment.Center
        ) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(24.dp))
                    .background(SurfaceLevel1)
                    .border(
                        BorderStroke(
                            1.dp,
                            Brush.verticalGradient(
                                listOf(
                                    stepData.accentColor.copy(alpha = 0.5f),
                                    BorderHairline
                                )
                            )
                        ),
                        RoundedCornerShape(24.dp)
                    )
                    .padding(22.dp)
            ) {
                Column(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    // Barra superior: badge de paso y botón de cerrar/omitir
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(9999.dp))
                                .background(stepData.accentColor.copy(alpha = 0.15f))
                                .border(1.dp, stepData.accentColor.copy(alpha = 0.3f), RoundedCornerShape(9999.dp))
                                .padding(horizontal = 10.dp, vertical = 4.dp)
                        ) {
                            Text(
                                text = "PASO ${currentStep + 1} DE $totalSteps",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                color = stepData.accentColor,
                                letterSpacing = 0.06.sp
                            )
                        }

                        IconButton(
                            onClick = onDismiss,
                            modifier = Modifier.size(48.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Cerrar tour",
                                tint = TextSubtle,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    // Contenedor animado del icono con resplandor
                    Box(
                        modifier = Modifier
                            .size(76.dp)
                            .scale(iconScale)
                            .clip(CircleShape)
                            .background(
                                Brush.radialGradient(
                                    listOf(
                                        stepData.accentColor.copy(alpha = 0.25f),
                                        SurfaceLevel2
                                    )
                                )
                            )
                            .border(1.5.dp, stepData.accentColor.copy(alpha = 0.5f), CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Icon(
                            imageVector = stepData.icon,
                            contentDescription = null,
                            tint = stepData.accentColor,
                            modifier = Modifier.size(38.dp)
                        )
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    AnimatedContent(
                        targetState = stepData,
                        transitionSpec = {
                            fadeIn(animationSpec = tween(220)) togetherWith fadeOut(animationSpec = tween(150))
                        },
                        label = "TourTextTransition"
                    ) { data ->
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Text(
                                text = data.badge,
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = data.accentColor,
                                letterSpacing = 0.05.sp
                            )
                            Spacer(modifier = Modifier.height(4.dp))
                            Text(
                                text = data.title,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextHighEmphasis,
                                textAlign = TextAlign.Center
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = data.description,
                                fontSize = 13.sp,
                                color = TextMediumEmphasis,
                                textAlign = TextAlign.Center,
                                lineHeight = 19.sp
                            )
                            Spacer(modifier = Modifier.height(16.dp))

                            // Puntos clave / tips de la sección
                            Column(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(SurfaceLevel2)
                                    .border(1.dp, BorderHairline, RoundedCornerShape(14.dp))
                                    .padding(horizontal = 14.dp, vertical = 10.dp),
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                data.highlightTips.forEach { tip ->
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier = Modifier
                                                .size(6.dp)
                                                .clip(CircleShape)
                                                .background(data.accentColor)
                                        )
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(
                                            text = tip,
                                            fontSize = 12.sp,
                                            color = TextHighEmphasis,
                                            fontWeight = FontWeight.Medium
                                        )
                                    }
                                }
                            }
                        }
                    }

                    Spacer(modifier = Modifier.height(20.dp))

                    // Indicador de puntos (Dots)
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        repeat(totalSteps) { index ->
                            val isSelected = index == currentStep
                            Box(
                                modifier = Modifier
                                    .height(6.dp)
                                    .width(if (isSelected) 22.dp else 6.dp)
                                    .clip(RoundedCornerShape(9999.dp))
                                    .background(if (isSelected) stepData.accentColor else BorderHairline)
                                    .clickable { onStepChange(index) }
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(20.dp))

                    // Botones de acción inferior
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        if (currentStep > 0) {
                            OutlinedButton(
                                onClick = { onStepChange(currentStep - 1) },
                                shape = RoundedCornerShape(12.dp),
                                border = BorderStroke(1.dp, BorderHairline),
                                colors = ButtonDefaults.outlinedButtonColors(contentColor = TextMediumEmphasis)
                            ) {
                                Icon(
                                    imageVector = Icons.AutoMirrored.Outlined.ArrowBack,
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Anterior", fontSize = 12.sp)
                            }
                        } else {
                            Text(
                                text = "Omitir tour",
                                fontSize = 12.sp,
                                color = TextSubtle,
                                fontWeight = FontWeight.SemiBold,
                                modifier = Modifier
                                    .clickable { onDismiss() }
                                    .padding(8.dp)
                            )
                        }

                        val actionContentColor = if (stepData.accentColor == MintPrimary || stepData.accentColor == CobaltPrimary) {
                            OnMintPrimary
                        } else {
                            Color.White
                        }

                        Button(
                            onClick = {
                                if (currentStep < totalSteps - 1) {
                                    onStepChange(currentStep + 1)
                                } else {
                                    onDismiss()
                                }
                            },
                            colors = ButtonDefaults.buttonColors(
                                containerColor = stepData.accentColor,
                                contentColor = actionContentColor
                            ),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Text(
                                text = if (currentStep < totalSteps - 1) "Siguiente" else "¡Comenzar ahora!",
                                fontWeight = FontWeight.Bold,
                                fontSize = 13.sp,
                                color = actionContentColor
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Icon(
                                imageVector = if (currentStep < totalSteps - 1) {
                                    Icons.AutoMirrored.Outlined.ArrowForward
                                } else {
                                    Icons.Default.Check
                                },
                                contentDescription = null,
                                modifier = Modifier.size(16.dp),
                                tint = actionContentColor
                            )
                        }
                    }
                }
            }
        }
    }
}
