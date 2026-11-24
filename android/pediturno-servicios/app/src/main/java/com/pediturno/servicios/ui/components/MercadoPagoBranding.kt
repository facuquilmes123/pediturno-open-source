package com.pediturno.servicios.ui.components

import android.content.Intent
import android.net.Uri
import androidx.core.net.toUri
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.sizeIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.R
import com.pediturno.servicios.core.theme.AmberPending
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import java.text.NumberFormat
import java.util.Locale

// Paleta oficial de marca Mercado Pago
val MercadoPagoBlue = Color(0xFF009EE3)
val MercadoPagoBlueDark = Color(0xFF0082BD)
val MercadoPagoBlueLight = Color(0xFF00B1EA)
val MercadoPagoContainer = Color(0x1F009EE3)
val MercadoPagoBorder = Color(0x52009EE3)

// Paleta oficial WhatsApp
val WhatsAppGreen = Color(0xFF25D366)
val WhatsAppContainer = Color(0x1F25D366)

/**
 * Insignia / Logo Oficial de Mercado Pago con relación de aspecto preservada
 */
@Composable
fun MercadoPagoOfficialBadge(
    modifier: Modifier = Modifier,
    height: Dp = 24.dp
) {
    Box(
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(Color.White)
            .padding(horizontal = 6.dp, vertical = 2.dp),
        contentAlignment = Alignment.Center
    ) {
        Image(
            painter = painterResource(id = R.drawable.mpago),
            contentDescription = "Mercado Pago",
            contentScale = ContentScale.Fit,
            modifier = Modifier.height(height)
        )
    }
}

/**
 * Pill semántico de seña para listas y fichas de turnos
 */
@Composable
fun MercadoPagoDepositPill(
    depositAmount: Double,
    isPaid: Boolean,
    modifier: Modifier = Modifier,
    requiresReview: Boolean = false,
    isExpired: Boolean = false
) {
    val currencyFormat = remember {
        NumberFormat.getCurrencyInstance(Locale.forLanguageTag("es-AR")).apply {
            maximumFractionDigits = 2
        }
    }

    val backgroundColor = if (isPaid) MercadoPagoContainer else AmberPending.copy(alpha = 0.15f)
    val borderColor = if (isPaid) MercadoPagoBorder else AmberPending.copy(alpha = 0.4f)
    val textColor = if (isPaid) MercadoPagoBlueLight else AmberPending

    Row(
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(backgroundColor)
            .border(1.dp, borderColor, RoundedCornerShape(8.dp))
            .padding(horizontal = 7.dp, vertical = 3.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (isPaid) {
            Box(
                modifier = Modifier
                    .size(14.dp)
                    .clip(CircleShape)
                    .background(MercadoPagoBlue),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    imageVector = Icons.Outlined.Check,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(10.dp)
                )
            }
        } else {
            Box(
                modifier = Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(AmberPending)
            )
        }

        Spacer(modifier = Modifier.width(5.dp))

        Text(
            text = if (requiresReview) {
                "Seña ${currencyFormat.format(depositAmount)} a revisar"
            } else if (isExpired) {
                "Seña ${currencyFormat.format(depositAmount)} vencida"
            } else if (isPaid) {
                "Seña MP ${currencyFormat.format(depositAmount)} paga"
            } else {
                "Seña ${currencyFormat.format(depositAmount)} pendiente"
            },
            style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
            fontSize = 11.sp,
            fontWeight = FontWeight.Bold,
            color = textColor
        )
    }
}

/**
 * Botón interactivo de WhatsApp con hit-box accesible de 48dp y marca oficial
 */
@Composable
fun WhatsAppActionIconButton(
    phoneNumber: String,
    modifier: Modifier = Modifier,
    onError: (String) -> Unit = {}
) {
    val context = LocalContext.current
    val cleanPhone = remember(phoneNumber) { phoneNumber.filter { it.isDigit() } }

    Box(
        modifier = modifier
            .sizeIn(minWidth = 48.dp, minHeight = 48.dp)
            .clickable {
                val uri = "https://wa.me/$cleanPhone".toUri()
                runCatching {
                    context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                }.onFailure {
                    onError("No se pudo abrir WhatsApp para $cleanPhone")
                }
            },
        contentAlignment = Alignment.Center
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(WhatsAppContainer)
                .border(1.dp, WhatsAppGreen.copy(alpha = 0.4f), CircleShape),
            contentAlignment = Alignment.Center
        ) {
            Image(
                painter = painterResource(id = R.drawable.ic_whatsapp),
                contentDescription = "Enviar WhatsApp",
                contentScale = ContentScale.Fit,
                modifier = Modifier.size(20.dp)
            )
        }
    }
}

/**
 * Tarjeta de presentación y control de Mercado Pago en la sección 'Mi Negocio'
 */
@Composable
fun MercadoPagoSettingsDashboardCard(
    connected: Boolean,
    depositsEnabled: Boolean,
    canConfigureDeposits: Boolean,
    requireDeposit: Boolean,
    depositValue: Double,
    depositType: String,
    isLoading: Boolean,
    error: String?,
    onConfigureClick: () -> Unit,
    onSaveSettings: (requireDeposit: Boolean, depositType: String, depositValue: Double) -> Unit,
    onDisconnectClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    var showSettings by remember { mutableStateOf(false) }
    var confirmDisconnect by remember { mutableStateOf(false) }
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(18.dp))
            .background(SurfaceLevel1)
            .border(
                1.dp,
                if (connected) MercadoPagoBorder else BorderHairline,
                RoundedCornerShape(18.dp)
            )
            .padding(16.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            // Fila superior con Logo Oficial y Estado
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MercadoPagoOfficialBadge(height = 22.dp)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "COBRO DE SEÑAS",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = MercadoPagoBlueLight,
                        letterSpacing = 0.05.sp
                    )
                }

                Box(
                    modifier = Modifier
                        .clip(RoundedCornerShape(9999.dp))
                        .background(if (connected) MercadoPagoContainer else SurfaceLevel2)
                        .border(
                            1.dp,
                            if (connected) MercadoPagoBorder else BorderHairline,
                            RoundedCornerShape(9999.dp)
                        )
                        .padding(horizontal = 8.dp, vertical = 3.dp)
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            modifier = Modifier
                                .size(6.dp)
                                .clip(CircleShape)
                                .background(if (connected) EmeraldConfirmed else AmberPending)
                        )
                        Spacer(modifier = Modifier.width(5.dp))
                        Text(
                            text = if (connected) "Vinculado" else "No configurado",
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (connected) EmeraldConfirmed else TextSubtle
                        )
                    }
                }
            }

            Text(
                text = if (!depositsEnabled) {
                    "Las nuevas reservas se realizan sin seña. El historial de pagos existentes se conserva y podés desvincular esta cuenta."
                } else if (connected && requireDeposit) {
                    val valueFormatted = if (depositType == "percentage") "${depositValue}%" else NumberFormat.getCurrencyInstance(Locale.forLanguageTag("es-AR")).format(depositValue)
                    "Seña configurada: el cliente verá $valueFormatted al reservar. El pago se verifica antes de confirmar la reserva."
                } else if (connected) {
                    "Cuenta vinculada. Podés configurar señas para las reservas en línea."
                } else {
                    "Vinculá una cuenta de Mercado Pago para recibir señas. Podrás activarlas cuando se complete la conexión."
                },
                fontSize = 12.sp,
                color = TextMediumEmphasis,
                lineHeight = 16.sp
            )

            if (error != null) {
                Text(error, fontSize = 11.sp, color = TextSubtle)
            }

            // El estado real de la seña se confirma en el servidor, no en esta UI.
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Outlined.Shield,
                    contentDescription = null,
                    tint = MercadoPagoBlue,
                    modifier = Modifier.size(13.dp)
                )
                Spacer(modifier = Modifier.width(5.dp))
                Text(
                    text = "Cobros en pesos argentinos (ARS · Argentina/MLA)",
                    fontSize = 10.sp,
                    color = TextSubtle,
                    fontWeight = FontWeight.Medium
                )
            }

            Spacer(modifier = Modifier.height(2.dp))

            Button(
                onClick = {
                    if (connected && canConfigureDeposits) showSettings = true else onConfigureClick()
                },
                enabled = !isLoading && depositsEnabled,
                colors = ButtonDefaults.buttonColors(
                    containerColor = if (connected) MercadoPagoBlue else SurfaceLevel2,
                    contentColor = if (connected) Color.White else TextHighEmphasis
                ),
                shape = RoundedCornerShape(10.dp),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(40.dp)
            ) {
                Icon(
                    imageVector = Icons.Outlined.Payments,
                    contentDescription = null,
                    modifier = Modifier.size(15.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = if (connected && canConfigureDeposits) "Gestionar señas" else if (connected) "Sincronizar estado" else "Vincular Cuenta de Mercado Pago",
                    fontSize = 12.sp,
                    fontWeight = FontWeight.Bold
                )
                Spacer(modifier = Modifier.weight(1f))
                Icon(
                    imageVector = Icons.AutoMirrored.Outlined.ArrowForward,
                    contentDescription = null,
                    modifier = Modifier.size(14.dp)
                )
            }
        }
    }

    if (showSettings) {
        MercadoPagoDepositSettingsDialog(
            initialRequireDeposit = requireDeposit,
            initialDepositType = depositType,
            initialDepositValue = depositValue,
            isSaving = isLoading,
            onSave = { enabled, type, value -> onSaveSettings(enabled, type, value) },
            onDisconnect = { confirmDisconnect = true },
            onDismiss = { showSettings = false }
        )
    }
    if (confirmDisconnect) {
        AlertDialog(
            onDismissRequest = { confirmDisconnect = false },
            title = { Text("¿Desvincular Mercado Pago?") },
            text = { Text("Las nuevas reservas no solicitarán seña hasta volver a vincular una cuenta.") },
            confirmButton = {
                Button(onClick = { confirmDisconnect = false; showSettings = false; onDisconnectClick() }) { Text("Desvincular") }
            },
            dismissButton = { TextButton(onClick = { confirmDisconnect = false }) { Text("Cancelar") } }
        )
    }
}

@Composable
private fun MercadoPagoDepositSettingsDialog(
    initialRequireDeposit: Boolean,
    initialDepositType: String,
    initialDepositValue: Double,
    isSaving: Boolean,
    onSave: (Boolean, String, Double) -> Unit,
    onDisconnect: () -> Unit,
    onDismiss: () -> Unit
) {
    var requireDeposit by remember(initialRequireDeposit) { mutableStateOf(initialRequireDeposit) }
    var depositType by remember(initialDepositType) { mutableStateOf(initialDepositType) }
    var depositValue by remember(initialDepositValue) { mutableStateOf(initialDepositValue.toString()) }
    val parsedValue = depositValue.replace(',', '.').toDoubleOrNull()

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Configurar señas") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Los cambios se aplicarán a las nuevas reservas.", fontSize = 12.sp, color = TextMediumEmphasis)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Solicitar seña", modifier = Modifier.weight(1f), color = TextHighEmphasis)
                    Switch(checked = requireDeposit, onCheckedChange = { requireDeposit = it })
                }
                TextButton(onClick = { depositType = "percentage" }) { Text(if (depositType == "percentage") "✓ Porcentaje" else "Porcentaje") }
                TextButton(onClick = { depositType = "fixed" }) { Text(if (depositType == "fixed") "✓ Monto fijo" else "Monto fijo") }
                OutlinedTextField(
                    value = depositValue,
                    onValueChange = { input ->
                        val normalized = input.filter { it.isDigit() || it == '.' || it == ',' }
                        if (normalized.count { it == '.' || it == ',' } <= 1) depositValue = normalized
                    },
                    label = { Text(if (depositType == "percentage") "Porcentaje" else "Monto en ARS") },
                    singleLine = true
                )
            }
        },
        confirmButton = {
            Button(
                enabled = !isSaving && parsedValue != null && parsedValue > 0.0,
                onClick = { onSave(requireDeposit, depositType, parsedValue ?: 0.0) }
            ) { Text("Guardar") }
        },
        dismissButton = {
            Row {
                TextButton(onClick = onDisconnect, enabled = !isSaving) { Text("Desvincular") }
                TextButton(onClick = onDismiss, enabled = !isSaving) { Text("Cancelar") }
            }
        }
    )
}
