package com.pediturno.servicios.core.timezone

import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

data class SlotAvailability(
    val time: String,
    val isAvailable: Boolean,
    val conflictReason: String? = null
)

class BusinessTimeZoneManager(
    val businessZoneId: ZoneId = ZoneId.of("America/Argentina/Buenos_Aires"),
    private val clock: Clock = Clock.systemUTC()
) {
    private val esArLocale: Locale = Locale.forLanguageTag("es-AR")
    private val dateKeyFormatter = DateTimeFormatter.ofPattern("yyyy-MM-dd", Locale.US)
    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.US)
    private val displayDateFormatter = DateTimeFormatter.ofPattern("EEEE d 'de' MMMM", esArLocale)

    fun todayLocalDate(): LocalDate {
        return LocalDate.now(clock.withZone(businessZoneId))
    }

    fun todayDateKey(): String {
        return todayLocalDate().format(dateKeyFormatter)
    }

    fun dateKeyForInstant(instant: Instant): String {
        return instant.atZone(businessZoneId).toLocalDate().format(dateKeyFormatter)
    }

    fun timeForInstant(instant: Instant): String {
        return instant.atZone(businessZoneId).toLocalTime().format(timeFormatter)
    }

    fun parseDateKey(dateKey: String): LocalDate {
        return LocalDate.parse(dateKey, dateKeyFormatter)
    }

    fun formatDateKey(date: LocalDate): String {
        return date.format(dateKeyFormatter)
    }

    fun formatDisplayDate(dateKey: String): String {
        val date = parseDateKey(dateKey)
        val formatted = date.format(displayDateFormatter)
        return formatted.replaceFirstChar {
            if (it.isLowerCase()) it.titlecase(esArLocale) else it.toString()
        }
    }

    fun formatZoneLabel(
        zoneIdString: String?,
        instant: Instant = Instant.now(clock)
    ): String {
        val clean = zoneIdString?.trim().orEmpty()
        val zone = runCatching {
            if (clean.isNotBlank()) ZoneId.of(clean) else businessZoneId
        }.getOrElse { businessZoneId }

        val offset = try {
            zone.rules.getOffset(instant)
        } catch (_: Exception) {
            businessZoneId.rules.getOffset(instant)
        }

        val offsetId = offset.id
        val offsetText = if (offsetId == "Z") "GMT" else "GMT$offsetId"
        val displayZone = if (clean.isNotBlank()) clean else zone.id
        return "$displayZone ($offsetText)"
    }

    fun formatEndTime(startTime: String, durationMinutes: Int): String {
        val localTime = LocalTime.parse(startTime, timeFormatter)
        return localTime.plusMinutes(durationMinutes.toLong()).format(timeFormatter)
    }

    fun toUtcInstant(dateKey: String, time: String): Instant {
        val date = LocalDate.parse(dateKey, dateKeyFormatter)
        val localTime = LocalTime.parse(time, timeFormatter)
        val localDateTime = LocalDateTime.of(date, localTime)
        val zonedDateTime = localDateTime.atZone(businessZoneId)
        return zonedDateTime.toInstant()
    }

    fun isSlotInPast(dateKey: String, time: String): Boolean {
        val slotInstant = toUtcInstant(dateKey, time)
        return slotInstant.isBefore(Instant.now(clock))
    }

    fun minutesFromMidnight(time: String): Int {
        val localTime = LocalTime.parse(time, timeFormatter)
        return localTime.hour * 60 + localTime.minute
    }

    fun formatMinutesAsTime(totalMinutes: Int): String {
        val clamped = totalMinutes.coerceIn(0, 23 * 60 + 59)
        val h = clamped / 60
        val m = clamped % 60
        return String.format(Locale.US, "%02d:%02d", h, m)
    }

    /**
     * Genera la grilla de horarios del negocio evaluando colisiones reales + buffer post-turno
     * en la zona horaria canónica del negocio (independiente de la zona del teléfono).
     */
    fun generateAvailableSlots(
        dateKey: String,
        durationMinutes: Int,
        bookingBufferMinutes: Int = 15,
        openTime: String = "09:00",
        closeTime: String = "20:00",
        stepMinutes: Int = 30,
        existingAppointments: List<Appointment> = emptyList(),
        excludeAppointmentId: String? = null
    ): List<SlotAvailability> {
        val openMin = minutesFromMidnight(openTime)
        val closeMin = minutesFromMidnight(closeTime)
        val activeForDate = existingAppointments.filter {
            it.dateKey == dateKey &&
                it.status != AppointmentStatus.Cancelado &&
                it.id != excludeAppointmentId
        }

        val slots = mutableListOf<SlotAvailability>()
        var cursor = openMin
        while (cursor + durationMinutes <= closeMin) {
            val candidateTime = formatMinutesAsTime(cursor)
            val candidateStart = cursor
            val candidateOccupiedEnd = cursor + durationMinutes + bookingBufferMinutes

            val conflicting = activeForDate.firstOrNull { existing ->
                val existingStart = minutesFromMidnight(existing.time)
                val existingOccupiedEnd = existingStart + existing.durationMinutes + existing.bookingBufferMinutes
                candidateStart < existingOccupiedEnd && existingStart < candidateOccupiedEnd
            }

            if (conflicting != null) {
                slots.add(
                    SlotAvailability(
                        time = candidateTime,
                        isAvailable = false,
                        conflictReason = "Ocupado por ${conflicting.client} (${conflicting.time})"
                    )
                )
            } else {
                slots.add(
                    SlotAvailability(
                        time = candidateTime,
                        isAvailable = true,
                        conflictReason = null
                    )
                )
            }
            cursor += stepMinutes
        }
        return slots
    }
}
