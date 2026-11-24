package com.pediturno.servicios.ui.agenda

import android.app.Activity
import android.content.Intent
import android.net.Uri
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.BorderSubtle
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.EmeraldContainer
import com.pediturno.servicios.core.theme.MintContainer
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.ObsidianCanvas
import com.pediturno.servicios.core.theme.OnMintPrimary
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import com.pediturno.servicios.data.model.MembershipInfo

object SubscriptionTestTags {
    const val DIALOG = "dialog_subscription_plan"
    const val CLOSE_BUTTON = "btn_subscription_close"
    const val PURCHASE_BUTTON = "btn_subscription_purchase"
    const val RESTORE_BUTTON = "btn_subscription_restore"
    const val MANAGE_BUTTON = "btn_subscription_manage_play"
    const val REFRESH_BUTTON = "btn_subscription_refresh"
    const val QUOTA_PROGRESS = "indicator_subscription_quota"
}

@Composable
fun SubscriptionPlanDialog(
    membership: MembershipInfo,
    billing: BillingUiState,
    onDismiss: () -> Unit,
    onPurchase: (Activity) -> Unit,
    onRestore: () -> Unit,
    onRefresh: () -> Unit
) {
    val context = LocalContext.current
    val isPro = membership.isPro
    val monthlyQuota = membership.monthlyQuota ?: 40
    val currentUsage = membership.currentMonthUsage
    val remainingQuota = membership.remainingQuota
    val progressFraction = if (monthlyQuota > 0) (currentUsage.toFloat() / monthlyQuota.toFloat()).coerceIn(0f, 1f) else 1f

    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false)
    ) {
        Surface(
            modifier = Modifier
                .fillMaxWidth(0.95f)
                .clip(RoundedCornerShape(22.dp))
                .border(1.dp, BorderHairline, RoundedCornerShape(22.dp))
                .testTag(SubscriptionTestTags.DIALOG),
            color = ObsidianCanvas
        ) {
            Column(
                modifier = Modifier
                    .padding(20.dp)
                    .verticalScroll(rememberScrollState())
            ) {
                // Header Row
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Mi Plan y Suscripción",
                            fontSize = 19.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextHighEmphasis
                        )
                        Spacer(modifier = Modifier.height(2.dp))
                        Text(
                            text = "Gestión de turnos y capacidad mensual",
                            fontSize = 12.sp,
                            color = TextMediumEmphasis
                        )
                    }
                    IconButton(
                        onClick = onDismiss,
                        modifier = Modifier
                            .size(48.dp)
                            .testTag(SubscriptionTestTags.CLOSE_BUTTON)
                    ) {
                        Icon(
                            imageVector = Icons.Default.Close,
                            contentDescription = "Cerrar",
                            tint = TextMediumEmphasis
                        )
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Current Plan Card
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(SurfaceLevel1)
                        .border(1.dp, if (isPro) EmeraldConfirmed.copy(alpha = 0.3f) else BorderHairline, RoundedCornerShape(16.dp))
                        .padding(16.dp)
                ) {
                    Column {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.SpaceBetween,
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            Row(
                                modifier = Modifier.weight(1f),
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Box(
                                    modifier = Modifier
                                        .size(34.dp)
                                        .clip(CircleShape)
                                        .background(if (isPro) EmeraldContainer else MintContainer),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Icon(
                                        imageVector = Icons.Default.Star,
                                        contentDescription = null,
                                        tint = if (isPro) EmeraldConfirmed else MintPrimary,
                                        modifier = Modifier.size(18.dp)
                                    )
                                }
                                Spacer(modifier = Modifier.width(10.dp))
                                Column(modifier = Modifier.weight(1f)) {
                                    Text(
                                        text = if (isPro) "Plan Pro Activo" else "Plan Gratis Permanente",
                                        fontSize = 15.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = TextHighEmphasis
                                    )
                                    Text(
                                        text = if (isPro) "Turnos ilimitados" else "Hasta 40 turnos / mes",
                                        fontSize = 12.sp,
                                        color = if (isPro) EmeraldConfirmed else MintPrimary
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.width(8.dp))

                            // Provider tag
                            Box(
                                modifier = Modifier
                                    .clip(RoundedCornerShape(8.dp))
                                    .background(SurfaceLevel2)
                                    .padding(horizontal = 8.dp, vertical = 4.dp)
                            ) {
                                Text(
                                    text = when (membership.source.uppercase()) {
                                        "GOOGLE_PLAY" -> "Google Play"
                                        "MERCADO_PAGO" -> "Mercado Pago"
                                        "WEB_LEGACY" -> "Web"
                                        "LEGACY" -> "Membresía"
                                        else -> "Pediturno"
                                    },
                                    fontSize = 11.sp,
                                    fontWeight = FontWeight.Medium,
                                    color = TextMediumEmphasis
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(14.dp))

                        if (!isPro) {
                            // Free Plan: Monthly quota tracking meter
                            Text(
                                text = "Consumo del mes actual: $currentUsage de $monthlyQuota turnos",
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold,
                                color = TextHighEmphasis
                            )
                            Spacer(modifier = Modifier.height(6.dp))
                            LinearProgressIndicator(
                                progress = { progressFraction },
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(8.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .testTag(SubscriptionTestTags.QUOTA_PROGRESS),
                                color = if (progressFraction >= 0.9f) EmeraldConfirmed else MintPrimary,
                                trackColor = SurfaceLevel2
                            )
                            Spacer(modifier = Modifier.height(8.dp))
                            Text(
                                text = if (remainingQuota > 0) "Te quedan $remainingQuota turnos disponibles este mes." else "Alcanzaste el cupo mensual de 40 turnos. Pasate a Pro para seguir agendando.",
                                fontSize = 12.sp,
                                color = if (remainingQuota > 0) TextMediumEmphasis else EmeraldConfirmed
                            )
                        } else {
                            // Pro Plan: Details of subscription validity
                            if (membership.expiresAtIso.isNotBlank()) {
                                Text(
                                    text = "Vigencia: hasta ${membership.expiresAtIso.take(10)}",
                                    fontSize = 12.sp,
                                    color = TextMediumEmphasis
                                )
                            }
                            if (membership.autoRenewEnabled) {
                                Text(
                                    text = "Renovación automática mensual activa.",
                                    fontSize = 12.sp,
                                    color = EmeraldConfirmed
                                )
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Feature comparison table
                Text(
                    text = "Comparación de planes",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextHighEmphasis
                )
                Spacer(modifier = Modifier.height(8.dp))

                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(14.dp))
                        .background(SurfaceLevel1)
                        .border(1.dp, BorderHairline, RoundedCornerShape(14.dp))
                        .padding(14.dp)
                ) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        FeatureRow("Agenda completa y recordatorios", "Gratis: Sí", "Pro: Sí")
                        FeatureRow("Página pública de reservas online", "Gratis: Sí", "Pro: Sí")
                        FeatureRow("Clientes y servicios sin límite", "Gratis: Sí", "Pro: Sí")
                        FeatureRow("Sin anuncios ni cargos ocultos", "Gratis: Sí", "Pro: Sí")
                        FeatureRow(
                            feature = "Capacidad de turnos",
                            freeDetail = "40 / mes",
                            proDetail = "Ilimitado",
                            highlight = true
                        )
                    }
                }

                Spacer(modifier = Modifier.height(18.dp))

                // Billing / Purchase Action Card
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(16.dp))
                        .background(SurfaceLevel1)
                        .border(1.dp, BorderHairline, RoundedCornerShape(16.dp))
                        .padding(16.dp)
                ) {
                    Column {
                        Text(
                            text = if (isPro || billing.requiresExistingSubscriptionManagement) "Gestión de tu suscripción" else "Actualizá a Pediturno Pro",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextHighEmphasis
                        )
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = billing.recoveryMessage ?: if (isPro) {
                                "Tu suscripción Pro está activa y vinculada a tu cuenta. Compartís el acceso en Android y web."
                            } else {
                                "Eliminá el límite de 40 turnos mensuales contratando Pro con Google Play."
                            },
                            fontSize = 12.sp,
                            color = TextMediumEmphasis
                        )

                        Spacer(modifier = Modifier.height(10.dp))

                        if (billing.isLoading) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                modifier = Modifier.padding(vertical = 12.dp)
                            ) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(20.dp),
                                    color = MintPrimary,
                                    strokeWidth = 2.dp
                                )
                                Spacer(modifier = Modifier.width(10.dp))
                                Text(
                                    text = "Consultando Google Play…",
                                    fontSize = 12.sp,
                                    color = TextMediumEmphasis
                                )
                            }
                        } else if (billing.formattedPrice != null && !isPro && !billing.requiresExistingSubscriptionManagement) {
                            // Honest Play Store localized price
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(12.dp))
                                    .background(SurfaceLevel2)
                                    .padding(12.dp),
                                contentAlignment = Alignment.Center
                            ) {
                                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                    Text(
                                        text = "${billing.formattedPrice} / mes",
                                        fontSize = 18.sp,
                                        fontWeight = FontWeight.Bold,
                                        color = MintPrimary
                                    )
                                    Spacer(modifier = Modifier.height(2.dp))
                                    Text(
                                        text = billing.renewalDescription ?: "Suscripción mensual con renovación automática. Podés cancelar en cualquier momento desde Google Play.",
                                        fontSize = 11.sp,
                                        color = TextSubtle,
                                        textAlign = TextAlign.Center
                                    )
                                }
                            }

                            Spacer(modifier = Modifier.height(12.dp))

                            Button(
                                onClick = {
                                    (context as? Activity)?.let(onPurchase)
                                },
                                enabled = billing.canStartNewPurchase,
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .height(48.dp)
                                    .testTag(SubscriptionTestTags.PURCHASE_BUTTON),
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = MintPrimary,
                                    contentColor = OnMintPrimary
                                ),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Text(
                                    text = "Suscribirme a Pro",
                                    fontSize = 14.sp,
                                    fontWeight = FontWeight.Bold
                                )
                            }
                        }

                        // A retryable purchase can still have a price: keep its result visible.
                        val purchaseMessage = billing.purchaseResultMessage ?: billing.message
                        if (purchaseMessage != null && !billing.isLoading && !billing.requiresExistingSubscriptionManagement) {
                            Text(
                                text = purchaseMessage,
                                fontSize = 12.sp,
                                color = if (billing.canPurchase) TextMediumEmphasis else TextSubtle
                            )
                        }

                        Spacer(modifier = Modifier.height(12.dp))

                        // Restore and Manage buttons
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            OutlinedButton(
                                onClick = onRestore,
                                enabled = !billing.isLoading,
                                modifier = Modifier
                                    .weight(1f)
                                    .height(48.dp)
                                    .testTag(SubscriptionTestTags.RESTORE_BUTTON),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Text(
                                    text = "Restaurar",
                                    fontSize = 12.sp,
                                    color = MintPrimary
                                )
                            }

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
                                modifier = Modifier
                                    .weight(1f)
                                    .height(48.dp)
                                    .testTag(SubscriptionTestTags.MANAGE_BUTTON),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Text(
                                    text = "Gestionar en Play",
                                    fontSize = 12.sp,
                                    color = MintPrimary
                                )
                            }
                        }

                        Spacer(modifier = Modifier.height(8.dp))

                        OutlinedButton(
                            onClick = onRefresh,
                            enabled = !billing.isLoading,
                            modifier = Modifier
                                .fillMaxWidth()
                                .height(48.dp)
                                .testTag(SubscriptionTestTags.REFRESH_BUTTON),
                            shape = RoundedCornerShape(12.dp)
                        ) {
                            Icon(
                                imageVector = Icons.Default.Refresh,
                                contentDescription = null,
                                tint = MintPrimary,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(6.dp))
                            Text(
                                text = "Actualizar estado",
                                fontSize = 12.sp,
                                color = MintPrimary
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                // Legal links
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.Center
                ) {
                    TextButton(
                        onClick = {
                            runCatching {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://pediturno.com/terminos")))
                            }
                        }
                    ) {
                        Text("Términos del Servicio", color = TextSubtle, fontSize = 11.sp)
                    }
                    Text("•", color = TextSubtle, modifier = Modifier.align(Alignment.CenterVertically))
                    TextButton(
                        onClick = {
                            runCatching {
                                context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://pediturno.com/privacy-policy")))
                            }
                        }
                    ) {
                        Text("Privacidad", color = TextSubtle, fontSize = 11.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun FeatureRow(
    feature: String,
    freeDetail: String,
    proDetail: String,
    highlight: Boolean = false
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(8.dp))
            .background(if (highlight) MintContainer.copy(alpha = 0.3f) else SurfaceLevel2)
            .padding(horizontal = 10.dp, vertical = 7.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Row(
            modifier = Modifier.weight(1.1f),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                imageVector = Icons.Default.Check,
                contentDescription = null,
                tint = if (highlight) MintPrimary else EmeraldConfirmed,
                modifier = Modifier.size(14.dp)
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = feature,
                fontSize = 12.sp,
                color = if (highlight) TextHighEmphasis else TextMediumEmphasis,
                fontWeight = if (highlight) FontWeight.SemiBold else FontWeight.Normal
            )
        }
        Row(
            modifier = Modifier.weight(1.1f),
            horizontalArrangement = Arrangement.End,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Text(
                text = freeDetail,
                fontSize = 11.sp,
                color = TextSubtle,
                maxLines = 1,
                softWrap = false
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = "•",
                fontSize = 11.sp,
                color = TextSubtle
            )
            Spacer(modifier = Modifier.width(6.dp))
            Text(
                text = proDetail,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold,
                color = if (highlight) MintPrimary else TextHighEmphasis,
                maxLines = 1,
                softWrap = false
            )
        }
    }
}
