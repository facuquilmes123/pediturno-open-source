package com.pediturno.servicios.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.TaskAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.SkyAccent
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import com.pediturno.servicios.data.model.Appointment
import java.text.NumberFormat
import java.util.Locale
import java.time.YearMonth
import java.time.LocalDate
import java.time.format.DateTimeFormatter

object BusinessDashboardTestTags {
    const val UPCOMING_COUNT = "business_dashboard_upcoming_count"
    const val CLIENT_COUNT = "business_dashboard_client_count"
    const val COMPLETED_VALUE = "business_dashboard_completed_value"
}

/** Server-backed equivalent of the web dashboard summary; no local aggregation. */
@Composable
fun BusinessDashboardOverview(
    monthKey: String,
    upcomingAppointmentsCount: Int,
    totalClients: Int,
    monthlyRevenue: Double,
    upcomingAppointments: List<Appointment>,
    isLoading: Boolean,
    hasLoadedData: Boolean,
    error: String?,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier
) {
    val currencyFormat = remember {
        NumberFormat.getCurrencyInstance(Locale.forLanguageTag("es-AR")).apply { maximumFractionDigits = 2 }
    }
    val monthLabel = remember(monthKey) {
        runCatching { YearMonth.parse(monthKey).format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.forLanguageTag("es-AR"))) }.getOrDefault(monthKey)
    }

    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(SurfaceLevel1, RoundedCornerShape(22.dp))
            .border(1.dp, BorderHairline, RoundedCornerShape(22.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("Resumen del negocio", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = TextHighEmphasis)
            Text(monthLabel, fontSize = 12.sp, color = TextSubtle)
        }
        when {
            isLoading && !hasLoadedData -> Text("Actualizando resumen…", fontSize = 12.sp, color = TextMediumEmphasis)
            error != null && !hasLoadedData -> {
                Text(error, fontSize = 12.sp, color = TextMediumEmphasis)
                TextButton(onClick = onRetry) { Text("Reintentar", color = MintPrimary) }
            }
            hasLoadedData -> {
                if (isLoading) Text("Actualizando resumen…", fontSize = 12.sp, color = TextMediumEmphasis)
                if (error != null) {
                    Text("No se pudo actualizar el resumen. Se conserva la última consulta.", fontSize = 12.sp, color = TextMediumEmphasis)
                    TextButton(onClick = onRetry) { Text("Reintentar", color = MintPrimary) }
                }
                DashboardMetrics(
                    upcomingAppointmentsCount.toString(), totalClients.toString(), currencyFormat.format(monthlyRevenue)
                )
                Text("Próximas reservas", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = TextHighEmphasis)
                if (upcomingAppointments.isEmpty()) {
                    Text("No hay próximas reservas.", fontSize = 12.sp, color = TextMediumEmphasis)
                } else {
                    upcomingAppointments.take(5).forEach { appointment ->
                        val dateLabel = remember(appointment.dateKey) {
                            runCatching { LocalDate.parse(appointment.dateKey).format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.forLanguageTag("es-AR"))) }.getOrDefault(appointment.dateKey)
                        }
                        Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Icon(Icons.Outlined.CalendarMonth, contentDescription = null, tint = MintPrimary, modifier = Modifier.padding(top = 2.dp).size(18.dp))
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(appointment.client, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = TextHighEmphasis)
                                Text(appointment.service, fontSize = 12.sp, color = TextMediumEmphasis)
                                Text("$dateLabel · ${appointment.time}", style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"), fontSize = 11.sp, color = TextSubtle)
                            }
                        }
                    }
                }
            }
            else -> Text("Resumen aún no disponible.", fontSize = 12.sp, color = TextMediumEmphasis)
        }
    }
}

@Composable
private fun DashboardMetrics(upcoming: String, clients: String, completed: String) {
    val fontScale = LocalDensity.current.fontScale
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val stackCounts = maxWidth < 300.dp || fontScale > 1.3f
        if (maxWidth >= 600.dp && fontScale <= 1.3f) {
            Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                DashboardMetric("Reservas próximas", upcoming, MintPrimary, Icons.Outlined.CalendarMonth, Modifier.weight(1f).fillMaxHeight(), valueTag = BusinessDashboardTestTags.UPCOMING_COUNT)
                DashboardMetric("Clientes totales", clients, SkyAccent, Icons.Outlined.Groups, Modifier.weight(1f).fillMaxHeight(), valueTag = BusinessDashboardTestTags.CLIENT_COUNT)
                DashboardMetric("Valor completado", completed, EmeraldConfirmed, Icons.Outlined.TaskAlt, Modifier.weight(1f).fillMaxHeight(), descriptor = "Turnos completados del mes", valueTag = BusinessDashboardTestTags.COMPLETED_VALUE)
            }
        } else {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (stackCounts) {
                    DashboardMetric("Reservas próximas", upcoming, MintPrimary, Icons.Outlined.CalendarMonth, Modifier.fillMaxWidth(), horizontal = true, valueTag = BusinessDashboardTestTags.UPCOMING_COUNT)
                    DashboardMetric("Clientes totales", clients, SkyAccent, Icons.Outlined.Groups, Modifier.fillMaxWidth(), horizontal = true, valueTag = BusinessDashboardTestTags.CLIENT_COUNT)
                } else {
                    Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        DashboardMetric("Reservas próximas", upcoming, MintPrimary, Icons.Outlined.CalendarMonth, Modifier.weight(1f).fillMaxHeight(), valueTag = BusinessDashboardTestTags.UPCOMING_COUNT)
                        DashboardMetric("Clientes totales", clients, SkyAccent, Icons.Outlined.Groups, Modifier.weight(1f).fillMaxHeight(), valueTag = BusinessDashboardTestTags.CLIENT_COUNT)
                    }
                }
                DashboardMetric("Valor completado", completed, EmeraldConfirmed, Icons.Outlined.TaskAlt, Modifier.fillMaxWidth(), horizontal = true, descriptor = "Turnos completados del mes", valueTag = BusinessDashboardTestTags.COMPLETED_VALUE)
            }
        }
    }
}

@Composable
private fun DashboardMetric(
    label: String,
    value: String,
    accent: Color,
    icon: ImageVector,
    modifier: Modifier,
    horizontal: Boolean = false,
    descriptor: String? = null,
    valueTag: String
) {
    val shape = RoundedCornerShape(16.dp)
    val cardModifier = modifier
        .semantics(mergeDescendants = true) {}
        .background(Brush.verticalGradient(listOf(SurfaceLevel2, SurfaceLevel1)), shape)
        .border(1.dp, accent.copy(alpha = 0.18f), shape)
        .padding(14.dp)
    val badge: @Composable () -> Unit = {
        Box(Modifier.size(32.dp).background(accent.copy(alpha = 0.12f), RoundedCornerShape(10.dp)), contentAlignment = Alignment.Center) {
            Icon(icon, contentDescription = null, tint = accent, modifier = Modifier.size(19.dp))
        }
    }
    val readout: @Composable () -> Unit = {
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(label, fontSize = 12.sp, lineHeight = 16.sp, color = TextMediumEmphasis)
            Text(value, style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"), modifier = Modifier.testTag(valueTag), fontSize = 25.sp, lineHeight = 31.sp, fontWeight = FontWeight.Bold, color = TextHighEmphasis)
            if (descriptor != null) Text(descriptor, fontSize = 11.sp, lineHeight = 15.sp, color = TextSubtle)
        }
    }
    if (horizontal) {
        Row(cardModifier, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            badge()
            Box(Modifier.weight(1f)) { readout() }
        }
    } else Column(
        modifier = cardModifier,
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        badge()
        readout()
    }
}
