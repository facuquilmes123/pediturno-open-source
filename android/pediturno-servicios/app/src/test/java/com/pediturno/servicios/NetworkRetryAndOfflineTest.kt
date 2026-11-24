package com.pediturno.servicios

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.remote.MockPediturnoRemoteDataSource
import com.pediturno.servicios.data.repository.AgendaLoadState
import com.pediturno.servicios.data.repository.AgendaRepository
import com.pediturno.servicios.domain.usecase.CreateAppointmentUseCase
import java.nio.file.Files
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class NetworkRetryAndOfflineTest {

    private lateinit var timeZoneManager: BusinessTimeZoneManager
    private lateinit var remoteDataSource: MockPediturnoRemoteDataSource
    private lateinit var repository: AgendaRepository
    private lateinit var createUseCase: CreateAppointmentUseCase

    @Before
    fun setup() {
        timeZoneManager = BusinessTimeZoneManager()
        remoteDataSource = MockPediturnoRemoteDataSource(timeZoneManager, networkDelayMs = 0L)
        repository = AgendaRepository(remoteDataSource)
        createUseCase = CreateAppointmentUseCase(repository)
    }

    @Test
    fun `when network fails after initial load, agenda serves cached data marked as offline`() = runBlocking {
        val today = timeZoneManager.todayDateKey()

        val onlineState = repository.refreshAgenda(today, "biz_demo_123")
        assertTrue(onlineState is AgendaLoadState.Loaded)
        val onlineLoaded = onlineState as AgendaLoadState.Loaded
        assertTrue("En línea no debe marcarse como caché offline", !onlineLoaded.isOfflineCache)
        assertTrue(onlineLoaded.appointments.isNotEmpty())

        remoteDataSource.simulateNetworkError = true

        val offlineState = repository.refreshAgenda(today, "biz_demo_123")
        assertTrue("Debe cargar desde caché local al fallar la red", offlineState is AgendaLoadState.Loaded)
        val offlineLoaded = offlineState as AgendaLoadState.Loaded
        assertTrue("Debe marcarse explícitamente isOfflineCache = true", offlineLoaded.isOfflineCache)
        assertTrue("Los turnos deben tener fromCache = true", offlineLoaded.appointments.all { it.fromCache })
    }

    @Test
    fun `disk cache survives process death and restores offline agenda on new repository instance`() = runBlocking {
        val tempDir = Files.createTempDirectory("pediturno_cache_test").toFile()
        try {
            val today = timeZoneManager.todayDateKey()
            val repoBeforeProcessDeath = AgendaRepository(remoteDataSource, cacheDirectory = tempDir)

            val initial = repoBeforeProcessDeath.refreshAgenda(today, "biz_demo_123")
            assertTrue(initial is AgendaLoadState.Loaded)

            // Simular muerte de proceso + reinicio sin conexión
            remoteDataSource.simulateNetworkError = true
            val repoAfterProcessRestart = AgendaRepository(remoteDataSource, cacheDirectory = tempDir)

            val restoredState = repoAfterProcessRestart.refreshAgenda(today, "biz_demo_123")
            assertTrue("Debe restaurar desde disco tras reinicio de proceso offline", restoredState is AgendaLoadState.Loaded)
            val loaded = restoredState as AgendaLoadState.Loaded
            assertTrue(loaded.isOfflineCache)
            assertTrue(loaded.appointments.isNotEmpty())
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun `expired disk cache is never presented as current offline agenda`() = runBlocking {
        val tempDir = Files.createTempDirectory("pediturno_stale_cache_test").toFile()
        try {
            val today = timeZoneManager.todayDateKey()
            val writer = AgendaRepository(remoteDataSource, cacheDirectory = tempDir)
            assertTrue(writer.refreshAgenda(today, "biz_demo_123") is AgendaLoadState.Loaded)
            val cache = tempDir.listFiles()?.single { it.name.startsWith("agenda_cache_") } ?: error("cache missing")
            cache.writeText(cache.readText().replace(Regex("\\\"savedAtMs\\\":\\d+"), "\"savedAtMs\":0"))

            remoteDataSource.simulateNetworkError = true
            val afterRestart = AgendaRepository(remoteDataSource, cacheDirectory = tempDir).refreshAgenda(today, "biz_demo_123")
            assertTrue(afterRestart is AgendaLoadState.Error)
            assertFalse((afterRestart as AgendaLoadState.Error).message.contains("turnos", ignoreCase = true))
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun `network failure keeps a durable retry key for the same appointment operation`() = runBlocking {
        val tempDir = Files.createTempDirectory("pediturno_idempotency_test").toFile()
        try {
            remoteDataSource.simulateNetworkError = true
            val first = AgendaRepository(remoteDataSource, cacheDirectory = tempDir).createAppointment(
                client = "Reintento", clientPhone = "11112222", clientEmail = "retry@example.test",
                serviceId = "srv_1", dateKey = "2026-11-13", time = "11:00", businessId = "biz_demo_123"
            )
            assertTrue(first is ApiResult.NetworkError)
            assertTrue(tempDir.listFiles()?.any { it.name.startsWith("appointment_idempotency_") } == true)

            remoteDataSource.simulateNetworkError = false
            val retry = AgendaRepository(remoteDataSource, cacheDirectory = tempDir).createAppointment(
                client = "Reintento", clientPhone = "11112222", clientEmail = "retry@example.test",
                serviceId = "srv_1", dateKey = "2026-11-13", time = "11:00", businessId = "biz_demo_123"
            )
            assertTrue(retry is ApiResult.Success)
            assertFalse(tempDir.listFiles()?.any { it.name.startsWith("appointment_idempotency_") } == true)
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun `creating appointment offline fails and does not produce false confirmation`() = runBlocking {
        val dateKey = LocalDate.parse(timeZoneManager.todayDateKey()).plusDays(2).toString()
        remoteDataSource.simulateNetworkError = true

        val result = createUseCase(
            client = "Cliente Sin Red",
            clientPhone = "1133445566",
            clientEmail = "offline@test.com",
            serviceId = "srv_1",
            dateKey = dateKey,
            time = "10:00",
            status = AppointmentStatus.Confirmado,
            businessId = "biz_demo_123"
        )

        assertTrue("Debe retornar NetworkError", result is ApiResult.NetworkError)

        remoteDataSource.simulateNetworkError = false
        val state = repository.refreshAgenda(dateKey, "biz_demo_123")
        assertTrue(state is AgendaLoadState.Loaded)
        val appointments = (state as AgendaLoadState.Loaded).appointments
        assertTrue("No debe haberse confirmado ninguna reserva", appointments.isEmpty())
    }

    @Test
    fun `expired session returns 401 Authentication Required`() = runBlocking {
        val today = timeZoneManager.todayDateKey()
        remoteDataSource.simulateAuthExpired = true

        val result = repository.refreshAgenda(today, "biz_demo_123")
        assertTrue("Debe reportar error cuando la sesión caduca", result is AgendaLoadState.Error)
        val err = result as AgendaLoadState.Error
        assertEquals("Authentication required", err.message)
        assertEquals(401, err.code)
    }
}
