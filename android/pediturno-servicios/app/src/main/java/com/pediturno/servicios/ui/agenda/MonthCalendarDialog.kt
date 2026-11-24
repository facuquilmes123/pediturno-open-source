package com.pediturno.servicios.ui.agenda

import androidx.compose.foundation.background
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.ObsidianCanvas
import com.pediturno.servicios.core.theme.OnMintPrimary
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.time.format.TextStyle
import java.util.Locale

object MonthCalendarTestTags {
    fun day(dateKey: String) = "month_calendar_day_$dateKey"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MonthCalendarDialog(
    currentDateKey: String,
    onDateSelected: (String) -> Unit,
    onDismiss: () -> Unit,
    todayDateKey: String = LocalDate.now().toString()
) {
    val today = remember(todayDateKey) { runCatching { LocalDate.parse(todayDateKey) }.getOrDefault(LocalDate.now()) }
    val initialDate = remember(currentDateKey) {
        runCatching { LocalDate.parse(currentDateKey) }.getOrDefault(today)
    }
    var displayedMonthKey by rememberSaveable(currentDateKey) { mutableStateOf(YearMonth.from(initialDate).toString()) }
    val displayedMonth = YearMonth.parse(displayedMonthKey)
    val esLocale = remember { Locale.forLanguageTag("es-AR") }
    val spokenDateFormat = remember { DateTimeFormatter.ofPattern("EEEE d 'de' MMMM 'de' uuuu", Locale.forLanguageTag("es")) }
    val windowSize = LocalWindowInfo.current.containerSize
    val maxCalendarHeight = with(LocalDensity.current) {
        (windowSize.height.toDp() - 80.dp).coerceAtLeast(160.dp)
    }

    val daysOfWeek = remember { listOf("L", "M", "X", "J", "V", "S", "D") }

    BasicAlertDialog(
        onDismissRequest = onDismiss
    ) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = maxCalendarHeight)
                .clip(RoundedCornerShape(24.dp))
                .background(SurfaceLevel1)
                .border(1.dp, BorderHairline, RoundedCornerShape(24.dp))
                .padding(20.dp)
        ) {
            Column(modifier = Modifier.verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
                // Header del mes con flechas
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    IconButton(
                        onClick = { displayedMonthKey = displayedMonth.minusMonths(1).toString() },
                        modifier = Modifier.size(48.dp)
                    ) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowBack,
                            contentDescription = "Mes anterior",
                            tint = TextMediumEmphasis
                        )
                    }

                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Text(
                            text = displayedMonth.month.getDisplayName(TextStyle.FULL, esLocale).replaceFirstChar { it.uppercase() } + " " + displayedMonth.year,
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextHighEmphasis
                        )
                    }

                    IconButton(
                        onClick = { displayedMonthKey = displayedMonth.plusMonths(1).toString() },
                        modifier = Modifier.size(48.dp)
                    ) {
                        Icon(
                            Icons.AutoMirrored.Outlined.ArrowForward,
                            contentDescription = "Mes siguiente",
                            tint = TextMediumEmphasis
                        )
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                // Fila de días de la semana L M X J V S D
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceAround
                ) {
                    daysOfWeek.forEach { dayLabel ->
                        Text(
                            text = dayLabel,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextSubtle,
                            modifier = Modifier.weight(1f),
                            textAlign = TextAlign.Center
                        )
                    }
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Cuadrícula de días del mes
                val firstDayOfMonth = displayedMonth.atDay(1)
                // DayOfWeek: 1 = Lunes, 7 = Domingo
                val leadingBlanks = firstDayOfMonth.dayOfWeek.value - 1
                val daysInMonth = displayedMonth.lengthOfMonth()

                val totalCells = leadingBlanks + daysInMonth
                val totalRows = (totalCells + 6) / 7

                for (row in 0 until totalRows) {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(vertical = 3.dp),
                        horizontalArrangement = Arrangement.SpaceAround
                    ) {
                        for (col in 0..6) {
                            val cellIndex = row * 7 + col
                            val dayNumber = cellIndex - leadingBlanks + 1

                            if (dayNumber in 1..daysInMonth) {
                                val cellDate = displayedMonth.atDay(dayNumber)
                                val cellKey = cellDate.format(DateTimeFormatter.ISO_LOCAL_DATE)
                                val isSelected = cellKey == currentDateKey
                                val isToday = cellDate == today

                                Box(
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(48.dp)
                                        .clip(CircleShape)
                                        .background(
                                            when {
                                                isSelected -> MintPrimary
                                                isToday -> SurfaceLevel2
                                                else -> Color.Transparent
                                            }
                                        )
                                        .border(
                                            width = if (isToday && !isSelected) 1.dp else 0.dp,
                                            color = if (isToday && !isSelected) MintPrimary else Color.Transparent,
                                            shape = CircleShape
                                        )
                                        .semantics { contentDescription = cellDate.format(spokenDateFormat); selected = isSelected }
                                        .clickable(role = Role.Button) {
                                            onDateSelected(cellKey)
                                            onDismiss()
                                        }
                                        .testTag(MonthCalendarTestTags.day(cellKey)),
                                    contentAlignment = Alignment.Center
                                ) {
                                    Text(
                                        text = dayNumber.toString(),
                                        fontSize = 13.sp,
                                        fontWeight = if (isSelected || isToday) FontWeight.Bold else FontWeight.Normal,
                                        color = if (isSelected) OnMintPrimary else TextHighEmphasis
                                    )
                                }
                            } else {
                                Spacer(modifier = Modifier.weight(1f).height(48.dp))
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(18.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Button(
                        onClick = {
                            val todayKey = today.format(DateTimeFormatter.ISO_LOCAL_DATE)
                            onDateSelected(todayKey)
                            onDismiss()
                        },
                        colors = ButtonDefaults.buttonColors(
                            containerColor = SurfaceLevel2,
                            contentColor = MintPrimary
                        ),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Ir a Hoy", fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    }

                    Button(
                        onClick = onDismiss,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MintPrimary,
                            contentColor = OnMintPrimary
                        ),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Cerrar", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                    }
                }
            }
        }
    }
}
