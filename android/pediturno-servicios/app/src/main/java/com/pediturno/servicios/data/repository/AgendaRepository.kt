package com.pediturno.servicios.data.repository

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.model.BusinessProfile
import com.pediturno.servicios.data.model.BookingRules
import com.pediturno.servicios.data.model.MercadoPagoConnectionStatus
import com.pediturno.servicios.data.model.AppointmentNotificationKind
import com.pediturno.servicios.data.model.DashboardSummary
import com.pediturno.servicios.data.model.ClientItem
import com.pediturno.servicios.data.model.DaySchedule
import com.pediturno.servicios.data.model.ServiceItem
import com.pediturno.servicios.data.remote.PediturnoRemoteDataSource
import com.pediturno.servicios.core.timezone.SlotAvailability
import java.io.File
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicLong
import java.security.MessageDigest
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable

sealed interface AgendaLoadState {
    data object Loading : AgendaLoadState
    data class Loaded(val appointments: List<Appointment>, val isOfflineCache: Boolean) : AgendaLoadState
    data class Error(val message: String, val code: Int = 500) : AgendaLoadState
}

class AgendaRepository(
    private val remoteDataSource: PediturnoRemoteDataSource,
    private val cacheDirectory: File? = null
) {
    private companion object {
        const val CACHE_TTL_MS = 24L * 60L * 60L * 1000L
        const val IDEMPOTENCY_TTL_MS = 24L * 60L * 60L * 1000L
    }
    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    @Serializable private data class CacheEnvelope(val savedAtMs: Long, val appointments: List<Appointment>)
    @Serializable private data class IdempotencyEnvelope(val key: String, val createdAtMs: Long)
    private val localCache = ConcurrentHashMap<String, CacheEnvelope>()
    private val idempotencyKeys = ConcurrentHashMap<String, IdempotencyEnvelope>()
    private val cacheLock = Any()
    private val cacheEpoch = AtomicLong(0)

    private val _agendaState = MutableStateFlow<AgendaLoadState>(AgendaLoadState.Loading)
    val agendaState: StateFlow<AgendaLoadState> = _agendaState.asStateFlow()

    private fun cacheKey(businessId: String, dateKey: String): String = "${businessId}_$dateKey"

    private suspend fun persistToDisk(key: String, envelope: CacheEnvelope, expectedEpoch: Long) = withContext(Dispatchers.IO) {
        val dir = cacheDirectory
        synchronized(cacheLock) { if (dir != null && expectedEpoch == cacheEpoch.get()) runCatching {
            if (!dir.exists()) dir.mkdirs()
            val file = File(dir, "agenda_cache_$key.json")
            val temporary = File(dir, "${file.name}.tmp")
            temporary.writeText(json.encodeToString(envelope))
            Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        } }
    }

    private suspend fun readFromDisk(key: String): CacheEnvelope? = withContext(Dispatchers.IO) {
        val dir = cacheDirectory ?: return@withContext null
        runCatching {
            val file = File(dir, "agenda_cache_$key.json")
            if (!file.exists()) return@withContext null
            json.decodeFromString<CacheEnvelope>(file.readText())
        }.getOrNull()
    }

    private fun isFresh(envelope: CacheEnvelope, now: Long = System.currentTimeMillis()): Boolean =
        envelope.savedAtMs in (now - CACHE_TTL_MS)..now

    private fun operationFingerprint(
        client: String, clientPhone: String, clientEmail: String, serviceId: String,
        dateKey: String, time: String, status: AppointmentStatus, businessId: String
    ): String = MessageDigest.getInstance("SHA-256").digest(
        listOf(businessId, client.trim(), clientPhone.trim(), clientEmail.trim(), serviceId, dateKey, time, status.name)
            .joinToString("\u0000").toByteArray(Charsets.UTF_8)
    ).joinToString("") { "%02x".format(it) }

    private suspend fun durableIdempotencyKey(fingerprint: String): String = withContext(Dispatchers.IO) {
        val now = System.currentTimeMillis()
        idempotencyKeys[fingerprint]?.takeIf { now - it.createdAtMs <= IDEMPOTENCY_TTL_MS }?.let { return@withContext it.key }
        val dir = cacheDirectory
        val file = dir?.let { File(it, "appointment_idempotency_$fingerprint.json") }
        val disk = file?.takeIf(File::exists)?.let { runCatching { json.decodeFromString<IdempotencyEnvelope>(it.readText()) }.getOrNull() }
        val entry = disk?.takeIf { now - it.createdAtMs <= IDEMPOTENCY_TTL_MS } ?: IdempotencyEnvelope("idem_" + UUID.randomUUID().toString(), now)
        if (disk == null || entry !== disk) if (dir != null) runCatching {
            if (!dir.exists()) dir.mkdirs()
            val temporary = File(dir, "${file!!.name}.tmp")
            temporary.writeText(json.encodeToString(entry))
            Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
        }
        idempotencyKeys[fingerprint] = entry
        entry.key
    }

    private suspend fun clearDurableIdempotency(fingerprint: String) = withContext(Dispatchers.IO) {
        idempotencyKeys.remove(fingerprint)
        cacheDirectory?.let { File(it, "appointment_idempotency_$fingerprint.json") }?.let { runCatching { it.delete() } }
    }

    suspend fun refreshAgenda(
        dateKey: String,
        businessId: String
    ): AgendaLoadState {
        _agendaState.value = AgendaLoadState.Loading
        val epoch = cacheEpoch.get()
        val key = cacheKey(businessId, dateKey)
        val result = remoteDataSource.getAppointments(dateKey, businessId)
        if (epoch != cacheEpoch.get()) return AgendaLoadState.Error("La sesión cambió. Actualizá la agenda.", 401)
        return when (result) {
            is ApiResult.Success -> {
                val list = result.data.map { it.copy(fromCache = false) }
                val envelope = CacheEnvelope(System.currentTimeMillis(), list)
                synchronized(cacheLock) { if (epoch == cacheEpoch.get()) localCache[key] = envelope }
                persistToDisk(key, envelope, epoch)
                if (epoch != cacheEpoch.get()) return AgendaLoadState.Error("La sesión cambió. Actualizá la agenda.", 401)
                val state = AgendaLoadState.Loaded(list, isOfflineCache = false)
                synchronized(cacheLock) { if (epoch == cacheEpoch.get()) _agendaState.value = state }
                state
            }
            is ApiResult.NetworkError -> {
                val cached = localCache[key] ?: readFromDisk(key)
                if (epoch != cacheEpoch.get()) return AgendaLoadState.Error("La sesión cambió. Actualizá la agenda.", 401)
                if (cached != null && isFresh(cached)) {
                    val offlineList = cached.appointments.map { it.copy(fromCache = true) }
                    val state = AgendaLoadState.Loaded(offlineList, isOfflineCache = true)
                    synchronized(cacheLock) { if (epoch == cacheEpoch.get()) _agendaState.value = state }
                    state
                } else {
                    val state = AgendaLoadState.Error("Sin conexión y sin datos previos guardados.", 0)
                    synchronized(cacheLock) { if (epoch == cacheEpoch.get()) _agendaState.value = state }
                    state
                }
            }
            is ApiResult.Error -> {
                val state = AgendaLoadState.Error(result.message, result.code)
                synchronized(cacheLock) { if (epoch == cacheEpoch.get()) _agendaState.value = state }
                state
            }
        }
    }

    suspend fun createAppointment(
        client: String,
        clientPhone: String,
        clientEmail: String,
        serviceId: String,
        dateKey: String,
        time: String,
        status: AppointmentStatus = AppointmentStatus.Confirmado,
        idempotencyKey: String? = null,
        businessId: String,
        maxRetriesOnNetworkDrop: Int = 1
    ): ApiResult<String> {
        val fingerprint = if (idempotencyKey == null) operationFingerprint(client, clientPhone, clientEmail, serviceId, dateKey, time, status, businessId) else null
        val effectiveKey = idempotencyKey ?: durableIdempotencyKey(requireNotNull(fingerprint))
        var attempt = 0
        var lastResult: ApiResult<String>
        do {
            lastResult = remoteDataSource.createAppointment(
                client = client,
                clientPhone = clientPhone,
                clientEmail = clientEmail,
                serviceId = serviceId,
                dateKey = dateKey,
                time = time,
                status = status,
                idempotencyKey = effectiveKey,
                businessId = businessId
            )
            if (lastResult !is ApiResult.NetworkError) break
            attempt++
        } while (attempt < maxRetriesOnNetworkDrop)

        if (lastResult is ApiResult.Success) {
            fingerprint?.let { clearDurableIdempotency(it) }
            refreshAgenda(dateKey, businessId)
        }
        return lastResult
    }

    suspend fun rescheduleAppointment(
        appointmentId: String,
        dateKey: String,
        time: String,
        businessId: String
    ): ApiResult<Unit> {
        val result = remoteDataSource.rescheduleAppointment(appointmentId, dateKey, time, businessId)
        if (result is ApiResult.Success) {
            refreshAgenda(dateKey, businessId)
        }
        return result
    }

    suspend fun updateAppointmentStatus(
        appointmentId: String,
        dateKey: String,
        status: AppointmentStatus,
        businessId: String
    ): ApiResult<Unit> {
        val result = remoteDataSource.updateAppointmentStatus(appointmentId, status, businessId)
        if (result is ApiResult.Success) {
            refreshAgenda(dateKey, businessId)
        }
        return result
    }

    suspend fun getServices(businessId: String): ApiResult<List<ServiceItem>> {
        return remoteDataSource.getServices(businessId)
    }

    suspend fun saveService(
        name: String,
        durationMinutes: Int,
        price: Double,
        status: String = "Activo",
        serviceId: String? = null,
        category: String = "General",
        photoUrl: String? = null,
        bookingBufferMinutes: Int? = null,
        workingHours: Map<Int, DaySchedule> = emptyMap(),
        unavailableDates: List<String> = emptyList(),
        businessId: String
    ): ApiResult<ServiceItem> {
        val epoch = cacheEpoch.get()
        val fingerprint = if (serviceId == null) MessageDigest.getInstance("SHA-256").digest(
            listOf("service", businessId, name, durationMinutes, price, status, category, photoUrl,
                bookingBufferMinutes, workingHours.toSortedMap(), unavailableDates.sorted())
                .joinToString("\u0000").toByteArray(Charsets.UTF_8)
        ).joinToString("") { "%02x".format(it) } else null
        val key = fingerprint?.let { durableIdempotencyKey(it) }
        if (epoch != cacheEpoch.get()) {
            fingerprint?.let { clearDurableIdempotency(it) }
            return ApiResult.Error(401, "La sesión cambió. Volvé a ingresar.")
        }
        val result = remoteDataSource.saveService(
            name = name,
            durationMinutes = durationMinutes,
            price = price,
            status = status,
            serviceId = serviceId,
            category = category,
            photoUrl = photoUrl,
            bookingBufferMinutes = bookingBufferMinutes,
            workingHours = workingHours,
            unavailableDates = unavailableDates,
            businessId = businessId,
            idempotencyKey = key
        )
        if (result is ApiResult.Success && fingerprint != null) clearDurableIdempotency(fingerprint)
        return result
    }

    suspend fun deleteService(
        serviceId: String,
        businessId: String
    ): ApiResult<Unit> {
        return remoteDataSource.deleteService(serviceId, businessId)
    }

    suspend fun getClients(businessId: String): ApiResult<List<ClientItem>> {
        return remoteDataSource.getClients(businessId)
    }

    suspend fun createClient(
        name: String,
        phone: String,
        email: String = "",
        notes: String = "",
        avatarUrl: String? = null,
        businessId: String
    ): ApiResult<ClientItem> {
        return remoteDataSource.createClient(name, phone, email, notes, avatarUrl, businessId)
    }

    suspend fun updateClient(
        client: ClientItem
    ): ApiResult<ClientItem> {
        return remoteDataSource.updateClient(client)
    }

    suspend fun deleteClient(clientId: String): ApiResult<Unit> = remoteDataSource.deleteClient(clientId)

    suspend fun getBusinessProfile(businessId: String): ApiResult<BusinessProfile> {
        return remoteDataSource.getBusinessProfile(businessId)
    }

    suspend fun createBusinessProfile(name: String): ApiResult<Unit> = remoteDataSource.createBusinessProfile(name)
    suspend fun getAvailability(serviceId: String, dateKey: String, excludeAppointmentId: String? = null): ApiResult<List<SlotAvailability>> = remoteDataSource.getAvailability(serviceId, dateKey, excludeAppointmentId)
    suspend fun getDashboard(monthKey: String): ApiResult<DashboardSummary> = remoteDataSource.getDashboard(monthKey)

    suspend fun updateBusinessSettings(
        leadTimeMinutes: Int,
        horizonDays: Int,
        bufferMinutes: Int,
        autoConfirm: Boolean,
        businessId: String
    ): ApiResult<BusinessProfile> {
        return remoteDataSource.updateBusinessSettings(
            leadTimeMinutes = leadTimeMinutes,
            horizonDays = horizonDays,
            bufferMinutes = bufferMinutes,
            autoConfirm = autoConfirm,
            businessId = businessId
        )
    }

    suspend fun updateFullBusinessProfile(
        profile: BusinessProfile
    ): ApiResult<BusinessProfile> {
        return remoteDataSource.updateFullBusinessProfile(profile)
    }

    suspend fun getOwnerSettings(): ApiResult<BookingRules> = remoteDataSource.getOwnerSettings()
    suspend fun updateOwnerSettings(settings: BookingRules): ApiResult<BookingRules> = remoteDataSource.updateOwnerSettings(settings)
    suspend fun getClientHistory(clientId: String): ApiResult<List<Appointment>> = remoteDataSource.getClientHistory(clientId)
    suspend fun sendAppointmentNotification(appointmentId: String, kind: AppointmentNotificationKind): ApiResult<Unit> =
        remoteDataSource.sendAppointmentNotification(appointmentId, kind)

    suspend fun checkSlugAvailability(
        slug: String,
        currentBusinessId: String
    ): ApiResult<Boolean> {
        return remoteDataSource.checkSlugAvailability(slug, currentBusinessId)
    }

    suspend fun requestAccountDeletion(reason: String): ApiResult<String> {
        return remoteDataSource.requestAccountDeletion(reason).also { result ->
            if (result is ApiResult.Success) withContext(Dispatchers.IO) { clearCachedAgenda() }
        }
    }

    suspend fun createMercadoPagoHandoff(): ApiResult<String> = remoteDataSource.createMercadoPagoHandoff()
    suspend fun getMercadoPagoStatus(): ApiResult<MercadoPagoConnectionStatus> = remoteDataSource.getMercadoPagoStatus()
    suspend fun updateMercadoPagoSettings(requireDeposit: Boolean, depositType: String, depositValue: Double): ApiResult<MercadoPagoConnectionStatus> =
        remoteDataSource.updateMercadoPagoSettings(requireDeposit, depositType, depositValue)
    suspend fun disconnectMercadoPago(): ApiResult<MercadoPagoConnectionStatus> = remoteDataSource.disconnectMercadoPago()

    /** Private app cache may contain client PII; remove it when the authenticated session ends. */
    fun clearCachedAgenda() = synchronized(cacheLock) {
        cacheEpoch.incrementAndGet()
        _agendaState.value = AgendaLoadState.Loading
        localCache.clear()
        idempotencyKeys.clear()
        cacheDirectory?.listFiles { file -> file.name.startsWith("agenda_cache_") || file.name.startsWith("appointment_idempotency_") }?.forEach { file -> runCatching { file.delete() } }
    }
}
