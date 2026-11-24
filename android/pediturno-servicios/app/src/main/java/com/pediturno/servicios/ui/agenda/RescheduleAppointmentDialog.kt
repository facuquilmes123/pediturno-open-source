package com.pediturno.servicios.ui.agenda

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.BorderSubtle
import com.pediturno.servicios.core.theme.CobaltPrimary
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.OnMintPrimary
import com.pediturno.servicios.core.theme.CrimsonCancelled
import com.pediturno.servicios.core.theme.CrimsonContainer
import com.pediturno.servicios.core.theme.SlateDeep
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import com.pediturno.servicios.data.model.Appointment
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

object RescheduleTestTags {
    const val DIALOG_TITLE = "reschedule_dialog_title"
    const val DATE = "reschedule_date"
    const val SAVE = "reschedule_save"
    fun slot(time: String) = "reschedule_slot_$time"
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun RescheduleAppointmentDialog(
    appointment: Appointment,
    availability: AvailabilityUiState,
    onLoadAvailability: (serviceId: String, dateKey: String, excludeAppointmentId: String?) -> Unit,
    onDismiss: () -> Unit,
    onConfirm: (appointmentId: String, newDateKey: String, newTime: String) -> Unit,
    isSubmitting: Boolean = false,
    errorMessage: String? = null,
    todayDateKey: String = LocalDate.now().toString()
) {
    var newTime by rememberSaveable(appointment.id) { mutableStateOf(appointment.time) }
    var newDateKey by rememberSaveable(appointment.id) { mutableStateOf(appointment.dateKey) }
    var showDatePicker by rememberSaveable(appointment.id) { mutableStateOf(false) }
    val dateLabel = remember(newDateKey) {
        runCatching { LocalDate.parse(newDateKey).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(Locale.forLanguageTag("es"))) }
            .getOrDefault("Elegir fecha")
    }

    val hasMatchingAvailability = availability.serviceId == appointment.serviceId && availability.dateKey == newDateKey
    val availableSlots = if (hasMatchingAvailability) availability.slots else emptyList()

    LaunchedEffect(appointment.serviceId, newDateKey) {
        onLoadAvailability(appointment.serviceId, newDateKey, appointment.id)
    }
    LaunchedEffect(availableSlots, hasMatchingAvailability, availability.isLoading, availability.error) {
        if (hasMatchingAvailability && !availability.isLoading && availability.error == null && availableSlots.none { it.isAvailable && it.time == newTime }) {
            newTime = availableSlots.firstOrNull { it.isAvailable }?.time.orEmpty()
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SurfaceLevel1,
        shape = RoundedCornerShape(20.dp),
        title = {
            Text(
                text = "Reprogramar Turno",
                fontWeight = FontWeight.Bold,
                fontSize = 19.sp,
                color = TextHighEmphasis,
                modifier = Modifier.testTag(RescheduleTestTags.DIALOG_TITLE)
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .imePadding()
                    .verticalScroll(rememberScrollState())
            ) {
                Text(
                    text = "${appointment.client} • ${appointment.service} (${appointment.durationMinutes}m)",
                    fontSize = 13.sp,
                    color = TextMediumEmphasis,
                    modifier = Modifier.padding(bottom = 12.dp)
                )

                if (errorMessage != null) {
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(CrimsonContainer)
                            .border(1.dp, CrimsonCancelled.copy(alpha = 0.3f), RoundedCornerShape(8.dp))
                            .padding(10.dp)
                    ) {
                        Text(
                            text = errorMessage,
                            color = CrimsonCancelled,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                    Spacer(modifier = Modifier.height(10.dp))
                }

                OutlinedButton(
                    onClick = { showDatePicker = true },
                    enabled = !isSubmitting,
                    modifier = Modifier
                        .fillMaxWidth()
                        .testTag(RescheduleTestTags.DATE)
                ) { Text("Fecha: $dateLabel", color = TextHighEmphasis) }

                Spacer(modifier = Modifier.height(10.dp))

                Text(
                    text = "HORARIOS DISPONIBLES",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextSubtle,
                    modifier = Modifier.padding(bottom = 6.dp)
                )

                when {
                    availability.isLoading || !hasMatchingAvailability -> Text(
                        "Consultando disponibilidad…", color = TextMediumEmphasis, fontSize = 12.sp
                    )
                    availability.error != null -> Text(
                        availability.error, color = CrimsonCancelled, fontSize = 12.sp
                    )
                    availableSlots.none { it.isAvailable } -> Text(
                        "No hay horarios disponibles para esta fecha.", color = TextMediumEmphasis, fontSize = 12.sp
                    )
                    else -> FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        availableSlots.filter { it.isAvailable }.forEach { slot ->
                            val isSelected = newTime == slot.time
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (isSelected) MintPrimary else SurfaceLevel2)
                                    .border(1.dp, if (isSelected) MintPrimary else BorderHairline, RoundedCornerShape(8.dp))
                                    .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
                                    .clickable { newTime = slot.time }
                                    .testTag(RescheduleTestTags.slot(slot.time))
                                    .padding(horizontal = 12.dp, vertical = 12.dp)
                            ) {
                                Text(
                                    text = slot.time,
                                    fontSize = 12.sp,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                    color = if (isSelected) OnMintPrimary else TextHighEmphasis,
                                    textDecoration = TextDecoration.None
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(appointment.id, newDateKey, newTime) },
                enabled = !isSubmitting && hasMatchingAvailability && !availability.isLoading && availability.error == null &&
                    availableSlots.any { it.isAvailable && it.time == newTime } && newDateKey.isNotBlank(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MintPrimary,
                    contentColor = OnMintPrimary
                ),
                shape = RoundedCornerShape(9999.dp),
                modifier = Modifier.testTag(RescheduleTestTags.SAVE)
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(
                        color = OnMintPrimary,
                        modifier = Modifier.height(18.dp)
                    )
                } else {
                    Text("Guardar Cambio", fontWeight = FontWeight.Bold, color = OnMintPrimary)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !isSubmitting) {
                Text("Cancelar", color = TextMediumEmphasis)
            }
        }
    )
    if (showDatePicker) {
        MonthCalendarDialog(
            currentDateKey = newDateKey,
            todayDateKey = todayDateKey,
            onDateSelected = { newDateKey = it; newTime = ""; showDatePicker = false },
            onDismiss = { showDatePicker = false }
        )
    }
}
