package com.pediturno.servicios.ui.agenda

import coil3.compose.AsyncImage
import androidx.compose.ui.layout.ContentScale
import android.content.Intent
import android.net.Uri
import androidx.core.net.toUri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Phone
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
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
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.R
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.BorderSubtle
import com.pediturno.servicios.core.theme.CrimsonCancelled
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.OnMintPrimary
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import com.pediturno.servicios.data.model.ClientItem
import com.pediturno.servicios.ui.components.WhatsAppGreen

object ClientDetailTestTags {
    const val EDIT = "client_detail_edit"
    const val NAME = "client_detail_name"
    const val PHONE = "client_detail_phone"
    const val EMAIL = "client_detail_email"
    const val SAVE = "client_detail_save"
    const val DELETE_REQUEST = "client_detail_delete_request"
    const val DELETE_CONFIRM = "client_detail_delete_confirm"
    const val DELETE_CANCEL = "client_detail_delete_cancel"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ClientDetailDialog(
    client: ClientItem,
    history: ClientHistoryUiState,
    onLoadHistory: (String) -> Unit,
    onUpdateClient: (ClientItem) -> Unit,
    onUploadAvatar: (Uri, (String) -> Unit) -> Unit,
    onDeleteClient: (ClientItem) -> Unit,
    onBookAppointmentForClient: (ClientItem) -> Unit,
    onDismiss: () -> Unit,
    isSubmitting: Boolean = false,
    errorMessage: String? = null
) {
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val windowSize = LocalWindowInfo.current.containerSize
    val maxDialogHeight = with(LocalDensity.current) { (windowSize.height.toDp() * 0.85f).coerceAtLeast(320.dp) }
    val hasMatchingHistory = history.clientId == client.id
    LaunchedEffect(client.id) { onLoadHistory(client.id) }
    var historyVisibleCount by rememberSaveable(client.id) { mutableStateOf(8) }
    var isEditing by rememberSaveable(client.id) { mutableStateOf(false) }
    var confirmDelete by rememberSaveable(client.id) { mutableStateOf(false) }

    var name by rememberSaveable(client.id) { mutableStateOf(client.name) }
    var phone by rememberSaveable(client.id) { mutableStateOf(client.phone) }
    var email by rememberSaveable(client.id) { mutableStateOf(client.email) }
    var avatarUrl by rememberSaveable(client.id) { mutableStateOf(client.avatarUrl) }
    var selectedAvatarUri by rememberSaveable(client.id) { mutableStateOf<String?>(null) }
    val avatarPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { context.retainDraftPhoto(it); selectedAvatarUri = it.toString() }
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

    BasicAlertDialog(onDismissRequest = { if (!isSubmitting) onDismiss() }) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(24.dp))
                .background(SurfaceLevel1)
                .border(1.dp, BorderHairline, RoundedCornerShape(24.dp))
                .heightIn(max = maxDialogHeight)
                .imePadding()
                .padding(20.dp)
        ) {
            Column {
                Column(modifier = Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
                    // Cabecera con Avatar e Información
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Box(
                            modifier = Modifier
                                .size(54.dp)
                                .clip(CircleShape)
                                .background(SurfaceLevel2)
                                .border(1.5.dp, MintPrimary, CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = client.name.take(2).uppercase(),
                                fontSize = 20.sp,
                                fontWeight = FontWeight.Bold,
                                color = MintPrimary
                            )
                            val displayedAvatar = if (isEditing) avatarUrl else client.avatarUrl
                            if (!displayedAvatar.isNullOrBlank()) {
                                AsyncImage(model = displayedAvatar, contentDescription = "Foto de ${client.name}", contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize().clip(CircleShape))
                            }
                        }

                        Spacer(modifier = Modifier.width(14.dp))

                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = client.name,
                                fontSize = 18.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextHighEmphasis
                            )
                        }

                        IconButton(
                            onClick = { isEditing = !isEditing },
                            modifier = Modifier
                                .size(48.dp)
                                .testTag(ClientDetailTestTags.EDIT)
                                .background(SurfaceLevel2, CircleShape)
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Edit,
                                contentDescription = "Editar",
                                tint = if (isEditing) MintPrimary else TextMediumEmphasis,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(16.dp))

                    if (!isEditing) {
                        // Vista de lectura y acciones rápidas
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(14.dp))
                                .background(SurfaceLevel2)
                                .border(1.dp, BorderHairline, RoundedCornerShape(14.dp))
                                .padding(14.dp)
                        ) {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Icon(Icons.Outlined.Phone, contentDescription = null, tint = MintPrimary, modifier = Modifier.size(15.dp))
                                    Spacer(modifier = Modifier.width(8.dp))
                                    Text(
                                        text = client.phone,
                                        fontSize = 13.sp,
                                        fontWeight = FontWeight.SemiBold,
                                        color = TextHighEmphasis
                                    )
                                }
                                if (client.email.isNotBlank()) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Icon(Icons.Outlined.Mail, contentDescription = null, tint = TextMediumEmphasis, modifier = Modifier.size(15.dp))
                                        Spacer(modifier = Modifier.width(8.dp))
                                        Text(
                                            text = client.email,
                                            fontSize = 13.sp,
                                            color = TextMediumEmphasis
                                        )
                                    }
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        Text(
                            text = "HISTORIAL DE TURNOS",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextSubtle
                        )
                        when {
                            history.isLoading || !hasMatchingHistory -> Text(
                                "Cargando historial…", fontSize = 12.sp, color = TextMediumEmphasis
                            )
                            history.error != null -> Column {
                                Text(history.error, fontSize = 12.sp, color = TextMediumEmphasis)
                                TextButton(onClick = { onLoadHistory(client.id) }) { Text("Reintentar historial") }
                            }
                            history.appointments.isEmpty() -> Text(
                                "Todavía no hay turnos registrados para este cliente.", fontSize = 12.sp, color = TextMediumEmphasis
                            )
                            else -> Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                history.appointments.take(historyVisibleCount).forEach { appointment ->
                                    Text(
                                        text = "${appointment.dateKey} · ${appointment.time} · ${appointment.service} (${appointment.status.label})",
                                        fontSize = 12.sp,
                                        color = TextMediumEmphasis
                                    )
                                }
                            }
                        }

                        if (hasMatchingHistory && history.error == null && historyVisibleCount < history.appointments.size) {
                            TextButton(onClick = { historyVisibleCount += 20 }) {
                                Text("Ver más turnos ($historyVisibleCount/${history.appointments.size})")
                            }
                        }

                        Spacer(modifier = Modifier.height(16.dp))

                        // Botones directos de contacto con WhatsApp oficial
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedButton(
                                onClick = {
                                    val clean = client.phone.filter { it.isDigit() }
                                    haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                    val intent = Intent(Intent.ACTION_VIEW, "https://wa.me/$clean".toUri())
                                    runCatching { context.startActivity(intent) }
                                },
                                modifier = Modifier.weight(1.3f).heightIn(min = 48.dp),
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 6.dp, vertical = 8.dp),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Image(
                                    painter = painterResource(id = R.drawable.ic_whatsapp),
                                    contentDescription = null,
                                    modifier = Modifier.size(16.dp)
                                )
                                Spacer(modifier = Modifier.width(5.dp))
                                Text("WhatsApp", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = WhatsAppGreen, maxLines = 1)
                            }

                            OutlinedButton(
                                onClick = {
                                    haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                    val intent = Intent(Intent.ACTION_DIAL, "tel:${client.phone}".toUri())
                                    runCatching { context.startActivity(intent) }
                                },
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                                contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 4.dp, vertical = 8.dp),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Icon(Icons.Outlined.Call, contentDescription = null, modifier = Modifier.size(15.dp), tint = MintPrimary)
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Llamar", fontSize = 11.sp, color = MintPrimary, maxLines = 1)
                            }

                            if (client.email.isNotBlank()) {
                                OutlinedButton(
                                    onClick = {
                                        haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                                        val intent = Intent(Intent.ACTION_SENDTO, "mailto:${client.email}".toUri())
                                        runCatching { context.startActivity(intent) }
                                    },
                                    modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                                    contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = 4.dp, vertical = 8.dp),
                                    shape = RoundedCornerShape(12.dp)
                                ) {
                                    Icon(Icons.Outlined.Mail, contentDescription = null, modifier = Modifier.size(15.dp), tint = MintPrimary)
                                    Spacer(modifier = Modifier.width(4.dp))
                                    Text("Correo", fontSize = 11.sp, color = MintPrimary, maxLines = 1)
                                }
                            }
                        }

                        Spacer(modifier = Modifier.height(14.dp))

                        Button(
                            onClick = {
                                onDismiss()
                                onBookAppointmentForClient(client)
                            },
                            modifier = Modifier
                                .fillMaxWidth()
                                .heightIn(min = 48.dp),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MintPrimary,
                                contentColor = OnMintPrimary
                            )
                        ) {
                            Icon(Icons.Outlined.CalendarToday, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Agendar Turno para ${client.name.split(" ").firstOrNull() ?: ""}", fontSize = 13.sp, fontWeight = FontWeight.Bold)
                        }
                        TextButton(
                            onClick = { confirmDelete = true },
                            modifier = Modifier
                                .align(Alignment.CenterHorizontally)
                                .testTag(ClientDetailTestTags.DELETE_REQUEST)
                        ) {
                            Icon(Icons.Outlined.DeleteOutline, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(4.dp))
                            Text("Eliminar cliente")
                        }
                    } else {
                        // Modo edición
                        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            OutlinedTextField(
                                value = name,
                                onValueChange = { name = it },
                                label = { Text("Nombre Completo") },
                                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                                colors = fieldColors,
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth().testTag(ClientDetailTestTags.NAME)
                            )
                            OutlinedButton(
                                onClick = {
                                    avatarPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                                },
                                enabled = !isSubmitting,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(if (avatarUrl.isNullOrBlank()) "Agregar foto" else "Cambiar foto", color = MintPrimary)
                            }
                            if (selectedAvatarUri != null) {
                                AsyncImage(model = selectedAvatarUri, contentDescription = "Foto seleccionada del cliente", modifier = Modifier.size(72.dp))
                            }
                            OutlinedTextField(
                                value = phone,
                                onValueChange = { phone = it },
                                label = { Text("Teléfono") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone, imeAction = ImeAction.Next),
                                colors = fieldColors,
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth().testTag(ClientDetailTestTags.PHONE)
                            )
                            OutlinedTextField(
                                value = email,
                                onValueChange = { email = it },
                                label = { Text("Correo electrónico (opcional)") },
                                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Done),
                                colors = fieldColors,
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth().testTag(ClientDetailTestTags.EMAIL)
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                        }
                    }

                    Spacer(modifier = Modifier.height(10.dp))

                    if (!isEditing) {
                        Box(
                            modifier = Modifier.fillMaxWidth(),
                            contentAlignment = Alignment.Center
                        ) {
                            TextButton(onClick = onDismiss) {
                                Text("Cerrar", color = TextSubtle, fontSize = 12.sp)
                            }
                        }
                    }
                }

                if (isEditing) {
                    if (errorMessage != null) {
                        Text(
                            text = errorMessage,
                            color = CrimsonCancelled,
                            fontSize = 12.sp,
                            modifier = Modifier.padding(bottom = 8.dp)
                        )
                    }
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(10.dp)
                    ) {
                        OutlinedButton(
                            onClick = {
                                name = client.name
                                phone = client.phone
                                email = client.email
                                avatarUrl = client.avatarUrl
                                selectedAvatarUri = null
                                isEditing = false
                            },
                            enabled = !isSubmitting,
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Text("Cancelar", color = TextMediumEmphasis, fontSize = 13.sp)
                        }

                        Button(
                            onClick = {
                                val draft = client.copy(
                                        name = name.trim(),
                                        phone = phone.trim(),
                                        email = email.trim(),
                                        avatarUrl = avatarUrl
                                    )
                                val selected = selectedAvatarUri
                                if (selected == null) onUpdateClient(draft)
                                else onUploadAvatar(Uri.parse(selected)) { uploaded ->
                                    onUpdateClient(draft.copy(avatarUrl = uploaded))
                                }
                            },
                            enabled = !isSubmitting && name.trim().isNotBlank() && phone.trim().isNotBlank(),
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag(ClientDetailTestTags.SAVE),
                            shape = RoundedCornerShape(12.dp),
                            colors = ButtonDefaults.buttonColors(
                                containerColor = MintPrimary,
                                contentColor = OnMintPrimary
                            )
                        ) {
                            if (isSubmitting) {
                                CircularProgressIndicator(
                                    color = OnMintPrimary,
                                    modifier = Modifier.size(18.dp)
                                )
                            } else {
                                Text("Guardar", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                            }
                        }
                    }
                }
            }
        }
    }

    if (confirmDelete) {
        AlertDialog(
            onDismissRequest = { confirmDelete = false },
            title = { Text("¿Eliminar cliente?") },
            text = { Text("Se eliminará el perfil de ${client.name}. Esta acción no se puede deshacer desde la app.") },
            confirmButton = {
                Button(
                    onClick = { confirmDelete = false; onDeleteClient(client) },
                    modifier = Modifier.testTag(ClientDetailTestTags.DELETE_CONFIRM)
                ) { Text("Eliminar") }
            },
            dismissButton = {
                TextButton(
                    onClick = { confirmDelete = false },
                    modifier = Modifier.testTag(ClientDetailTestTags.DELETE_CANCEL)
                ) { Text("Cancelar") }
            }
        )
    }
}
