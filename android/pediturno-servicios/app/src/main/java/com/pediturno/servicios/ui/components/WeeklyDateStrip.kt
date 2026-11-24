package com.pediturno.servicios.ui.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
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
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.OnMintPrimary
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

@Composable
fun WeeklyDateStrip(
    selectedDateKey: String,
    onDateSelect: (String) -> Unit,
    timeZoneManager: BusinessTimeZoneManager,
    modifier: Modifier = Modifier
) {
    val today = remember(timeZoneManager) {
        timeZoneManager.todayLocalDate()
    }

    // Ventana deslizante de 21 días (4 días previos y 16 días futuros)
    val days = remember(today) {
        (-4..16).map { offset -> today.plusDays(offset.toLong()) }
    }

    val listState = rememberLazyListState()

    // Auto-scroll al día seleccionado al montar
    LaunchedEffect(selectedDateKey) {
        val selectedIndex = days.indexOfFirst { timeZoneManager.formatDateKey(it) == selectedDateKey }
        if (selectedIndex >= 0) {
            val targetScroll = (selectedIndex - 2).coerceAtLeast(0)
            listState.animateScrollToItem(targetScroll)
        }
    }

    LazyRow(
        state = listState,
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(horizontal = 16.dp),
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        items(days, key = { it.toString() }) { date ->
            val dateKey = timeZoneManager.formatDateKey(date)
            val isSelected = dateKey == selectedDateKey
            val isToday = date == today

            val dayOfWeek = date.dayOfWeek.getDisplayName(TextStyle.SHORT, Locale.forLanguageTag("es-AR"))
                .uppercase()
                .take(3)
            val dayNumber = date.dayOfMonth.toString()

            val backgroundColor by animateColorAsState(
                targetValue = if (isSelected) MintPrimary else SurfaceLevel2,
                animationSpec = tween(durationMillis = 200, easing = FastOutSlowInEasing),
                label = "dateStripBgAnimation"
            )

            Box(
                modifier = Modifier
                    .width(54.dp)
                    .clip(RoundedCornerShape(16.dp))
                    .background(backgroundColor)
                    .border(
                        width = 1.dp,
                        color = if (isSelected) MintPrimary else if (isToday) MintPrimary.copy(alpha = 0.5f) else BorderHairline,
                        shape = RoundedCornerShape(16.dp)
                    )
                    .clickable { onDateSelect(dateKey) }
                    .padding(vertical = 10.dp),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        text = if (isToday) "HOY" else dayOfWeek,
                        fontSize = 10.sp,
                        fontWeight = if (isToday || isSelected) FontWeight.Bold else FontWeight.Medium,
                        color = if (isSelected) OnMintPrimary else if (isToday) MintPrimary else TextSubtle,
                        letterSpacing = 0.05.sp
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    Text(
                        text = dayNumber,
                        style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
                        fontSize = 18.sp,
                        fontWeight = FontWeight.Bold,
                        color = if (isSelected) OnMintPrimary else TextHighEmphasis
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                    if (isSelected) {
                        Box(
                            modifier = Modifier
                                .size(4.dp)
                                .clip(CircleShape)
                                .background(OnMintPrimary)
                        )
                    } else if (isToday) {
                        Box(
                            modifier = Modifier
                                .size(4.dp)
                                .clip(CircleShape)
                                .background(MintPrimary)
                        )
                    } else {
                        Spacer(modifier = Modifier.height(4.dp))
                    }
                }
            }
        }
    }
}
