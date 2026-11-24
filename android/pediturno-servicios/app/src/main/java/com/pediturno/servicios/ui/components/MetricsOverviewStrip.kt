package com.pediturno.servicios.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.CobaltPrimary
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import java.text.NumberFormat
import java.util.Locale

@Composable
fun MetricsOverviewStrip(
    appointments: List<Appointment>,
    modifier: Modifier = Modifier
) {
    val activeBookings = remember(appointments) {
        appointments.filter { it.status != AppointmentStatus.Cancelado }
    }
    val totalRevenue = remember(activeBookings) {
        activeBookings.sumOf { it.priceAtBooking }
    }
    val nextBooking = remember(activeBookings) {
        activeBookings.firstOrNull {
            it.status == AppointmentStatus.Confirmado || it.status == AppointmentStatus.Pendiente
        }
    }

    val currencyFormat = remember {
        NumberFormat.getCurrencyInstance(Locale.forLanguageTag("es-AR")).apply {
            maximumFractionDigits = 2
        }
    }

    AdaptiveMetrics(modifier = modifier) { cardModifier ->
        // Tarjeta 1: Total de turnos
        MetricCard(
            label = "Turnos del día",
            value = "${activeBookings.size}",
            subValue = "${activeBookings.count { it.status == AppointmentStatus.Completado }} listos",
            accentColor = MintPrimary,
            modifier = cardModifier
        )

        // El precio de un turno no equivale a efectivo cobrado: una seña puede
        // estar pendiente y el saldo se cobra por separado.
        MetricCard(
            label = "Valor de turnos",
            value = currencyFormat.format(totalRevenue),
            subValue = "no es cobrado",
            accentColor = EmeraldConfirmed,
            modifier = cardModifier
        )

        // La agenda ya está acotada a la fecha seleccionada; no inferimos que
        // sea un turno futuro sólo por su posición en la lista.
        MetricCard(
            label = "Primer turno",
            value = nextBooking?.time ?: "--:--",
            subValue = nextBooking?.client?.take(10) ?: "Sin espera",
            accentColor = MintPrimary,
            modifier = cardModifier
        )
    }
}

@Composable
private fun MetricCard(
    label: String,
    value: String,
    subValue: String,
    accentColor: Color,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(SurfaceLevel2)
            .border(1.dp, BorderHairline, RoundedCornerShape(14.dp))
            .padding(horizontal = 11.dp, vertical = 10.dp)
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text(
                text = label.uppercase(),
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                color = TextSubtle,
                letterSpacing = 0.05.sp
            )
            Box(
                modifier = Modifier
                    .size(5.dp)
                    .clip(CircleShape)
                    .background(accentColor)
            )
        }
        Spacer(modifier = Modifier.height(5.dp))
        Text(
            text = value,
            style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
            fontSize = 17.sp,
            fontWeight = FontWeight.Bold,
            color = TextHighEmphasis
        )
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = subValue,
            fontSize = 11.sp,
            color = accentColor,
            fontWeight = FontWeight.Medium
        )
    }
}
