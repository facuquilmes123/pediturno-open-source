package com.pediturno.servicios.ui.agenda

import coil3.compose.AsyncImage
import androidx.compose.foundation.layout.size

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.ui.semantics.Role
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.R
import com.pediturno.servicios.core.theme.AmberContainer
import com.pediturno.servicios.core.theme.AmberPending
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
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.DepositPaymentState
import com.pediturno.servicios.data.model.AppointmentNotificationKind
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.model.ServiceItem
import com.pediturno.servicios.data.repository.ImageCategory
import com.pediturno.servicios.ui.components.StatusBadge
import java.text.NumberFormat
import java.util.Locale

/** Stable semantics used by the emulator-only vertical test; not a production bypass. */
object WorkspaceTestTags {
    const val SERVICE_NAME = "workspace_service_name"
    const val SERVICE_DURATION = "workspace_service_duration"
    const val SERVICE_PRICE = "workspace_service_price"
    const val SERVICE_SAVE = "workspace_service_save"
    const val CLIENT_NAME = "workspace_client_name"
    const val CLIENT_PHONE = "workspace_client_phone"
    const val CLIENT_EMAIL = "workspace_client_email"
    const val CLIENT_SAVE = "workspace_client_save"
}

@Composable
fun AppointmentDetailDialog(
    appointment: Appointment,
    onDismiss: () -> Unit,
    onReschedule: (Appointment) -> Unit,
    onStatusChange: (Appointment, AppointmentStatus) -> Unit,
    onSendNotification: (String, AppointmentNotificationKind) -> Unit
) {
    val currencyFormat = remember {
        NumberFormat.getCurrencyInstance(Locale.forLanguageTag("es-AR")).apply {
            maximumFractionDigits = 2
        }
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SurfaceLevel1,
        shape = RoundedCornerShape(20.dp),
        title = {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Ficha del Turno",
                    fontWeight = FontWeight.Bold,
                    fontSize = 18.sp,
                    color = TextHighEmphasis
                )
                StatusBadge(status = appointment.status)
            }
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                        .background(SurfaceLevel2)
                        .border(1.dp, BorderHairline, RoundedCornerShape(12.dp))
                        .padding(12.dp)
                ) {
                    Column {
                        Text(
                            text = appointment.client,
                            fontSize = 16.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextHighEmphasis
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "Tel: ${appointment.clientPhone} • ${appointment.clientEmail.ifBlank { "Sin correo" }}",
                            fontSize = 12.sp,
                            color = TextMediumEmphasis
                        )
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "${appointment.service} · ${appointment.durationMinutes} min · ${appointment.bookingBufferMinutes} min entre turnos",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = CobaltPrimary
                        )
                        Text(
                            text = "Fecha: ${appointment.dateKey} a las ${appointment.time} hs",
                            fontSize = 13.sp,
                            color = TextHighEmphasis
                        )
                        Spacer(modifier = Modifier.height(6.dp))
                        Text(
                            text = "Precio al reservar: ${currencyFormat.format(appointment.priceAtBooking)}",
                            style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Bold,
                            color = EmeraldConfirmed
                        )

                        val hasDeposit = appointment.depositAmount > 0.0
                        val depositState = appointment.depositState
                        val isDepositPaid = depositState == DepositPaymentState.PAID

                        if (hasDeposit) {
                            Spacer(modifier = Modifier.height(8.dp))
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(if (isDepositPaid) Color(0x1F009EE3) else AmberPending.copy(alpha = 0.15f))
                                    .border(1.dp, if (isDepositPaid) Color(0x52009EE3) else AmberPending.copy(alpha = 0.4f), RoundedCornerShape(8.dp))
                                    .padding(8.dp)
                            ) {
                                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Image(
                                                painter = painterResource(id = R.drawable.mpago),
                                                contentDescription = "Mercado Pago",
                                                modifier = Modifier.height(15.dp)
                                            )
                                            Spacer(modifier = Modifier.width(6.dp))
                                            Text(
                                                text = when (depositState) {
                                                    DepositPaymentState.REVIEW -> "Pago a revisar"
                                                    DepositPaymentState.EXPIRED -> "Seña Vencida"
                                                    DepositPaymentState.PAID -> "Seña Cobrada"
                                                    else -> "Seña Pendiente"
                                                },
                                                fontSize = 11.sp,
                                                fontWeight = FontWeight.Bold,
                                                color = if (isDepositPaid) Color(0xFF00B1EA) else AmberPending
                                            )
                                        }
                                        Text(
                                            text = currencyFormat.format(appointment.depositAmount),
                                            style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
                                            fontSize = 12.sp,
                                            fontWeight = FontWeight.Bold,
                                            color = if (isDepositPaid) Color(0xFF00B1EA) else AmberPending
                                        )
                                    }
                                    val remaining = (appointment.priceAtBooking - appointment.depositAmount).coerceAtLeast(0.0)
                                    Text(
                                        text = if (depositState == DepositPaymentState.REVIEW) {
                                            "Revisá la operación en Mercado Pago antes de decidir cómo continuar. El estado del turno se conserva."
                                        } else if (depositState == DepositPaymentState.EXPIRED) {
                                            "El plazo de pago venció. Revisá el estado del turno antes de continuar."
                                        } else if (isDepositPaid) {
                                            "Saldo restante a cobrar en salón: ${currencyFormat.format(remaining)}"
                                        } else {
                                            "El cliente debe abonar la seña para asegurar su lugar"
                                        },
                                        style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
                                        fontSize = 10.sp,
                                        color = TextMediumEmphasis
                                    )
                                }
                            }
                        }

                    }
                }

                if (!appointment.status.isTerminal) {
                    Spacer(modifier = Modifier.height(14.dp))
                    Text(
                        text = "ACCIONES DISPONIBLES",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextSubtle
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                onDismiss()
                                onReschedule(appointment)
                            },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Text("Reprogramar", color = CobaltPrimary, fontSize = 12.sp)
                        }
                        Button(
                            onClick = {
                                onStatusChange(appointment, AppointmentStatus.Completado)
                                onDismiss()
                            },
                            modifier = Modifier.weight(1f),
                            colors = ButtonDefaults.buttonColors(containerColor = EmeraldConfirmed),
                            shape = RoundedCornerShape(10.dp)
                        ) {
                            Text("Completar", color = Color.Black, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                    OutlinedButton(
                        onClick = { onSendNotification(appointment.id, AppointmentNotificationKind.REMINDER) },
                        modifier = Modifier.fillMaxWidth(),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Text("Enviar recordatorio", color = CobaltPrimary, fontSize = 12.sp)
                    }
                    if (appointment.status == AppointmentStatus.Pendiente) {
                        TextButton(
                            onClick = { onSendNotification(appointment.id, AppointmentNotificationKind.CONFIRMATION) },
                            modifier = Modifier.fillMaxWidth()
                        ) { Text("Enviar confirmación", color = CobaltPrimary, fontSize = 12.sp) }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Cerrar", color = CobaltPrimary, fontWeight = FontWeight.SemiBold)
            }
        }
    )
}

@Composable
fun SaveServiceDialog(
    initialService: ServiceItem?,
    isSubmitting: Boolean,
    errorMessage: String?,
    onDismiss: () -> Unit,
    onUploadImage: (Uri, (String) -> Unit) -> Unit,
    onConfirm: (name: String, durationMinutes: Int, price: Double, status: String, photoUrl: String?) -> Unit
) {
    var name by rememberSaveable(initialService?.id) { mutableStateOf(initialService?.name ?: "") }
    var duration by rememberSaveable(initialService?.id) { mutableStateOf((initialService?.durationMinutes ?: 30).toString()) }
    var price by rememberSaveable(initialService?.id) {
        mutableStateOf(
            initialService?.price?.let { value ->
                if (value % 1.0 == 0.0) value.toLong().toString() else value.toString()
            } ?: "9000"
        )
    }
    var status by rememberSaveable(initialService?.id) { mutableStateOf(initialService?.status ?: "Pausado") }
    var photoUrl by rememberSaveable(initialService?.id) { mutableStateOf(initialService?.photoUrl) }
    var selectedPhotoUri by rememberSaveable(initialService?.id) { mutableStateOf<String?>(null) }
    val parsedDuration = duration.toIntOrNull()
    val normalizedPrice = price.replace(',', '.')
    val parsedPrice = normalizedPrice.toDoubleOrNull()
    val canActivate = !initialService?.workingHours.isNullOrEmpty()
    val validFields = name.trim().length in 2..80 && parsedDuration != null && parsedDuration in 10..1440 &&
        parsedPrice != null && parsedPrice.isFinite() && parsedPrice > 0 && parsedPrice <= 10_000_000 &&
        normalizedPrice.matches(Regex("\\d+(?:\\.\\d{1,2})?"))
    // Keep the draft local. Uploading during selection leaves orphan objects on
    // Cancel and delivers a late callback to a disposed composition on rotation.
    val photoContext = LocalContext.current
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { photoContext.retainDraftPhoto(it); selectedPhotoUri = it.toString() }
    }

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = CobaltPrimary,
        unfocusedBorderColor = BorderSubtle,
        focusedTextColor = TextHighEmphasis,
        unfocusedTextColor = TextHighEmphasis,
        focusedLabelColor = CobaltPrimary,
        unfocusedLabelColor = TextMediumEmphasis,
        cursorColor = CobaltPrimary
    )

    AlertDialog(
        onDismissRequest = { if (!isSubmitting) onDismiss() },
        containerColor = SurfaceLevel1,
        shape = RoundedCornerShape(20.dp),
        title = {
            Text(
                text = if (initialService == null) "Nuevo Servicio" else "Editar Servicio",
                fontWeight = FontWeight.Bold,
                fontSize = 19.sp,
                color = TextHighEmphasis
            )
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
                            .padding(10.dp)
                    ) {
                        Text(text = errorMessage, color = CrimsonCancelled, fontSize = 12.sp)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }

                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Nombre del servicio") },
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth().testTag(WorkspaceTestTags.SERVICE_NAME)
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = duration,
                    onValueChange = { duration = it.filter { ch -> ch.isDigit() } },
                    label = { Text("Duración en minutos (10 a 1440)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth().testTag(WorkspaceTestTags.SERVICE_DURATION)
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = price,
                    onValueChange = { input ->
                        val sanitized = input.filter { ch -> ch.isDigit() || ch == ',' || ch == '.' }
                        if (sanitized.count { it == ',' || it == '.' } <= 1) price = sanitized
                    },
                    label = { Text("Precio (ARS; admite centavos)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth().testTag(WorkspaceTestTags.SERVICE_PRICE)
                )
                Spacer(modifier = Modifier.height(10.dp))
                if (selectedPhotoUri != null || !photoUrl.isNullOrBlank()) {
                    AsyncImage(model = selectedPhotoUri ?: photoUrl, contentDescription = "Foto del servicio", modifier = Modifier.size(72.dp))
                }
                OutlinedButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !isSubmitting) {
                    Text(if (photoUrl == null) "Agregar foto" else "Cambiar foto", color = CobaltPrimary)
                }
                Spacer(modifier = Modifier.height(10.dp))
                Row(modifier = Modifier.selectableGroup(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("Activo", "Pausado").forEach { option ->
                        val selected = status.equals(option, ignoreCase = true)
                        Box(
                            modifier = Modifier
                                .clip(RoundedCornerShape(8.dp))
                                .background(if (selected) CobaltPrimary else SlateDeep)
                                .border(1.dp, if (selected) CobaltPrimary else BorderHairline, RoundedCornerShape(8.dp))
                                .selectable(selected = selected, enabled = !isSubmitting && (option != "Activo" || canActivate), role = Role.RadioButton) { status = option }
                                .heightIn(min = 48.dp)
                                .padding(horizontal = 14.dp, vertical = 8.dp)
                        ) {
                            Text(
                                text = option,
                                fontSize = 12.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = if (selected) OnMintPrimary else TextMediumEmphasis
                            )
                        }
                    }
                }
                if (!canActivate) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Guardá el servicio en pausa. Después configurá sus horarios para habilitar reservas.", color = TextMediumEmphasis, fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    if (validFields) {
                        val draftName = name.trim()
                        val draftDuration = requireNotNull(parsedDuration)
                        val draftPrice = requireNotNull(parsedPrice)
                        val draftStatus = status
                        val selected = selectedPhotoUri
                        if (selected == null) onConfirm(draftName, draftDuration, draftPrice, draftStatus, photoUrl)
                        else onUploadImage(Uri.parse(selected)) { uploaded ->
                            onConfirm(draftName, draftDuration, draftPrice, draftStatus, uploaded)
                        }
                    }
                },
                enabled = !isSubmitting && validFields,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MintPrimary,
                    contentColor = OnMintPrimary
                ),
                shape = RoundedCornerShape(9999.dp),
                modifier = Modifier.testTag(WorkspaceTestTags.SERVICE_SAVE)
            ) {
                Text("Guardar", fontWeight = FontWeight.Bold, color = OnMintPrimary)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !isSubmitting) {
                Text("Cancelar", color = TextMediumEmphasis)
            }
        }
    )
}

@Composable
fun CreateClientDialog(
    isSubmitting: Boolean,
    errorMessage: String?,
    onDismiss: () -> Unit,
    onUploadAvatar: (Uri, (String) -> Unit) -> Unit,
    onConfirm: (name: String, phone: String, email: String, notes: String, avatarUrl: String?) -> Unit
) {
    var name by rememberSaveable { mutableStateOf("") }
    var phone by rememberSaveable { mutableStateOf("") }
    var email by rememberSaveable { mutableStateOf("") }
    var avatarUrl by rememberSaveable { mutableStateOf<String?>(null) }
    var selectedAvatarUri by rememberSaveable { mutableStateOf<String?>(null) }
    val photoContext = LocalContext.current
    val avatarPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { photoContext.retainDraftPhoto(it); selectedAvatarUri = it.toString() }
    }

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = CobaltPrimary,
        unfocusedBorderColor = BorderSubtle,
        focusedTextColor = TextHighEmphasis,
        unfocusedTextColor = TextHighEmphasis,
        focusedLabelColor = CobaltPrimary,
        unfocusedLabelColor = TextMediumEmphasis,
        cursorColor = CobaltPrimary
    )

    AlertDialog(
        onDismissRequest = { if (!isSubmitting) onDismiss() },
        containerColor = SurfaceLevel1,
        shape = RoundedCornerShape(20.dp),
        title = {
            Text(
                text = "Registrar Cliente",
                fontWeight = FontWeight.Bold,
                fontSize = 19.sp,
                color = TextHighEmphasis
            )
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
                            .padding(10.dp)
                    ) {
                        Text(text = errorMessage, color = CrimsonCancelled, fontSize = 12.sp)
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }
                OutlinedTextField(
                    value = name,
                    onValueChange = { name = it },
                    label = { Text("Nombre completo") },
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth().testTag(WorkspaceTestTags.CLIENT_NAME)
                )
                Spacer(modifier = Modifier.height(8.dp))
                if (selectedAvatarUri != null || !avatarUrl.isNullOrBlank()) {
                    AsyncImage(model = selectedAvatarUri ?: avatarUrl, contentDescription = "Foto del cliente", modifier = Modifier.size(72.dp))
                }
                OutlinedButton(
                    onClick = {
                        avatarPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    },
                    enabled = !isSubmitting,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(if (avatarUrl == null) "Agregar foto del cliente" else "Cambiar foto del cliente", color = CobaltPrimary)
                }
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = phone,
                    onValueChange = { phone = it },
                    label = { Text("Teléfono / WhatsApp") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth().testTag(WorkspaceTestTags.CLIENT_PHONE)
                )
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = email,
                    onValueChange = { email = it },
                    label = { Text("Correo electrónico (opcional)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                    singleLine = true,
                    colors = fieldColors,
                    modifier = Modifier.fillMaxWidth().testTag(WorkspaceTestTags.CLIENT_EMAIL)
                )
            }
        },
        confirmButton = {
            Button(
                onClick = {
                    val draftName = name
                    val draftPhone = phone
                    val draftEmail = email
                    val selected = selectedAvatarUri
                    if (selected == null) onConfirm(draftName, draftPhone, draftEmail, "", avatarUrl)
                    else onUploadAvatar(Uri.parse(selected)) { uploaded ->
                        onConfirm(draftName, draftPhone, draftEmail, "", uploaded)
                    }
                },
                enabled = !isSubmitting && name.isNotBlank() && phone.isNotBlank(),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MintPrimary,
                    contentColor = OnMintPrimary
                ),
                shape = RoundedCornerShape(9999.dp),
                modifier = Modifier.testTag(WorkspaceTestTags.CLIENT_SAVE)
            ) {
                Text("Registrar", fontWeight = FontWeight.Bold, color = OnMintPrimary)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss, enabled = !isSubmitting) {
                Text("Cancelar", color = TextMediumEmphasis)
            }
        }
    )
}

@Composable
fun AccountDeletionDialog(
    isSubmitting: Boolean,
    onDismiss: () -> Unit,
    onConfirm: (reason: String) -> Unit
) {
    val context = LocalContext.current
    var reason by rememberSaveable { mutableStateOf("Cierre temporal o baja voluntaria del servicio") }

    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = SurfaceLevel1,
        shape = RoundedCornerShape(20.dp),
        title = {
            Text(
                text = "Eliminación de Cuenta y Datos",
                fontWeight = FontWeight.Bold,
                fontSize = 18.sp,
                color = CrimsonCancelled
            )
        },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .imePadding()
                    .verticalScroll(rememberScrollState())
            ) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(AmberContainer)
                        .border(1.dp, AmberPending.copy(alpha = 0.3f), RoundedCornerShape(10.dp))
                        .padding(10.dp)
                ) {
                    Text(
                        text = "Importante (Google Play Policy): La baja de tu cuenta de Pediturno desactiva tu agenda pública y anonimiza datos operativos, pero NO cancela automáticamente suscripciones activas en Google Play Store ni elimina comprobantes contables sujetos a retención legal (FINANCIAL_RETENTION_REQUIRED).",
                        fontSize = 11.sp,
                        color = AmberPending
                    )
                }

                Spacer(modifier = Modifier.height(10.dp))

                OutlinedButton(
                    onClick = {
                        runCatching {
                            context.startActivity(
                                Intent(
                                    Intent.ACTION_VIEW,
                                    Uri.parse("https://play.google.com/store/account/subscriptions")
                                )
                            )
                        }
                    },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("Abrir Suscripciones de Google Play", color = CobaltPrimary, fontSize = 12.sp)
                }

                Spacer(modifier = Modifier.height(10.dp))

                OutlinedTextField(
                    value = reason,
                    onValueChange = { reason = it },
                    label = { Text("Motivo de la solicitud") },
                    modifier = Modifier.fillMaxWidth(),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = CrimsonCancelled,
                        unfocusedBorderColor = BorderSubtle,
                        focusedTextColor = TextHighEmphasis,
                        unfocusedTextColor = TextHighEmphasis
                    )
                )
            }
        },
        confirmButton = {
            Button(
                onClick = { onConfirm(reason) },
                enabled = !isSubmitting && reason.isNotBlank(),
                colors = ButtonDefaults.buttonColors(containerColor = CrimsonCancelled),
                shape = RoundedCornerShape(9999.dp)
            ) {
                Text("Confirmar Solicitud de Baja", color = Color.Black, fontWeight = FontWeight.Bold, fontSize = 12.sp)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancelar", color = TextMediumEmphasis)
            }
        }
    )
}
