package com.pediturno.servicios

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.remote.PediturnoRemoteDataSource
import com.pediturno.servicios.data.remote.MockPediturnoRemoteDataSource
import com.pediturno.servicios.data.repository.AgendaRepository
import com.pediturno.servicios.data.repository.AgendaLoadState
import kotlinx.coroutines.*
import java.nio.file.Files
import org.junit.Test
import org.junit.Assert.*

class SessionCacheRaceTest {
    @Test fun `logout rejects late data and never repopulates the cache`() = runBlocking {
        val response = CompletableDeferred<ApiResult<List<Appointment>>>()
        val delegate = MockPediturnoRemoteDataSource(BusinessTimeZoneManager(), networkDelayMs = 0L)
        val remote = object : PediturnoRemoteDataSource by delegate {
            override suspend fun getAppointments(dateKey: String, businessId: String): ApiResult<List<Appointment>> = response.await()
        }
        val directory = Files.createTempDirectory("session-cache-race").toFile()
        try {
            val repository = AgendaRepository(remote, directory)
            val pending = async(start = CoroutineStart.UNDISPATCHED) { repository.refreshAgenda("2026-10-28", "owner-a") }
            repository.clearCachedAgenda()
            response.complete(ApiResult.Success(emptyList()))
            assertTrue(pending.await() is AgendaLoadState.Error)
            assertTrue(repository.agendaState.value is AgendaLoadState.Loading)
            assertTrue(directory.listFiles().orEmpty().isEmpty())
        } finally { directory.deleteRecursively() }
    }
}
