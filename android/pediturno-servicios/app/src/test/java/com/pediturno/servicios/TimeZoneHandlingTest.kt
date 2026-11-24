package com.pediturno.servicios

import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import java.time.Clock
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.util.TimeZone
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class TimeZoneHandlingTest {

    @Test
    fun `business timezone converts local 14_00 to exact expected UTC instant`() {
        val manager = BusinessTimeZoneManager(ZoneId.of("America/Argentina/Buenos_Aires"))
        val dateKey = "2026-10-25"
        val time = "14:00"

        // En Argentina (UTC-3), 14:00 equivale exactamente a 17:00 UTC
        val instant = manager.toUtcInstant(dateKey, time)
        val expectedUtc = Instant.parse("2026-10-25T17:00:00Z")

        assertEquals("El instante UTC debe coincidir con UTC-3", expectedUtc, instant)
    }

    @Test
    fun `midnight and month boundaries remain anchored to business timezone regardless of foreign device timezone`() {
        val originalDefault = TimeZone.getDefault()
        try {
            // Simulamos que el dispositivo del usuario está configurado en Tokio (UTC+9)
            TimeZone.setDefault(TimeZone.getTimeZone("Asia/Tokyo"))

            // Instante: 2026-11-01T01:30:00Z -> En Tokio es 1 de Noviembre 10:30,
            // pero en Buenos Aires (UTC-3) todavía es 31 de Octubre a las 22:30.
            val boundaryInstant = Instant.parse("2026-11-01T01:30:00Z")
            val fixedClock = Clock.fixed(boundaryInstant, ZoneId.of("Asia/Tokyo"))
            val manager = BusinessTimeZoneManager(
                businessZoneId = ZoneId.of("America/Argentina/Buenos_Aires"),
                clock = fixedClock
            )

            assertEquals("2026-10-31", manager.todayDateKey())
            assertEquals("2026-10-31", manager.dateKeyForInstant(boundaryInstant))
            assertEquals("22:30", manager.timeForInstant(boundaryInstant))
        } finally {
            TimeZone.setDefault(originalDefault)
        }
    }

    @Test
    fun `generateAvailableSlots marks occupied and buffer windows as unavailable`() {
        val manager = BusinessTimeZoneManager()
        val dateKey = "2026-10-25"
        val existing = listOf(
            Appointment(
                id = "apt_test_1",
                client = "Martín Palermo",
                clientPhone = "1144556677",
                serviceId = "srv_1",
                service = "Corte Clásico",
                dateKey = dateKey,
                time = "10:00",
                durationMinutes = 30,
                bookingBufferMinutes = 15,
                priceAtBooking = 8000.0,
                status = AppointmentStatus.Confirmado,
                businessId = "biz_demo_123"
            )
        )

        val slots = manager.generateAvailableSlots(
            dateKey = dateKey,
            durationMinutes = 30,
            bookingBufferMinutes = 15,
            existingAppointments = existing
        )

        val slot0900 = slots.first { it.time == "09:00" }
        val slot1000 = slots.first { it.time == "10:00" }
        val slot1030 = slots.first { it.time == "10:30" } // Colisiona con buffer 10:30..10:45
        val slot1100 = slots.first { it.time == "11:00" }

        assertTrue("09:00 debe estar libre (09:00 + 30m + 15m = 09:45 <= 10:00)", slot0900.isAvailable)
        assertFalse("10:00 debe estar ocupado por el turno", slot1000.isAvailable)
        assertFalse("10:30 debe estar ocupado por el buffer de 15 min del turno de las 10:00", slot1030.isAvailable)
        assertTrue("11:00 debe estar libre", slot1100.isAvailable)
    }

    @Test
    fun `isSlotInPast correctly evaluates future slots in business zone`() {
        val manager = BusinessTimeZoneManager()
        val futureDate = LocalDate.now(manager.businessZoneId).plusDays(2).toString()
        val isPast = manager.isSlotInPast(futureDate, "10:00")
        assertFalse("Un turno a 2 días en el futuro no debe figurar en el pasado", isPast)
    }
}
