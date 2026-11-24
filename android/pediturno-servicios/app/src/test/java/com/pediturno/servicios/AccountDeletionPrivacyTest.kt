package com.pediturno.servicios

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.model.BusinessProfile
import com.pediturno.servicios.data.remote.MockPediturnoRemoteDataSource
import com.pediturno.servicios.data.remote.PediturnoRemoteDataSource
import com.pediturno.servicios.data.repository.AgendaLoadState
import com.pediturno.servicios.data.repository.AgendaRepository
import com.pediturno.servicios.domain.usecase.CreateAppointmentUseCase
import com.pediturno.servicios.domain.usecase.RescheduleAppointmentUseCase
import com.pediturno.servicios.domain.usecase.UpdateAppointmentStatusUseCase
import com.pediturno.servicios.ui.agenda.AgendaViewModel
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.*
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files

@OptIn(ExperimentalCoroutinesApi::class)
class AccountDeletionPrivacyTest {
    private val appointment = Appointment("private-a", "Cliente privado", "11111111", serviceId = "s", service = "Servicio", dateKey = "2026-10-31", time = "10:00", durationMinutes = 60, priceAtBooking = 100.0, status = AppointmentStatus.Confirmado, businessId = "owner-a")

    @Test fun `accepted deletion wipes owned disk caches and rejects a late agenda response`() = runBlocking {
        val delegate = MockPediturnoRemoteDataSource(BusinessTimeZoneManager(), networkDelayMs = 0)
        val late = CompletableDeferred<ApiResult<List<Appointment>>>()
        var delayResponse = false
        val remote = object : PediturnoRemoteDataSource by delegate {
            override suspend fun getAppointments(dateKey: String, businessId: String): ApiResult<List<Appointment>> = if (delayResponse) late.await() else ApiResult.Success(listOf(appointment))
            override suspend fun requestAccountDeletion(reason: String): ApiResult<String> = ApiResult.Success("deletion-ticket")
        }
        val directory = Files.createTempDirectory("accepted-deletion-cache").toFile()
        try {
            val repository = AgendaRepository(remote, directory)
            repository.refreshAgenda("2026-10-31", "owner-a")
            directory.resolve("appointment_idempotency_private.json").writeText("synthetic")
            directory.resolve("unrelated.txt").writeText("keep")
            delayResponse = true
            val pending = async(start = CoroutineStart.UNDISPATCHED) { repository.refreshAgenda("2026-10-31", "owner-a") }
            assertEquals(ApiResult.Success("deletion-ticket"), repository.requestAccountDeletion(""))
            late.complete(ApiResult.Success(listOf(appointment)))
            assertTrue(pending.await() is AgendaLoadState.Error)
            assertTrue(repository.agendaState.value is AgendaLoadState.Loading)
            assertEquals(listOf("unrelated.txt"), directory.listFiles().orEmpty().map { it.name })
        } finally { directory.deleteRecursively() }
    }

    @Test fun `rejected deletion keeps the current account cache`() = runBlocking {
        val delegate = MockPediturnoRemoteDataSource(BusinessTimeZoneManager(), networkDelayMs = 0)
        val remote = object : PediturnoRemoteDataSource by delegate {
            override suspend fun getAppointments(dateKey: String, businessId: String): ApiResult<List<Appointment>> = ApiResult.Success(listOf(appointment))
            override suspend fun requestAccountDeletion(reason: String): ApiResult<String> = ApiResult.Error(403, "REAUTH_REQUIRED")
        }
        val directory = Files.createTempDirectory("rejected-deletion-cache").toFile()
        try {
            val repository = AgendaRepository(remote, directory)
            repository.refreshAgenda("2026-10-31", "owner-a")
            assertTrue(repository.requestAccountDeletion("") is ApiResult.Error)
            assertTrue(repository.agendaState.value is AgendaLoadState.Loaded)
            assertTrue(directory.listFiles().orEmpty().any { it.name.startsWith("agenda_cache_") })
        } finally { directory.deleteRecursively() }
    }

    @Test fun `accepted deletion clears private workspace state and cancels late profile loads`() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        var model: AgendaViewModel? = null
        try {
            val zone = BusinessTimeZoneManager()
            val delegate = MockPediturnoRemoteDataSource(zone, networkDelayMs = 0)
            val lateProfile = CompletableDeferred<Unit>()
            var holdProfile = false
            val remote = object : PediturnoRemoteDataSource by delegate {
                override suspend fun getBusinessProfile(businessId: String): ApiResult<BusinessProfile> {
                    if (holdProfile) lateProfile.await()
                    return delegate.getBusinessProfile("biz_demo_123")
                }
                override suspend fun requestAccountDeletion(reason: String): ApiResult<String> = ApiResult.Success("deletion-ticket")
            }
            val repository = AgendaRepository(remote)
            val active = AgendaViewModel(repository, CreateAppointmentUseCase(repository), RescheduleAppointmentUseCase(repository), UpdateAppointmentStatusUseCase(repository), timeZoneManager = zone)
            model = active
            active.refreshAllWorkspaceData(businessId = "biz_demo_123")
            runCurrent()
            assertTrue(active.uiState.value.businessProfile.name.isNotBlank())
            holdProfile = true
            active.refreshAllWorkspaceData(businessId = "biz_demo_123")
            runCurrent()
            active.requestAccountDeletion("")
            val cleared = active.uiState.first { it.lastDeletionTicket == "deletion-ticket" }
            assertEquals("", cleared.businessProfile.name)
            assertTrue(cleared.clients.isEmpty())
            assertTrue(cleared.services.isEmpty())
            assertNull(cleared.selectedClient)
            lateProfile.complete(Unit)
            runCurrent()
            assertEquals("", active.uiState.value.businessProfile.name)
        } finally { model?.clearForSessionChange(); model?.viewModelScope?.coroutineContext?.get(Job)?.cancelAndJoin(); Dispatchers.resetMain() }
    }
}
