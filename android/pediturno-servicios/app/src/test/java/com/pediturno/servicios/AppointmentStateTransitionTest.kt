package com.pediturno.servicios

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.remote.MockPediturnoRemoteDataSource
import com.pediturno.servicios.data.repository.AgendaRepository
import com.pediturno.servicios.domain.usecase.CreateAppointmentUseCase
import com.pediturno.servicios.domain.usecase.RescheduleAppointmentUseCase
import com.pediturno.servicios.domain.usecase.UpdateAppointmentStatusUseCase
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AppointmentStateTransitionTest {

    private lateinit var timeZoneManager: BusinessTimeZoneManager
    private lateinit var remoteDataSource: MockPediturnoRemoteDataSource
    private lateinit var repository: AgendaRepository
    private lateinit var createUseCase: CreateAppointmentUseCase
    private lateinit var rescheduleUseCase: RescheduleAppointmentUseCase
    private lateinit var updateStatusUseCase: UpdateAppointmentStatusUseCase

    @Before
    fun setup() {
        timeZoneManager = BusinessTimeZoneManager()
        remoteDataSource = MockPediturnoRemoteDataSource(timeZoneManager, networkDelayMs = 0L)
        repository = AgendaRepository(remoteDataSource)
        createUseCase = CreateAppointmentUseCase(repository)
        rescheduleUseCase = RescheduleAppointmentUseCase(repository)
        updateStatusUseCase = UpdateAppointmentStatusUseCase(repository)
    }

    @Test
    fun `rescheduling confirmed appointment moves slot and frees previous slot`() = runBlocking {
        val dateKey = "2026-10-31"
        val initialTime = "09:00"
        val newTime = "15:00"

        val createResult = createUseCase(
            client = "Esteban Cambiasso",
            clientPhone = "1155667788",
            clientEmail = "esteban@test.com",
            serviceId = "srv_1",
            dateKey = dateKey,
            time = initialTime,
            status = AppointmentStatus.Confirmado,
            businessId = "biz_demo_123"
        )
        assertTrue(createResult is ApiResult.Success)
        val appointmentId = (createResult as ApiResult.Success).data

        val rescheduleResult = rescheduleUseCase(appointmentId, dateKey, newTime, "biz_demo_123")
        assertTrue(rescheduleResult is ApiResult.Success)
        val refreshed = (remoteDataSource.getAppointments(dateKey, "biz_demo_123") as ApiResult.Success).data
            .first { it.id == appointmentId }
        assertEquals(newTime, refreshed.time)

        val newBookingAtOldTime = createUseCase(
            client = "Javier Zanetti",
            clientPhone = "1199887766",
            clientEmail = "javier@test.com",
            serviceId = "srv_1",
            dateKey = dateKey,
            time = initialTime,
            status = AppointmentStatus.Confirmado,
            businessId = "biz_demo_123"
        )
        assertTrue("El horario de las 09:00 debe estar disponible tras la reprogramación", newBookingAtOldTime is ApiResult.Success)
    }

    @Test
    fun `cancelled appointment cannot be rescheduled or reverted to confirmed`() = runBlocking {
        val dateKey = "2026-10-31"
        val time = "17:00"

        val createResult = createUseCase(
            client = "Diego Milito",
            clientPhone = "1122334455",
            clientEmail = "diego@test.com",
            serviceId = "srv_1",
            dateKey = dateKey,
            time = time,
            status = AppointmentStatus.Confirmado,
            businessId = "biz_demo_123"
        )
        val appointmentId = (createResult as ApiResult.Success).data

        val cancelResult = updateStatusUseCase(appointmentId, dateKey, AppointmentStatus.Cancelado, "biz_demo_123")
        assertTrue(cancelResult is ApiResult.Success)

        val rescheduleAttempt = rescheduleUseCase(appointmentId, dateKey, "18:00", "biz_demo_123")
        assertTrue(rescheduleAttempt is ApiResult.Error)
        assertEquals(409, (rescheduleAttempt as ApiResult.Error).code)

        // Intentar pasar un turno Cancelado a Confirmado debe fallar con 409 (estado terminal)
        val reopenAttempt = updateStatusUseCase(appointmentId, dateKey, AppointmentStatus.Confirmado, "biz_demo_123")
        assertTrue(reopenAttempt is ApiResult.Error)
        assertEquals(409, (reopenAttempt as ApiResult.Error).code)
    }

    @Test
    fun `appointment with pending payment cannot transition to Confirmado or Completado`() = runBlocking {
        val dateKey = "2026-11-03"
        val pendingPaymentAppt = Appointment(
            id = "apt_pending_deposit_1",
            client = "Walter Samuel",
            clientPhone = "1188776655",
            clientEmail = "walter@test.com",
            serviceId = "srv_1",
            service = "Corte Clásico",
            dateKey = dateKey,
            time = "11:00",
            durationMinutes = 30,
            priceAtBooking = 8000.0,
            status = AppointmentStatus.Pendiente,
            businessId = "biz_demo_123",
            paymentStatus = "pending"
        )
        remoteDataSource.seedCustomAppointment(pendingPaymentAppt)

        val confirmAttempt = updateStatusUseCase("apt_pending_deposit_1", dateKey, AppointmentStatus.Confirmado, "biz_demo_123")
        assertTrue(confirmAttempt is ApiResult.Error)
        assertEquals(409, (confirmAttempt as ApiResult.Error).code)

        // Pero sí puede cancelarse
        val cancelAttempt = updateStatusUseCase("apt_pending_deposit_1", dateKey, AppointmentStatus.Cancelado, "biz_demo_123")
        assertTrue(cancelAttempt is ApiResult.Success)
    }
}
