package com.pediturno.servicios.ui.agenda

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
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
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.SlateDeep
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import com.pediturno.servicios.data.model.ServiceItem
import java.text.NumberFormat
import java.util.Locale

object AppointmentTestTags {
    const val CLIENT_NAME = "appointment_client_name"
    const val CLIENT_PHONE = "appointment_client_phone"
    const val CLIENT_EMAIL = "appointment_client_email"
    const val CONFIRM = "appointment_confirm"
    fun service(serviceId: String) = "appointment_service_$serviceId"
    fun slot(time: String) = "appointment_slot_$time"
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun CreateAppointmentDialog(
    services: List<ServiceItem>,
    dateKey: String,
    availability: AvailabilityUiState,
    onLoadAvailability: (serviceId: String, dateKey: String) -> Unit,
    bookingBufferMinutes: Int = 15,
    prefillClientName: String = "",
    prefillClientPhone: String = "",
    prefillClientEmail: String = "",
    onDismiss: () -> Unit,
    onConfirm: (client: String, phone: String, email: String, serviceId: String, time: String) -> Unit,
    isSubmitting: Boolean = false,
    errorMessage: String? = null
) {
    val activeServices = remember(services) { services.filter { it.isActive } }
    var selectedServiceId by rememberSaveable(dateKey) { mutableStateOf(activeServices.firstOrNull()?.id ?: "") }
    val selectedService = activeServices.firstOrNull { it.id == selectedServiceId } ?: activeServices.firstOrNull()
    val hasMatchingAvailability = availability.serviceId == selectedServiceId && availability.dateKey == dateKey
    val availableSlots = if (hasMatchingAvailability) availability.slots else emptyList()

    var clientName by rememberSaveable(dateKey) { mutableStateOf(prefillClientName) }
    var clientPhone by rememberSaveable(dateKey) { mutableStateOf(prefillClientPhone) }
    var clientEmail by rememberSaveable(dateKey) { mutableStateOf(prefillClientEmail) }
    var time by rememberSaveable(dateKey) { mutableStateOf("") }

    LaunchedEffect(activeServices) {
        if (selectedServiceId.isBlank() && activeServices.isNotEmpty()) {
            selectedServiceId = activeServices.first().id
        }
    }
    LaunchedEffect(selectedServiceId, dateKey) {
        if (selectedServiceId.isNotBlank()) onLoadAvailability(selectedServiceId, dateKey)
    }
    LaunchedEffect(availableSlots, hasMatchingAvailability, availability.isLoading, availability.error) {
        if (hasMatchingAvailability && !availability.isLoading && availability.error == null) {
            val selectedIsAvailable = availableSlots.any { it.isAvailable && it.time == time }
            if (!selectedIsAvailable && availableSlots.isNotEmpty()) {
                time = availableSlots.firstOrNull { it.isAvailable }?.time.orEmpty()
            }
        }
    }

    val currencyFormat = remember {
        NumberFormat.getCurrencyInstance(Locale.forLanguageTag("es-AR")).apply {
            maximumFractionDigits = 2
        }
    }

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = MintPrimary,
        unfocusedBorderColor = BorderSubtle,
        focusedTextColor = TextHighEmphasis,
        unfocusedTextColor = TextHighEmphasis,
        focusedLabelColor = MintPrimary,
        unfocusedLabelColor = TextMediumEmphasis,
        cursorColor = MintPrimary
    )

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SurfaceLevel1,
        shape = RoundedCornerShape(20.dp),
        title = {
            Column {
                Text(
                    text = "Nuevo Turno Manual",
                    fontWeight = FontWeight.Bold,
                    fontSize = 19.sp,
                    color = TextHighEmphasis
                )
                Text(
                    text = "Fecha: $dateKey • Tiempo entre turnos: $bookingBufferMinutes min",
                    fontSize = 12.sp,
                    color = CobaltPrimary,
                    fontWeight = FontWeight.Medium
                )
            }
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .imePadding()
                    .verticalScroll(rememberScrollState())
            ) {
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

                Text(
                    text = "1. SELECCIONAR SERVICIO",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextSubtle,
                    letterSpacing = 0.05.sp,
                    modifier = Modifier.padding(bottom = 6.dp)
                )

                activeServices.forEach { service ->
                    val isSelected = service.id == selectedServiceId
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 3.dp)
                            .clip(RoundedCornerShape(10.dp))
                            .background(if (isSelected) SurfaceLevel2 else SlateDeep)
                            .border(
                                width = 1.dp,
                                color = if (isSelected) MintPrimary else BorderHairline,
                                shape = RoundedCornerShape(10.dp)
                            )
                            .clickable { selectedServiceId = service.id }
                            .testTag(AppointmentTestTags.service(service.id))
                            .padding(horizontal = 12.dp, vertical = 9.dp)
                    ) {
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Column {
                                Text(
                                    text = service.name,
                                    fontSize = 13.sp,
                                    fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal,
                                    color = if (isSelected) MintPrimary else TextHighEmphasis
                                )
                                Text(
                                    text = "${service.durationMinutes} min",
                                    fontSize = 11.sp,
                                    color = TextMediumEmphasis
                                )
                            }
                            Text(
                                text = currencyFormat.format(service.price),
                                style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                color = EmeraldConfirmed
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                Text(
                    text = "2. HORARIOS DISPONIBLES (VERIFICADOS EN EL SERVIDOR)",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextSubtle,
                    letterSpacing = 0.05.sp,
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
                        "No hay horarios disponibles para este servicio y fecha.", color = TextMediumEmphasis, fontSize = 12.sp
                    )
                    else -> FlowRow(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        availableSlots.filter { it.isAvailable }.forEach { slot ->
                        val isSelected = time == slot.time
                        val bgColor = when {
                            isSelected -> MintPrimary
                            else -> SurfaceLevel2
                        }
                        val textColor = when {
                            isSelected -> OnMintPrimary
                            else -> TextHighEmphasis
                        }
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(bgColor)
                                .border(
                                    width = 1.dp,
                                    color = if (isSelected) MintPrimary else BorderHairline,
                                    shape = RoundedCornerShape(8.dp)
                                )
                                .defaultMinSize(minWidth = 48.dp, minHeight = 48.dp)
                                .clickable { time = slot.time }
                                .testTag(AppointmentTestTags.slot(slot.time))
                                .padding(horizontal = 12.dp, vertical = 12.dp)
                        ) {
                            Text(
                                text = slot.time,
                                fontSize = 12.sp,
                                fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                color = textColor,
                                textDecoration = TextDecoration.None
                            )
                        }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                OutlinedTextField(
                    value = clientName,
                    onValueChange = { clientName = it },
                    label = { Text("Nombre del Cliente") },
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth().testTag(AppointmentTestTags.CLIENT_NAME)
                )

                Spacer(modifier = Modifier.height(8.dp))

                OutlinedTextField(
                    value = clientPhone,
                    onValueChange = { clientPhone = it },
                    label = { Text("Teléfono / WhatsApp") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth().testTag(AppointmentTestTags.CLIENT_PHONE)
                )

                Spacer(modifier = Modifier.height(8.dp))

                OutlinedTextField(
                    value = clientEmail,
                    onValueChange = { clientEmail = it },
                    label = { Text("Correo electrónico (opcional)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth().testTag(AppointmentTestTags.CLIENT_EMAIL)
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    onConfirm(clientName, clientPhone, clientEmail, selectedServiceId, time)
                },
                enabled = !isSubmitting && hasMatchingAvailability && !availability.isLoading && availability.error == null &&
                    availableSlots.any { it.isAvailable && it.time == time } && clientName.isNotBlank() &&
                    clientPhone.isNotBlank() && selectedServiceId.isNotBlank(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MintPrimary,
                    contentColor = OnMintPrimary
                ),
                shape = RoundedCornerShape(9999.dp),
                modifier = Modifier.testTag(AppointmentTestTags.CONFIRM)
            ) {
                if (isSubmitting) {
                    CircularProgressIndicator(
                        color = OnMintPrimary,
                        modifier = Modifier.height(18.dp)
                    )
                } else {
                    Text("Confirmar Turno", fontWeight = FontWeight.Bold, color = OnMintPrimary)
                }
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !isSubmitting) {
                Text("Cancelar", color = TextMediumEmphasis)
            }
        }
    )
}
