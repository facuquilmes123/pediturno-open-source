package com.pediturno.servicios

import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.cancelAndJoin

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.model.BusinessProfile
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
import org.junit.Test
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

@OptIn(ExperimentalCoroutinesApi::class)
class AgendaDeepLinkRaceTest {
    @Test fun `cold-start profile response cannot replace the day selected by an app link`() = runTest {
        Dispatchers.setMain(StandardTestDispatcher(testScheduler))
        var model: AgendaViewModel? = null
        try {
            val zone = BusinessTimeZoneManager(clock = Clock.fixed(Instant.parse("2026-10-30T12:00:00Z"), ZoneOffset.UTC))
            val profileReady = CompletableDeferred<Unit>()
            val delegate = MockPediturnoRemoteDataSource(zone, networkDelayMs = 0L)
            val remote = object : PediturnoRemoteDataSource by delegate {
                override suspend fun getBusinessProfile(businessId: String): ApiResult<BusinessProfile> {
                    profileReady.await()
                    return delegate.getBusinessProfile("biz_demo_123")
                }
            }
            val repository = AgendaRepository(remote)
            val active = AgendaViewModel(repository, CreateAppointmentUseCase(repository), RescheduleAppointmentUseCase(repository), UpdateAppointmentStatusUseCase(repository), timeZoneManager = zone)
            model = active
            runCurrent()
            active.handleDeepLink(null, "2026-10-31")
            runCurrent()
            assertEquals("2026-10-31", active.uiState.value.dateKey)
            profileReady.complete(Unit)
            runCurrent()
            assertEquals("2026-10-31", active.uiState.value.dateKey)
        } finally {
            model?.clearForSessionChange()
            model?.viewModelScope?.coroutineContext?.get(Job)?.cancelAndJoin(); Dispatchers.resetMain()
        }
    }
}
