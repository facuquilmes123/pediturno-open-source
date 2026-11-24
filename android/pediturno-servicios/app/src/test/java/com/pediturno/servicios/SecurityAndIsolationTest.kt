package com.pediturno.servicios

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.remote.HttpPediturnoRemoteDataSource
import com.pediturno.servicios.data.remote.MockPediturnoRemoteDataSource
import com.pediturno.servicios.data.repository.PushRepository
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class SecurityAndIsolationTest {

    private lateinit var timeZoneManager: BusinessTimeZoneManager
    private lateinit var mockRemote: MockPediturnoRemoteDataSource

    @Before
    fun setup() {
        timeZoneManager = BusinessTimeZoneManager()
        mockRemote = MockPediturnoRemoteDataSource(timeZoneManager, networkDelayMs = 0L)
    }

    @Test
    fun `business A cannot read, reschedule or cancel appointments belonging to business B`() = runBlocking {
        val today = timeZoneManager.todayDateKey()

        // Business A ("biz_demo_123") consulta su agenda y no debe ver "apt_other_901" de "biz_other_999"
        val agendaBizA = mockRemote.getAppointments(today, businessId = "biz_demo_123")
        assertTrue(agendaBizA is ApiResult.Success)
        val listA = (agendaBizA as ApiResult.Success).data
        assertTrue(listA.none { it.id == "apt_other_901" || it.businessId == "biz_other_999" })

        // Intentar reprogramar "apt_other_901" desde la sesión de "biz_demo_123" debe devolver 404
        val crossReschedule = mockRemote.rescheduleAppointment(
            appointmentId = "apt_other_901",
            dateKey = today,
            time = "15:00",
            businessId = "biz_demo_123"
        )
        assertTrue(crossReschedule is ApiResult.Error)
        assertEquals(404, (crossReschedule as ApiResult.Error).code)

        // Intentar cancelar "apt_other_901" desde "biz_demo_123" debe devolver 404
        val crossCancel = mockRemote.updateAppointmentStatus(
            appointmentId = "apt_other_901",
            status = AppointmentStatus.Cancelado,
            businessId = "biz_demo_123"
        )
        assertTrue(crossCancel is ApiResult.Error)
        assertEquals(404, (crossCancel as ApiResult.Error).code)
    }

    @Test
    fun `expired membership blocks mutations with 403 while preserving read access`() = runBlocking {
        val today = timeZoneManager.todayDateKey()
        mockRemote.simulateMembershipExpired = true

        // La lectura de agenda sigue disponible para consulta del dueño
        val readResult = mockRemote.getAppointments(today, businessId = "biz_demo_123")
        assertTrue(readResult is ApiResult.Success)

        // Las mutaciones son bloqueadas con 403 Active membership required
        val createAttempt = mockRemote.createAppointment(
            client = "Cliente Bloqueado",
            clientPhone = "1122334455",
            clientEmail = "test@test.com",
            serviceId = "srv_1",
            dateKey = today,
            time = "16:00",
            businessId = "biz_demo_123"
        )
        assertTrue(createAttempt is ApiResult.Error)
        val errorAttempt = createAttempt as ApiResult.Error
        assertEquals(403, errorAttempt.code)
        assertEquals("Active membership required", errorAttempt.message)
    }

    @Test
    fun `ProductionGuardInterceptor blocks mutating HTTP requests to pediturno_com in debug mode`() = runBlocking {
        val httpDataSource = HttpPediturnoRemoteDataSource(
            baseUrl = "https://pediturno.com/api",
            tokenProvider = { "mock_jwt_token" },
            allowProductionMutations = false
        )

        val postResult = httpDataSource.createAppointment(
            businessId = "biz_demo_123",
            client = "Test Guard",
            clientPhone = "1144556677",
            clientEmail = "guard@test.com",
            serviceId = "srv_1",
            dateKey = "2026-10-30",
            time = "10:00"
        )

        assertTrue("El guardarraíl debe bloquear mutaciones a producción con 403", postResult is ApiResult.Error)
        val err = postResult as ApiResult.Error
        assertEquals(403, err.code)
        assertTrue(err.message.contains("Production mutation blocked"))
    }

    @Test
    fun `FCM token registration and logout unregistration lifecycle`() = runBlocking {
        val pushRepository = PushRepository(mockRemote)

        val regResult = pushRepository.registerToken("token_initial_123")
        assertTrue(regResult is ApiResult.Success)
        assertTrue(mockRemote.isTokenRegistered("token_initial_123"))

        val unregResult = pushRepository.unregisterCurrentToken()
        assertTrue(unregResult is ApiResult.Success)
        assertFalse(mockRemote.isTokenRegistered("token_initial_123"))
    }
}
