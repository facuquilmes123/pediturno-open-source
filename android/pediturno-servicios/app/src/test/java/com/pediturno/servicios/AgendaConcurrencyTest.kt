package com.pediturno.servicios

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.remote.MockPediturnoRemoteDataSource
import com.pediturno.servicios.data.repository.AgendaLoadState
import com.pediturno.servicios.data.repository.AgendaRepository
import com.pediturno.servicios.domain.usecase.CreateAppointmentUseCase
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

class AgendaConcurrencyTest {

    private lateinit var timeZoneManager: BusinessTimeZoneManager
    private lateinit var remoteDataSource: MockPediturnoRemoteDataSource
    private lateinit var repository: AgendaRepository
    private lateinit var createUseCase: CreateAppointmentUseCase

    @Before
    fun setup() {
        // Seeded sample bookings use "today"; keep them off the fixed dates below.
        timeZoneManager = BusinessTimeZoneManager(clock = Clock.fixed(Instant.parse("2026-10-29T12:00:00Z"), ZoneOffset.UTC))
        remoteDataSource = MockPediturnoRemoteDataSource(timeZoneManager, networkDelayMs = 10L)
        repository = AgendaRepository(remoteDataSource)
        createUseCase = CreateAppointmentUseCase(repository)
    }

    @Test
    fun `two concurrent bookings for same slot result in one success and one 409 conflict`() = runBlocking {
        val targetDateKey = "2026-10-30"
        val targetTime = "16:00"
        val serviceId = "srv_1" // Corte Clásico (30 min)

        val request1 = async {
            createUseCase(
                client = "Cliente Web Uno",
                clientPhone = "1111222233",
                clientEmail = "cliente1@test.com",
                serviceId = serviceId,
                dateKey = targetDateKey,
                time = targetTime,
                status = AppointmentStatus.Confirmado,
                businessId = "biz_demo_123"
            )
        }

        val request2 = async {
            createUseCase(
                client = "Cliente Android Dos",
                clientPhone = "1144556677",
                clientEmail = "cliente2@test.com",
                serviceId = serviceId,
                dateKey = targetDateKey,
                time = targetTime,
                status = AppointmentStatus.Confirmado,
                businessId = "biz_demo_123"
            )
        }

        val result1 = request1.await()
        val result2 = request2.await()

        val results = listOf(result1, result2)
        val successCount = results.count { it is ApiResult.Success }
        val conflictCount = results.count { it is ApiResult.Error && it.code == 409 }

        assertEquals("Debe haber exactamente 1 reserva confirmada exitosa", 1, successCount)
        assertEquals("Debe haber exactamente 1 rechazo con código 409 (Slot already booked)", 1, conflictCount)

        val agendaState = repository.refreshAgenda(targetDateKey, "biz_demo_123")
        assertTrue(agendaState is AgendaLoadState.Loaded)
        val loaded = (agendaState as AgendaLoadState.Loaded).appointments
        val bookingsAt16 = loaded.filter { it.time == targetTime && it.status != AppointmentStatus.Cancelado }
        assertEquals("No deben existir reservas duplicadas para las 16:00", 1, bookingsAt16.size)
    }

    @Test
    fun `bookingBufferMinutes prevents overlapping booking inside post-service buffer window`() = runBlocking {
        val targetDateKey = "2026-10-30"
        // srv_1 dura 30 min + 15 min de buffer = ventana ocupada de 10:00 a 10:45
        val first = createUseCase(
            client = "Turno Base",
            clientPhone = "1122334455",
            clientEmail = "base@test.com",
            serviceId = "srv_1",
            dateKey = targetDateKey,
            time = "10:00",
            businessId = "biz_demo_123"
        )
        assertTrue(first is ApiResult.Success)

        // Intentar reservar a las 10:35 (dentro del buffer 10:30..10:45) debe ser rechazado con 409
        val insideBuffer = createUseCase(
            client = "Turno En Buffer",
            clientPhone = "1166778899",
            clientEmail = "buffer@test.com",
            serviceId = "srv_1",
            dateKey = targetDateKey,
            time = "10:35",
            businessId = "biz_demo_123"
        )
        assertTrue(insideBuffer is ApiResult.Error)
        assertEquals(409, (insideBuffer as ApiResult.Error).code)

        // Reservar exactamente a las 10:45 (fin del buffer) debe ser permitido
        val afterBuffer = createUseCase(
            client = "Turno Post Buffer",
            clientPhone = "1199887766",
            clientEmail = "post@test.com",
            serviceId = "srv_1",
            dateKey = targetDateKey,
            time = "10:45",
            businessId = "biz_demo_123"
        )
        assertTrue("El horario inmediatamente posterior al buffer (10:45) debe estar disponible", afterBuffer is ApiResult.Success)
    }

    @Test
    fun `idempotency key prevents duplicate creation or false 409 on retry`() = runBlocking {
        val dateKey = "2026-11-02"
        val idemKey = "idem_client_req_991"

        val attempt1 = createUseCase(
            client = "Lionel Scaloni",
            clientPhone = "1144332211",
            clientEmail = "scaloni@afa.com",
            serviceId = "srv_1",
            dateKey = dateKey,
            time = "12:00",
            idempotencyKey = idemKey,
            businessId = "biz_demo_123"
        )
        assertTrue(attempt1 is ApiResult.Success)
        val firstId = (attempt1 as ApiResult.Success).data

        // Reintentar la misma petición con idéntica clave de idempotencia devuelve el mismo ID sin error 409
        val attempt2 = createUseCase(
            client = "Lionel Scaloni",
            clientPhone = "1144332211",
            clientEmail = "scaloni@afa.com",
            serviceId = "srv_1",
            dateKey = dateKey,
            time = "12:00",
            idempotencyKey = idemKey,
            businessId = "biz_demo_123"
        )
        assertTrue(attempt2 is ApiResult.Success)
        assertEquals(firstId, (attempt2 as ApiResult.Success).data)
    }
}
