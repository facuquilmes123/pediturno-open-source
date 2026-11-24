package com.pediturno.servicios.ui.components

import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.core.theme.AmberPending
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.SurfaceLevel2

@Composable
fun SyncStatusPill(
    isOfflineCache: Boolean,
    modifier: Modifier = Modifier,
    hasVerifiedData: Boolean = false,
    isLoading: Boolean = false
) {
    val (dotColor, textColor, text) = if (!hasVerifiedData) {
        Triple(AmberPending, AmberPending, if (isLoading) "Actualizando agenda…" else "Sin sincronización confirmada")
    } else if (isOfflineCache) {
        Triple(AmberPending, AmberPending, "Modo sin conexión • Datos locales")
    } else {
        Triple(EmeraldConfirmed, EmeraldConfirmed, "Agenda actualizada")
    }

    val pulseTransition = rememberInfiniteTransition(label = "pulseTransition")
    val pulseScale by pulseTransition.animateFloat(
        initialValue = 0.85f,
        targetValue = 1.25f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 1000, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulseScale"
    )

    Row(
        modifier = modifier
            .clip(RoundedCornerShape(9999.dp))
            .background(SurfaceLevel2)
            .border(1.dp, dotColor.copy(alpha = 0.28f), RoundedCornerShape(9999.dp))
            .padding(horizontal = 11.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(
            modifier = Modifier
                .size(7.dp)
                .scale(if (!isOfflineCache) pulseScale else 1f)
                .clip(CircleShape)
                .background(dotColor)
        )
        Spacer(modifier = Modifier.width(7.dp))
        Text(
            text = text,
            color = textColor,
            fontSize = 11.sp,
            fontWeight = FontWeight.SemiBold
        )
    }
}
