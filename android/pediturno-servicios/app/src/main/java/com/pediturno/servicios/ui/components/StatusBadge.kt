package com.pediturno.servicios.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.core.theme.AmberContainer
import com.pediturno.servicios.core.theme.AmberPending
import com.pediturno.servicios.core.theme.CrimsonCancelled
import com.pediturno.servicios.core.theme.CrimsonContainer
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.EmeraldContainer
import com.pediturno.servicios.core.theme.SlateDeep
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.data.model.AppointmentStatus

@Composable
fun StatusBadge(
    status: AppointmentStatus,
    modifier: Modifier = Modifier
) {
    val (bgColor, textColor, borderColor) = when (status) {
        AppointmentStatus.Confirmado -> Triple(EmeraldContainer, EmeraldConfirmed, EmeraldConfirmed.copy(alpha = 0.3f))
        AppointmentStatus.Pendiente -> Triple(AmberContainer, AmberPending, AmberPending.copy(alpha = 0.3f))
        AppointmentStatus.Completado -> Triple(SlateDeep, TextMediumEmphasis, TextMediumEmphasis.copy(alpha = 0.2f))
        AppointmentStatus.Cancelado -> Triple(CrimsonContainer, CrimsonCancelled, CrimsonCancelled.copy(alpha = 0.3f))
    }

    Box(
        modifier = modifier
            .clip(RoundedCornerShape(9999.dp))
            .background(bgColor)
            .border(1.dp, borderColor, RoundedCornerShape(9999.dp))
            .padding(horizontal = 10.dp, vertical = 3.dp)
    ) {
        Text(
            text = status.label,
            color = textColor,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold,
            maxLines = 1,
            softWrap = false,
            letterSpacing = 0.02.sp
        )
    }
}
