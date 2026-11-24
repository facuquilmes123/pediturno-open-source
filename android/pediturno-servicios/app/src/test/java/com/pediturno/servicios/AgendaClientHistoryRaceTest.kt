package com.pediturno.servicios

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.remote.MockPediturnoRemoteDataSource
import com.pediturno.servicios.data.remote.PediturnoRemoteDataSource
import com.pediturno.servicios.data.repository.AgendaRepository
import com.pediturno.servicios.domain.usecase.CreateAppointmentUseCase
import com.pediturno.servicios.domain.usecase.RescheduleAppointmentUseCase
import com.pediturno.servicios.domain.usecase.UpdateAppointmentStatusUseCase
import com.pediturno.servicios.ui.agenda.AgendaViewModel
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class AgendaClientHistoryRaceTest {
    private var ownedModel: AgendaViewModel? = null
    private fun appointment(id: String, clientId: String) = Appointment(
        id = id, client = "Cliente $clientId", clientPhone = "110000000$clientId",
        serviceId = "srv_1", service = "Servicio QA", dateKey = "2026-10-30", time = "10:00",
        durationMinutes = 30, priceAtBooking = 1000.0, status = AppointmentStatus.Confirmado,
        businessId = "biz_demo_123"
    )

    private fun viewModel(
        a: CompletableDeferred<ApiResult<List<Appointment>>>,
        b: CompletableDeferred<ApiResult<List<Appointment>>>
    ): AgendaViewModel {
        val delegate = MockPediturnoRemoteDataSource(BusinessTimeZoneManager(), networkDelayMs = 0L)
        val remote = object : PediturnoRemoteDataSource by delegate {
            override suspend fun getClientHistory(clientId: String): ApiResult<List<Appointment>> = when (clientId) {
                "client-a" -> a.await()
                "client-b" -> b.await()
                else -> ApiResult.Error(404, "Cliente no encontrado")
            }
        }
        val repository = AgendaRepository(remote)
        return AgendaViewModel(
            agendaRepository = repository,
            createAppointmentUseCase = CreateAppointmentUseCase(repository),
            rescheduleAppointmentUseCase = RescheduleAppointmentUseCase(repository),
            updateAppointmentStatusUseCase = UpdateAppointmentStatusUseCase(repository)
        ).also { ownedModel = it }
    }

    @Test
    fun `late successful history from client A cannot replace client B`() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val a = CompletableDeferred<ApiResult<List<Appointment>>>()
            val b = CompletableDeferred<ApiResult<List<Appointment>>>()
            val model = viewModel(a, b)
            runCurrent()
            model.loadClientHistory("client-a")
            model.loadClientHistory("client-b")
            runCurrent()

            b.complete(ApiResult.Success(listOf(appointment("b-1", "b"))))
            runCurrent()
            a.complete(ApiResult.Success(listOf(appointment("a-1", "a"))))
            runCurrent()

            assertEquals("client-b", model.clientHistoryUiState.value.clientId)
            assertEquals(listOf("b-1"), model.clientHistoryUiState.value.appointments.map { it.id })
            assertNull(model.clientHistoryUiState.value.error)
        } finally {
            ownedModel?.viewModelScope?.coroutineContext?.get(Job)?.cancelAndJoin()
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `late failed history from client A cannot leave client B loading or errored`() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val a = CompletableDeferred<ApiResult<List<Appointment>>>()
            val b = CompletableDeferred<ApiResult<List<Appointment>>>()
            val model = viewModel(a, b)
            runCurrent()
            model.loadClientHistory("client-a")
            model.loadClientHistory("client-b")
            runCurrent()

            b.complete(ApiResult.Success(listOf(appointment("b-1", "b"))))
            runCurrent()
            a.complete(ApiResult.Error(503, "Fallo tardío de A"))
            runCurrent()

            assertEquals("client-b", model.clientHistoryUiState.value.clientId)
            assertEquals(listOf("b-1"), model.clientHistoryUiState.value.appointments.map { it.id })
            assertFalse(model.clientHistoryUiState.value.isLoading)
            assertNull(model.clientHistoryUiState.value.error)
        } finally {
            ownedModel?.viewModelScope?.coroutineContext?.get(Job)?.cancelAndJoin()
            Dispatchers.resetMain()
        }
    }

    @Test
    fun `session clear invalidates and resets pending history`() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        try {
            val a = CompletableDeferred<ApiResult<List<Appointment>>>()
            val b = CompletableDeferred<ApiResult<List<Appointment>>>()
            val model = viewModel(a, b)
            runCurrent()
            model.loadClientHistory("client-a")
            runCurrent()
            model.clearForSessionChange()
            a.complete(ApiResult.Success(listOf(appointment("a-1", "a"))))
            runCurrent()

            assertNull(model.clientHistoryUiState.value.clientId)
            assertTrue(model.clientHistoryUiState.value.appointments.isEmpty())
            assertFalse(model.clientHistoryUiState.value.isLoading)
            assertNull(model.clientHistoryUiState.value.error)
        } finally {
            ownedModel?.viewModelScope?.coroutineContext?.get(Job)?.cancelAndJoin()
            Dispatchers.resetMain()
        }
    }
}
