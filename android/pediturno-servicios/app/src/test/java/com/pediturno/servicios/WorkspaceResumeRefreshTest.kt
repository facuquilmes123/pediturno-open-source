package com.pediturno.servicios

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.model.BusinessProfile
import com.pediturno.servicios.data.model.MembershipInfo
import com.pediturno.servicios.data.remote.MockPediturnoRemoteDataSource
import com.pediturno.servicios.data.remote.PediturnoRemoteDataSource
import com.pediturno.servicios.data.repository.AgendaLoadState
import com.pediturno.servicios.data.repository.AgendaRepository
import com.pediturno.servicios.domain.usecase.CreateAppointmentUseCase
import com.pediturno.servicios.domain.usecase.RescheduleAppointmentUseCase
import com.pediturno.servicios.domain.usecase.UpdateAppointmentStatusUseCase
import com.pediturno.servicios.ui.agenda.AgendaViewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

@OptIn(ExperimentalCoroutinesApi::class)
class WorkspaceResumeRefreshTest {
    @Test fun `return from background updates month quota and web bookings without discarding a draft`() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        var model: AgendaViewModel? = null
        try {
            val zone = BusinessTimeZoneManager(clock = Clock.fixed(Instant.parse("2026-11-01T12:00:00Z"), ZoneOffset.UTC))
            val delegate = MockPediturnoRemoteDataSource(zone, networkDelayMs = 0L)
            val base = (delegate.getBusinessProfile("biz_demo_123") as ApiResult.Success<BusinessProfile>).data
            var profile = base.copy(membership = MembershipInfo(currentMonthUsage = 3, currentMonthKey = "2026-10"))
            var appointments = emptyList<Appointment>()
            val remote = object : PediturnoRemoteDataSource by delegate {
                override suspend fun getBusinessProfile(businessId: String): ApiResult<BusinessProfile> = ApiResult.Success(profile)
                override suspend fun getAppointments(dateKey: String, businessId: String): ApiResult<List<Appointment>> =
                    ApiResult.Success(appointments.filter { it.dateKey == dateKey })
            }
            val repository = AgendaRepository(remote)
            val active = AgendaViewModel(repository, CreateAppointmentUseCase(repository), RescheduleAppointmentUseCase(repository), UpdateAppointmentStatusUseCase(repository), timeZoneManager = zone)
            model = active
            runCurrent()
            active.handleDeepLink(null, "2026-11-03")
            active.openCreateDialog()
            runCurrent()
            assertEquals(3, active.uiState.value.businessProfile.membership.currentMonthUsage)
            assertTrue(active.uiState.value.isCreateDialogOpen)

            profile = profile.copy(membership = MembershipInfo(currentMonthUsage = 0, currentMonthKey = "2026-11"))
            appointments = listOf(Appointment(id = "web-booking", client = "Synthetic", clientPhone = "", serviceId = "service", service = "Service", dateKey = "2026-11-03", time = "10:00", durationMinutes = 30, priceAtBooking = 100.0, status = AppointmentStatus.Confirmado, businessId = base.id))
            active.onWorkspaceResumed()
            runCurrent()
            // Repository cache IO is outside the virtual Main dispatcher. Wait
            // for its visible outcome instead of asserting while IO is pending.
            withContext(Dispatchers.Default) {
                withTimeout(5_000) {
                    active.uiState.first { state ->
                        (state.loadState as? AgendaLoadState.Loaded)?.appointments?.any { it.id == "web-booking" } == true
                    }
                }
            }

            assertEquals(0, active.uiState.value.businessProfile.membership.currentMonthUsage)
            assertEquals("2026-11", active.uiState.value.businessProfile.membership.currentMonthKey)
            assertEquals("2026-11-03", active.uiState.value.dateKey)
            assertTrue(active.uiState.value.isCreateDialogOpen)
            val loaded = active.uiState.value.loadState as AgendaLoadState.Loaded
            assertEquals(listOf("web-booking"), loaded.appointments.map { it.id })
        } finally {
            model?.clearForSessionChange()
            model?.viewModelScope?.coroutineContext?.get(Job)?.cancelAndJoin(); Dispatchers.resetMain()
        }
    }
}
