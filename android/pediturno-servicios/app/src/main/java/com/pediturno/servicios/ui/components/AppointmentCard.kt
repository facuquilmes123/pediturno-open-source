package com.pediturno.servicios.ui.components

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.DoneAll
import androidx.compose.material.icons.outlined.EventRepeat
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.core.theme.AmberPending
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.CobaltPrimary
import com.pediturno.servicios.core.theme.CrimsonCancelled
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.DepositPaymentState
import com.pediturno.servicios.data.model.AppointmentStatus
import java.text.NumberFormat
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Stable semantics for the instrumentation suite.  The identifiers are derived
 * from the server appointment id, so they cannot accidentally target another
 * business' card after a session change.
 */
object AppointmentCardTestTags {
    fun reschedule(appointmentId: String) = "appointment_reschedule_$appointmentId"
    fun complete(appointmentId: String) = "appointment_complete_$appointmentId"
}

@Composable
fun AppointmentCard(
    appointment: Appointment,
    onRescheduleClick: (Appointment) -> Unit,
    onStatusChange: (Appointment, AppointmentStatus) -> Unit,
    modifier: Modifier = Modifier,
    onCardClick: (Appointment) -> Unit = {},
    onExternalActionError: (String) -> Unit = {},
    isHighlighted: Boolean = false
) {
    val context = LocalContext.current
    var isPressed by remember { mutableStateOf(false) }

    val scale by animateFloatAsState(
        targetValue = if (isPressed) 0.985f else 1f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioLowBouncy,
            stiffness = Spring.StiffnessMedium
        ),
        label = "cardScaleAnimation"
    )

    val currencyFormat = remember {
        NumberFormat.getCurrencyInstance(Locale.forLanguageTag("es-AR")).apply {
            minimumFractionDigits = 2
            maximumFractionDigits = 2
        }
    }

    val endTime = runCatching {
        LocalTime.parse(appointment.time, DateTimeFormatter.ofPattern("HH:mm", Locale.US))
            .plusMinutes(appointment.durationMinutes.toLong())
            .format(DateTimeFormatter.ofPattern("HH:mm", Locale.US))
    }.getOrDefault("")

    val railColor = when (appointment.status) {
        AppointmentStatus.Confirmado -> EmeraldConfirmed
        AppointmentStatus.Pendiente -> AmberPending
        AppointmentStatus.Completado -> CobaltPrimary
        AppointmentStatus.Cancelado -> CrimsonCancelled
    }

    val initials = appointment.client
        .split(" ")
        .filter { it.isNotBlank() }
        .take(2)
        .mapNotNull { it.firstOrNull()?.uppercaseChar() }
        .joinToString("")
        .ifEmpty { "C" }

    val borderStroke = if (isHighlighted) {
        BorderStroke(1.5.dp, CobaltPrimary)
    } else {
        BorderStroke(1.dp, BorderHairline)
    }

    Card(
        modifier = modifier
            .fillMaxWidth()
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            }
            .pointerInput(Unit) {
                detectTapGestures(
                    onPress = {
                        isPressed = true
                        tryAwaitRelease()
                        isPressed = false
                    },
                    onTap = { onCardClick(appointment) }
                )
            },
        shape = RoundedCornerShape(16.dp),
        colors = CardDefaults.cardColors(containerColor = SurfaceLevel1),
        border = borderStroke,
        elevation = CardDefaults.cardElevation(defaultElevation = if (isHighlighted) 6.dp else 2.dp)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(IntrinsicSize.Min)
        ) {
            // Riel semántico izquierdo (4dp) con remate redondeado
            Box(
                modifier = Modifier
                    .width(4.dp)
                    .fillMaxHeight()
                    .background(railColor)
            )

            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(14.dp)
            ) {
                // Fila 1: Rango Horario, Duración + Buffer y Badge de Estado
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = if (endTime.isNotBlank()) "${appointment.time} – $endTime" else appointment.time,
                            style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
                            fontSize = 18.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextHighEmphasis
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(6.dp))
                                .background(SurfaceLevel2)
                                .border(1.dp, BorderHairline, RoundedCornerShape(6.dp))
                                .padding(horizontal = 7.dp, vertical = 2.dp)
                        ) {
                            Text(
                                text = "${appointment.durationMinutes} min + ${appointment.bookingBufferMinutes} min de pausa",
                                fontSize = 10.sp,
                                color = TextMediumEmphasis,
                                fontWeight = FontWeight.SemiBold
                            )
                        }
                    }

                    StatusBadge(status = appointment.status)
                }

                Spacer(modifier = Modifier.height(10.dp))

                // Fila 2: Avatar e Información del Cliente, Servicio y Notas
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Avatar con monograma en zafiro pizarra
                    Box(
                        modifier = Modifier
                            .size(42.dp)
                            .clip(CircleShape)
                            .background(SurfaceLevel2)
                            .border(1.dp, BorderHairline, CircleShape),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = initials,
                            fontSize = 14.sp,
                            fontWeight = FontWeight.Bold,
                            color = CobaltPrimary
                        )
                    }

                    Spacer(modifier = Modifier.width(10.dp))

                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = appointment.client,
                            fontSize = 15.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = TextHighEmphasis,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        Text(
                            text = appointment.service,
                            fontSize = 13.sp,
                            color = TextMediumEmphasis,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (appointment.notes.isNotBlank()) {
                            Text(
                                text = appointment.notes,
                                fontSize = 11.sp,
                                color = TextSubtle,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }
                    }

                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            text = currencyFormat.format(appointment.priceAtBooking),
                            style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = EmeraldConfirmed
                        )
                        val hasDeposit = appointment.depositAmount > 0.0
                        val isDepositPaid = appointment.depositState == DepositPaymentState.PAID
                        if (hasDeposit) {
                            Spacer(modifier = Modifier.height(3.dp))
                            MercadoPagoDepositPill(
                                depositAmount = appointment.depositAmount,
                                isPaid = isDepositPaid,
                                requiresReview = appointment.depositState == DepositPaymentState.REVIEW,
                                isExpired = appointment.depositState == DepositPaymentState.EXPIRED
                            )
                        }
                        if (appointment.fromCache) {
                            Text(
                                text = "Guardado sin conexión",
                                fontSize = 10.sp,
                                color = AmberPending,
                                fontWeight = FontWeight.Medium
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                // Fila 3: Acciones Rápidas (WhatsApp, Llamada, Ciclo de vida con touch target >= 48dp)
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    // Accesos directos de contacto (WhatsApp Oficial / Teléfono)
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        WhatsAppActionIconButton(
                            phoneNumber = appointment.clientPhone,
                            onError = onExternalActionError
                        )

                        Box(
                            modifier = Modifier
                                .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                                .clickable {
                                    val cleanPhone = appointment.clientPhone.filter { it.isDigit() }
                                    val uri = Uri.parse("tel:$cleanPhone")
                                    runCatching {
                                        context.startActivity(Intent(Intent.ACTION_DIAL, uri))
                                    }.onFailure {
                                        onExternalActionError("Marcador telefónico no disponible ($cleanPhone)")
                                    }
                                },
                            contentAlignment = Alignment.Center
                        ) {
                            Box(
                                modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .background(SurfaceLevel2)
                                .border(1.dp, BorderHairline, CircleShape),
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Call,
                                    contentDescription = "Llamar cliente",
                                    tint = TextMediumEmphasis,
                                    modifier = Modifier.size(16.dp)
                                )
                            }
                        }
                    }

                    // Acciones de ciclo de vida del turno
                    if (!appointment.status.isTerminal) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            if (appointment.status == AppointmentStatus.Pendiente) {
                                OutlinedButton(
                                    onClick = { onStatusChange(appointment, AppointmentStatus.Confirmado) },
                                    shape = RoundedCornerShape(8.dp),
                                    modifier = Modifier.heightIn(min = 48.dp)
                                ) {
                                    Icon(
                                        imageVector = Icons.Outlined.Check,
                                        contentDescription = null,
                                        tint = EmeraldConfirmed,
                                        modifier = Modifier.size(13.dp)
                                    )
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Confirmar", color = EmeraldConfirmed, fontSize = 11.sp)
                                }
                            }

                            OutlinedButton(
                                onClick = { onRescheduleClick(appointment) },
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier
                                    .heightIn(min = 48.dp)
                                    .testTag(AppointmentCardTestTags.reschedule(appointment.id))
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.EventRepeat,
                                    contentDescription = null,
                                    tint = CobaltPrimary,
                                    modifier = Modifier.size(13.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Mover", color = CobaltPrimary, fontSize = 11.sp)
                            }

                            OutlinedButton(
                                onClick = { onStatusChange(appointment, AppointmentStatus.Completado) },
                                shape = RoundedCornerShape(8.dp),
                                modifier = Modifier
                                    .heightIn(min = 48.dp)
                                    .testTag(AppointmentCardTestTags.complete(appointment.id))
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.DoneAll,
                                    contentDescription = null,
                                    tint = EmeraldConfirmed,
                                    modifier = Modifier.size(13.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Listo", color = EmeraldConfirmed, fontSize = 11.sp)
                            }

                            Box(
                                modifier = Modifier
                                    .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
                                    .clickable { onStatusChange(appointment, AppointmentStatus.Cancelado) },
                                contentAlignment = Alignment.Center
                            ) {
                                Icon(
                                    imageVector = Icons.Outlined.Close,
                                    contentDescription = "Cancelar turno",
                                    tint = CrimsonCancelled,
                                    modifier = Modifier.size(18.dp)
                                )
                            }
                        }
                    } else {
                        Text(
                            text = if (appointment.status == AppointmentStatus.Completado) {
                                "Turno finalizado"
                            } else {
                                "Turno cancelado"
                            },
                            style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
                            fontSize = 12.sp,
                            color = TextSubtle,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }
    }
}
