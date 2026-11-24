package com.pediturno.servicios.ui.agenda

import androidx.compose.ui.platform.testTag

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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.snapshots.SnapshotStateMap
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.BorderSubtle
import com.pediturno.servicios.core.theme.CrimsonCancelled
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.OnMintPrimary
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import com.pediturno.servicios.data.model.DaySchedule
import com.pediturno.servicios.data.model.DayScheduleSlot
import com.pediturno.servicios.data.model.ServiceItem
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

private val WorkingHoursSaver = Saver<SnapshotStateMap<Int, DaySchedule>, String>(
    save = { Json.encodeToString(it.toMap()) },
    restore = { saved -> mutableStateMapOf<Int, DaySchedule>().apply { putAll(Json.decodeFromString<Map<Int, DaySchedule>>(saved)) } }
)

object ServiceAvailabilityTestTags {
    const val BLOCKED_DATES_TAB = "service_availability_blocked_dates_tab"
    const val SELECT_BLOCKED_DATE = "service_availability_select_blocked_date"
    fun blockedDate(dateKey: String) = "service_availability_blocked_$dateKey"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ServiceAvailabilityDialog(
    service: ServiceItem,
    onSaveAvailability: (serviceId: String, workingHours: Map<Int, DaySchedule>, unavailableDates: List<String>) -> Unit,
    onDismiss: () -> Unit,
    todayDateKey: String = LocalDate.now().toString(),
    isSubmitting: Boolean = false,
    errorMessage: String? = null
) {
    var selectedTab by rememberSaveable(service.id) { mutableIntStateOf(0) }

    val daysOfWeek = remember {
        listOf(
            1 to "Lunes",
            2 to "Martes",
            3 to "Miércoles",
            4 to "Jueves",
            5 to "Viernes",
            6 to "Sábado",
            0 to "Domingo"
        )
    }

    val workingHoursState = rememberSaveable(service.id, saver = WorkingHoursSaver) {
        mutableStateMapOf<Int, DaySchedule>().apply {
            putAll(service.workingHours)
            // Si estaba vacío, pre-inicializar con Lun a Vie 09:00 a 18:00
            if (isEmpty()) {
                (1..5).forEach { d ->
                    put(d, DaySchedule(listOf(DayScheduleSlot("09:00", "13:00"), DayScheduleSlot("14:30", "19:00"))))
                }
                put(6, DaySchedule(listOf(DayScheduleSlot("09:00", "14:00"))))
            }
        }
    }

    var unavailableDatesState by rememberSaveable(service.id) {
        mutableStateOf(service.unavailableDates.toList())
    }
    var showBlockedDatePicker by rememberSaveable(service.id) { mutableStateOf(false) }
    val dateFormat = remember { DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.forLanguageTag("es")) }

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = MintPrimary,
        unfocusedBorderColor = BorderSubtle,
        focusedTextColor = TextHighEmphasis,
        unfocusedTextColor = TextHighEmphasis,
        focusedLabelColor = MintPrimary,
        unfocusedLabelColor = TextMediumEmphasis,
        cursorColor = MintPrimary
    )

    val scheduleError = workingHoursState.values.firstNotNullOfOrNull { validateScheduleSlots(it.slots) }
    val windowSize = LocalWindowInfo.current.containerSize
    val maxDialogHeight = with(LocalDensity.current) { windowSize.height.toDp() * 0.85f }

    BasicAlertDialog(onDismissRequest = onDismiss) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .heightIn(max = maxDialogHeight)
                .clip(RoundedCornerShape(24.dp))
                .background(SurfaceLevel1)
                .border(1.dp, BorderHairline, RoundedCornerShape(24.dp))
                .imePadding()
                .padding(20.dp)
        ) {
            Column {
                Column(modifier = Modifier.weight(1f, fill = false).verticalScroll(rememberScrollState())) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(Icons.Outlined.Schedule, contentDescription = null, tint = MintPrimary, modifier = Modifier.size(22.dp))
                        Spacer(modifier = Modifier.width(8.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = "Disponibilidad: ${service.name}",
                                fontSize = 17.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextHighEmphasis
                            )
                            Text(
                                text = "Configurá los días y turnos de atención para este servicio",
                                fontSize = 11.sp,
                                color = TextMediumEmphasis
                            )
                        }
                        IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                            Icon(Icons.Outlined.Close, contentDescription = "Cerrar", tint = TextMediumEmphasis)
                        }
                    }

                    Spacer(modifier = Modifier.height(14.dp))

                    TabRow(
                        selectedTabIndex = selectedTab,
                        containerColor = SurfaceLevel2,
                        contentColor = MintPrimary,
                        indicator = { tabPositions ->
                            TabRowDefaults.SecondaryIndicator(
                                Modifier.tabIndicatorOffset(tabPositions[selectedTab]),
                                color = MintPrimary
                            )
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(12.dp))
                    ) {
                        Tab(
                            selected = selectedTab == 0,
                            onClick = { selectedTab = 0 },
                            text = { Text("Horario Semanal", fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                        )
                        Tab(
                            selected = selectedTab == 1,
                            onClick = { selectedTab = 1 },
                            modifier = Modifier.testTag(ServiceAvailabilityTestTags.BLOCKED_DATES_TAB),
                            text = { Text("Feriados y Bloqueos", fontSize = 12.sp, fontWeight = FontWeight.Bold) }
                        )
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    if (selectedTab == 0) {
                        // TAB: HORARIOS SEMANALES
                        Row(
                            modifier = Modifier.fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Text(
                                text = "DÍAS Y TURNOS DE ATENCIÓN",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextSubtle
                            )

                            TextButton(
                                onClick = {
                                    val mondaySchedule = workingHoursState[1] ?: DaySchedule(listOf(DayScheduleSlot("09:00", "18:00")))
                                    (2..5).forEach { dayIdx ->
                                        workingHoursState[dayIdx] = mondaySchedule
                                    }
                                }
                            ) {
                                Icon(Icons.Outlined.ContentCopy, contentDescription = null, modifier = Modifier.size(13.dp), tint = MintPrimary)
                                Spacer(modifier = Modifier.width(4.dp))
                                Text("Copiar Lun a Vie", fontSize = 11.sp, color = MintPrimary, fontWeight = FontWeight.SemiBold)
                            }
                        }

                        Column(
                            modifier = Modifier
                                .fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            daysOfWeek.forEach { (dayIndex, dayName) ->
                                val currentSchedule = workingHoursState[dayIndex]
                                val isDayEnabled = currentSchedule != null && currentSchedule.slots.isNotEmpty()

                                Box(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .clip(RoundedCornerShape(14.dp))
                                        .background(if (isDayEnabled) SurfaceLevel2 else SurfaceLevel2.copy(alpha = 0.4f))
                                        .border(
                                            width = if (isDayEnabled) 1.dp else 0.5.dp,
                                            color = if (isDayEnabled) BorderHairline else BorderSubtle,
                                            shape = RoundedCornerShape(14.dp)
                                        )
                                        .padding(10.dp)
                                ) {
                                    Column {
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.SpaceBetween
                                        ) {
                                            Row(verticalAlignment = Alignment.CenterVertically) {
                                                Checkbox(
                                                    checked = isDayEnabled,
                                                    onCheckedChange = { checked ->
                                                        if (checked) {
                                                            workingHoursState[dayIndex] = DaySchedule(
                                                                listOf(DayScheduleSlot("09:00", "13:00"), DayScheduleSlot("14:30", "19:00"))
                                                            )
                                                        } else {
                                                            workingHoursState.remove(dayIndex)
                                                        }
                                                    },
                                                    colors = CheckboxDefaults.colors(
                                                        checkedColor = MintPrimary,
                                                        checkmarkColor = OnMintPrimary
                                                    )
                                                )
                                                Spacer(modifier = Modifier.width(4.dp))
                                                Text(
                                                    text = dayName,
                                                    fontSize = 14.sp,
                                                    fontWeight = FontWeight.Bold,
                                                    color = if (isDayEnabled) TextHighEmphasis else TextSubtle
                                                )
                                            }

                                            if (isDayEnabled) {
                                                Text(
                                                    text = "${currentSchedule.slots.size} turnos",
                                                    fontSize = 11.sp,
                                                    color = MintPrimary,
                                                    fontWeight = FontWeight.SemiBold
                                                )
                                            } else {
                                                Text(
                                                    text = "Cerrado",
                                                    fontSize = 11.sp,
                                                    color = TextSubtle
                                                )
                                            }
                                        }

                                        if (isDayEnabled) {
                                            Column(
                                                modifier = Modifier.padding(top = 4.dp),
                                                verticalArrangement = Arrangement.spacedBy(6.dp)
                                            ) {
                                                currentSchedule.slots.forEachIndexed { slotIdx, slot ->
                                                    Row(
                                                        verticalAlignment = Alignment.CenterVertically,
                                                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                                                    ) {
                                                        Text("De:", fontSize = 11.sp, color = TextMediumEmphasis)
                                                        OutlinedTextField(
                                                            value = slot.start,
                                                            onValueChange = { newStart ->
                                                                val updatedSlots = currentSchedule.slots.toMutableList()
                                                                updatedSlots[slotIdx] = slot.copy(start = newStart)
                                                                workingHoursState[dayIndex] = currentSchedule.copy(slots = updatedSlots)
                                                            },
                                                            colors = fieldColors,
                                                            isError = validateScheduleSlots(currentSchedule.slots) != null,
                                                            singleLine = true,
                                                            modifier = Modifier.weight(1f)
                                                        )
                                                        Text("a", fontSize = 11.sp, color = TextMediumEmphasis)
                                                        OutlinedTextField(
                                                            value = slot.end,
                                                            onValueChange = { newEnd ->
                                                                val updatedSlots = currentSchedule.slots.toMutableList()
                                                                updatedSlots[slotIdx] = slot.copy(end = newEnd)
                                                                workingHoursState[dayIndex] = currentSchedule.copy(slots = updatedSlots)
                                                            },
                                                            colors = fieldColors,
                                                            isError = validateScheduleSlots(currentSchedule.slots) != null,
                                                            singleLine = true,
                                                            modifier = Modifier.weight(1f)
                                                        )

                                                        if (currentSchedule.slots.size > 1) {
                                                            IconButton(
                                                                onClick = {
                                                                    val updatedSlots = currentSchedule.slots.toMutableList()
                                                                    updatedSlots.removeAt(slotIdx)
                                                                    workingHoursState[dayIndex] = currentSchedule.copy(slots = updatedSlots)
                                                                },
                                                                modifier = Modifier.size(48.dp)
                                                            ) {
                                                                Icon(Icons.Outlined.Close, contentDescription = "Quitar turno", tint = CrimsonCancelled, modifier = Modifier.size(16.dp))
                                                            }
                                                        }
                                                    }
                                                }

                                                if (currentSchedule.slots.size < 2) {
                                                    TextButton(
                                                        onClick = {
                                                            val updatedSlots = currentSchedule.slots.toMutableList()
                                                            updatedSlots.add(DayScheduleSlot("16:00", "20:00"))
                                                            workingHoursState[dayIndex] = currentSchedule.copy(slots = updatedSlots)
                                                        }
                                                    ) {
                                                        Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(14.dp), tint = MintPrimary)
                                                        Spacer(modifier = Modifier.width(4.dp))
                                                        Text("Añadir turno tarde (cortado)", fontSize = 11.sp, color = MintPrimary)
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else {
                        // TAB: FERIADOS Y FECHAS BLOQUEADAS
                        Column(
                            modifier = Modifier
                                .fillMaxWidth(),
                            verticalArrangement = Arrangement.spacedBy(10.dp)
                        ) {
                            Text(
                                "Agregá las fechas en las que no vas a atender. Tus clientes no podrán reservar esos días.",
                                fontSize = 11.sp,
                                color = TextMediumEmphasis
                            )

                            OutlinedButton(
                                onClick = { showBlockedDatePicker = true },
                                modifier = Modifier.fillMaxWidth().testTag(ServiceAvailabilityTestTags.SELECT_BLOCKED_DATE)
                            ) { Text("Elegir fecha para bloquear", color = MintPrimary) }

                            Text(
                                text = "FECHAS BLOQUEADAS (${unavailableDatesState.size})",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextSubtle
                            )

                            Column(
                                verticalArrangement = Arrangement.spacedBy(6.dp)
                            ) {
                                unavailableDatesState.toList().sorted().forEach { blockedDate ->
                                    Row(
                                        modifier = Modifier
                                            .fillMaxWidth()
                                            .clip(RoundedCornerShape(10.dp))
                                            .background(SurfaceLevel2)
                                            .padding(horizontal = 12.dp, vertical = 6.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Row(verticalAlignment = Alignment.CenterVertically) {
                                            Icon(Icons.Outlined.CalendarMonth, contentDescription = null, tint = CrimsonCancelled, modifier = Modifier.size(15.dp))
                                            Spacer(modifier = Modifier.width(8.dp))
                                            Text(
                                                runCatching { LocalDate.parse(blockedDate).format(dateFormat) }.getOrDefault("Fecha no disponible"),
                                                fontSize = 13.sp, color = TextHighEmphasis,
                                                modifier = Modifier.testTag(ServiceAvailabilityTestTags.blockedDate(blockedDate))
                                            )
                                        }
                                        IconButton(
                                            onClick = { unavailableDatesState = unavailableDatesState - blockedDate },
                                            modifier = Modifier.size(48.dp)
                                        ) {
                                            Icon(Icons.Outlined.Close, contentDescription = "Desbloquear", tint = TextSubtle, modifier = Modifier.size(15.dp))
                                        }
                                    }
                                }
                            }
                        }
                    }

                }
                if (errorMessage != null) {
                    Text(errorMessage, color = CrimsonCancelled, fontSize = 12.sp)
                    Spacer(modifier = Modifier.height(4.dp))
                }
                if (scheduleError != null) Text(scheduleError, color = CrimsonCancelled, fontSize = 12.sp)
                Spacer(modifier = Modifier.height(12.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedButton(
                        onClick = onDismiss,
                        enabled = !isSubmitting,
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Cancelar", color = TextMediumEmphasis, fontSize = 13.sp)
                    }

                    Button(
                        onClick = {
                            onSaveAvailability(
                                service.id,
                                workingHoursState.toMap(),
                                unavailableDatesState.toList()
                            )
                        },
                        enabled = !isSubmitting && scheduleError == null,
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag(WorkspaceActionTestTags.SERVICE_AVAILABILITY_SAVE),
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
                            Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("Guardar", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                        }
                    }
                }
            }
        }
    }
    if (showBlockedDatePicker) {
        MonthCalendarDialog(
            currentDateKey = todayDateKey,
            todayDateKey = todayDateKey,
            onDateSelected = { unavailableDatesState = (unavailableDatesState + it).distinct(); showBlockedDatePicker = false },
            onDismiss = { showBlockedDatePicker = false }
        )
    }
}
