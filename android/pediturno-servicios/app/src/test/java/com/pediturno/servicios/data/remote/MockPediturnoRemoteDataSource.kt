package com.pediturno.servicios.data.remote

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.model.Address
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.model.BookingRules
import com.pediturno.servicios.data.model.BusinessProfile
import com.pediturno.servicios.data.model.ClientItem
import com.pediturno.servicios.data.model.CustomThemeColors
import com.pediturno.servicios.data.model.DaySchedule
import com.pediturno.servicios.data.model.DayScheduleSlot
import com.pediturno.servicios.data.model.GeoLocation
import com.pediturno.servicios.data.model.MembershipInfo
import com.pediturno.servicios.data.model.MercadoPagoSettings
import com.pediturno.servicios.data.model.MercadoPagoConnectionStatus
import com.pediturno.servicios.data.model.AppointmentNotificationKind
import com.pediturno.servicios.data.model.DashboardSummary
import com.pediturno.servicios.data.model.ServiceItem
import com.pediturno.servicios.data.model.SocialLink
import com.pediturno.servicios.data.model.SocialLinkType
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

class MockPediturnoRemoteDataSource(
    private val timeZoneManager: BusinessTimeZoneManager = BusinessTimeZoneManager(),
    private val networkDelayMs: Long = 40L
) : PediturnoRemoteDataSource {

    var simulateNetworkError: Boolean = false
    var simulateAuthExpired: Boolean = false
    var simulateMembershipExpired: Boolean = false

    private val mutex = Mutex()
    private val appointments = ConcurrentHashMap<String, Appointment>()
    private val services = ConcurrentHashMap<String, ServiceItem>()
    private val clients = ConcurrentHashMap<String, ClientItem>()
    private val businesses = ConcurrentHashMap<String, BusinessProfile>()
    private val registeredDeviceTokens = ConcurrentHashMap.newKeySet<String>()
    private val idempotencyLedger = ConcurrentHashMap<String, String>()

    init {
        seedInitialData()
    }

    private fun seedInitialData() {
        val primaryBizId = "biz_demo_123"
        val secondaryBizId = "biz_other_999"
        val today = timeZoneManager.todayDateKey()

        businesses[primaryBizId] = BusinessProfile(
            id = primaryBizId,
            name = "Barbería & Spa Centro",
            slug = "barberia-centro",
            businessType = "services",
            timeZone = "America/Argentina/Buenos_Aires",
            email = "contacto@barberiacentro.com",
            description = "Especialistas en barbería clásica, corte con navaja, perfilado de barba y cuidado masculino premium.",
            logoUrl = null,
            phone = "+54 9 11 4455-6677",
            whatsappButtonEnabled = true,
            whatsappNumber = "+54 9 11 4455-6677",
            address = Address("Av. Santa Fe", "3240", "Palermo", "CABA", "1425", "Argentina"),
            location = GeoLocation(-34.5885, -58.4103),
            socialLinks = listOf(
                SocialLink("sl_1", SocialLinkType.INSTAGRAM, "https://instagram.com/barberiacentro", "Instagram"),
                SocialLink("sl_2", SocialLinkType.WEBSITE, "https://barberiacentro.com", "Sitio Web")
            ),
            theme = "menta",
            bookingRules = BookingRules(
                leadTimeHours = 2,
                horizonDays = 30,
                bufferMinutes = 15,
                autoConfirm = true,
                notifyNewByEmail = true,
                notificationEmail = "alertas@barberiacentro.com"
            ),
            mercadopago = MercadoPagoSettings(
                isConnected = true,
                requireDeposit = true,
                depositType = "percentage",
                depositValue = 30.0
            ),
            workingHoursSummary = "Lun a Sáb • 09:00 a 20:00",
            openTime = "09:00",
            closeTime = "20:00",
            membership = MembershipInfo(
                planName = "Pro Servicios",
                status = "active",
                source = "WEB_LEGACY",
                daysRemaining = 24,
                expiresAtIso = "2026-11-18T23:59:59Z"
            )
        )

        businesses[secondaryBizId] = BusinessProfile(
            id = secondaryBizId,
            name = "Estética Lumina Recoleta",
            slug = "estetica-lumina",
            businessType = "services",
            timeZone = "America/Argentina/Buenos_Aires",
            email = "lumina@pediturno.com",
            description = "Tratamientos cosmetológicos avanzados y dermatología estética facial.",
            phone = "+54 9 11 9988-7766",
            address = Address("Av. Alvear", "1850", "Recoleta", "CABA", "1129", "Argentina"),
            location = GeoLocation(-34.5912, -58.3889),
            socialLinks = listOf(
                SocialLink("sl_3", SocialLinkType.INSTAGRAM, "https://instagram.com/esteticalumina", "Instagram")
            ),
            theme = "lavanda",
            bookingRules = BookingRules(
                leadTimeHours = 4,
                horizonDays = 45,
                bufferMinutes = 20,
                autoConfirm = false
            ),
            mercadopago = MercadoPagoSettings(
                isConnected = false,
                requireDeposit = false
            ),
            workingHoursSummary = "Mar a Sáb • 10:00 a 19:00",
            openTime = "10:00",
            closeTime = "19:00",
            membership = MembershipInfo(
                planName = "Pro Servicios",
                status = "active",
                source = "GOOGLE_PLAY",
                daysRemaining = 29,
                expiresAtIso = "2026-11-23T23:59:59Z"
            )
        )

        val defaultWeeklySchedule = mapOf(
            1 to DaySchedule(listOf(DayScheduleSlot("09:00", "13:00"), DayScheduleSlot("14:30", "20:00"))),
            2 to DaySchedule(listOf(DayScheduleSlot("09:00", "13:00"), DayScheduleSlot("14:30", "20:00"))),
            3 to DaySchedule(listOf(DayScheduleSlot("09:00", "13:00"), DayScheduleSlot("14:30", "20:00"))),
            4 to DaySchedule(listOf(DayScheduleSlot("09:00", "13:00"), DayScheduleSlot("14:30", "20:00"))),
            5 to DaySchedule(listOf(DayScheduleSlot("09:00", "13:00"), DayScheduleSlot("14:30", "20:00"))),
            6 to DaySchedule(listOf(DayScheduleSlot("09:00", "18:00")))
        )

        val srv1 = ServiceItem("srv_1", "Corte Clásico", 30, 8000.0, "Activo", primaryBizId, "Peluquería", requiresDeposit = true, workingHours = defaultWeeklySchedule)
        val srv2 = ServiceItem("srv_2", "Barba y Perfilado", 20, 5000.0, "Activo", primaryBizId, "Barbería", workingHours = defaultWeeklySchedule)
        val srv3 = ServiceItem("srv_3", "Corte + Barba Premium", 50, 12000.0, "Activo", primaryBizId, "Combo", requiresDeposit = true, workingHours = defaultWeeklySchedule)
        val srv4 = ServiceItem("srv_4", "Coloración y Textura", 60, 18500.0, "Inactivo", primaryBizId, "Color", workingHours = defaultWeeklySchedule)
        val srvOther = ServiceItem("srv_lum_1", "Limpieza Facial Deep", 45, 22000.0, "Activo", secondaryBizId, "Facial", workingHours = defaultWeeklySchedule)

        services[srv1.id] = srv1
        services[srv2.id] = srv2
        services[srv3.id] = srv3
        services[srv4.id] = srv4
        services[srvOther.id] = srvOther

        val apt1 = Appointment(
            id = "apt_101",
            client = "Martín Palermo",
            clientPhone = "1144556677",
            clientEmail = "martin@example.com",
            serviceId = srv1.id,
            service = srv1.name,
            dateKey = today,
            time = "10:00",
            durationMinutes = srv1.durationMinutes,
            bookingBufferMinutes = 15,
            priceAtBooking = srv1.price,
            status = AppointmentStatus.Confirmado,
            businessId = primaryBizId,
            paymentStatus = "paid",
            depositAmount = 2400.0,
            depositPaid = 2400.0,
            notes = "Degradé medio con navaja."
        )
        val apt2 = Appointment(
            id = "apt_102",
            client = "Carlos Tevez",
            clientPhone = "1133221100",
            clientEmail = "carlos@example.com",
            serviceId = srv3.id,
            service = srv3.name,
            dateKey = today,
            time = "11:30",
            durationMinutes = srv3.durationMinutes,
            bookingBufferMinutes = 15,
            priceAtBooking = srv3.price,
            status = AppointmentStatus.Pendiente,
            businessId = primaryBizId,
            paymentStatus = "pending",
            depositAmount = 3600.0,
            notes = "Toalla caliente + óleo de argán."
        )
        val apt3 = Appointment(
            id = "apt_103",
            client = "Juan Román Riquelme",
            clientPhone = "1155443322",
            clientEmail = "roman@example.com",
            serviceId = srv2.id,
            service = srv2.name,
            dateKey = today,
            time = "13:00",
            durationMinutes = srv2.durationMinutes,
            bookingBufferMinutes = 15,
            priceAtBooking = srv2.price,
            status = AppointmentStatus.Completado,
            businessId = primaryBizId,
            paymentStatus = "paid",
            depositAmount = 1500.0,
            depositPaid = 1500.0,
            notes = "Cliente frecuente VIP."
        )
        val aptOther = Appointment(
            id = "apt_other_901",
            client = "Valeria Mazza",
            clientPhone = "1177889900",
            clientEmail = "valeria@example.com",
            serviceId = srvOther.id,
            service = srvOther.name,
            dateKey = today,
            time = "11:00",
            durationMinutes = srvOther.durationMinutes,
            bookingBufferMinutes = 15,
            priceAtBooking = srvOther.price,
            status = AppointmentStatus.Confirmado,
            businessId = secondaryBizId
        )

        appointments[apt1.id] = apt1
        appointments[apt2.id] = apt2
        appointments[apt3.id] = apt3
        appointments[aptOther.id] = aptOther

        clients["cli_1"] = ClientItem("cli_1", "Martín Palermo", "1144556677", "martin@example.com", null, 9, today, "Prefiere turno matutino", primaryBizId)
        clients["cli_2"] = ClientItem("cli_2", "Carlos Tevez", "1133221100", "carlos@example.com", null, 4, today, "Corte + barba completo", primaryBizId)
        clients["cli_3"] = ClientItem("cli_3", "Juan Román Riquelme", "1155443322", "roman@example.com", null, 14, today, "Toma café antes del servicio", primaryBizId)
        clients["cli_other_1"] = ClientItem("cli_other_1", "Valeria Mazza", "1177889900", "valeria@example.com", null, 3, today, "", secondaryBizId)
    }

    private fun checkGuardrails(requireActiveMembership: Boolean = true): ApiResult.Error? {
        if (simulateAuthExpired) return ApiResult.Error(401, "Authentication required")
        if (requireActiveMembership && simulateMembershipExpired) {
            return ApiResult.Error(403, "Active membership required")
        }
        return null
    }

    override suspend fun getAppointments(
        dateKey: String,
        businessId: String
    ): ApiResult<List<Appointment>> {
        val guardError = checkGuardrails(requireActiveMembership = false)
        if (guardError != null) return guardError
        if (networkDelayMs > 0) delay(networkDelayMs)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida con el servidor"))

        return ApiResult.Success(
            appointments.values
                .filter { it.businessId == businessId && it.dateKey == dateKey }
                .sortedBy { it.time }
        )
    }

    override suspend fun createAppointment(
        client: String,
        clientPhone: String,
        clientEmail: String,
        serviceId: String,
        dateKey: String,
        time: String,
        status: AppointmentStatus,
        idempotencyKey: String?,
        businessId: String
    ): ApiResult<String> {
        val guardError = checkGuardrails(requireActiveMembership = true)
        if (guardError != null) return guardError
        if (networkDelayMs > 0) delay(networkDelayMs)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida con el servidor"))

        val service = services[serviceId]
            ?: return ApiResult.Error(404, "Service $serviceId not found")
        if (service.businessId != businessId) {
            return ApiResult.Error(403, "Service does not belong to active business")
        }

        return mutex.withLock {
            if (!idempotencyKey.isNullOrBlank() && idempotencyLedger.containsKey(idempotencyKey)) {
                return@withLock ApiResult.Success(idempotencyLedger[idempotencyKey]!!)
            }

            val bufferMinutes = service.effectiveBufferMinutes
            val newStart = timeZoneManager.minutesFromMidnight(time)
            val newEnd = newStart + service.durationMinutes + bufferMinutes

            val hasOverlap = appointments.values
                .filter { it.businessId == businessId && it.dateKey == dateKey && it.status != AppointmentStatus.Cancelado }
                .any { existing ->
                    val existingStart = timeZoneManager.minutesFromMidnight(existing.time)
                    val existingEnd = existingStart + existing.durationMinutes + existing.bookingBufferMinutes
                    newStart < existingEnd && newEnd > existingStart
                }

            if (hasOverlap) {
                return@withLock ApiResult.Error(409, "Conflicto de horario: el slot $time ya está reservado o bloqueado por buffer.")
            }

            val id = "apt_" + UUID.randomUUID().toString().substring(0, 8)
            val created = Appointment(
                id = id,
                client = client.trim(),
                clientPhone = clientPhone.trim(),
                clientEmail = clientEmail.trim(),
                serviceId = service.id,
                service = service.name,
                dateKey = dateKey,
                time = time,
                durationMinutes = service.durationMinutes,
                bookingBufferMinutes = bufferMinutes,
                priceAtBooking = service.price,
                status = status,
                businessId = businessId,
                paymentStatus = if (service.requiresDeposit) "pending" else "none",
                depositAmount = if (service.requiresDeposit) (service.price * 0.3) else 0.0,
                fromCache = false
            )
            appointments[id] = created
            if (!idempotencyKey.isNullOrBlank()) {
                idempotencyLedger[idempotencyKey] = id
            }

            // Sync client stats
            val existingClient = clients.values.firstOrNull { it.phone == clientPhone.trim() && it.businessId == businessId }
            if (existingClient != null) {
                clients[existingClient.id] = existingClient.copy(
                    totalBookings = existingClient.totalBookings + 1,
                    lastVisitDateKey = dateKey
                )
            } else {
                val newClientId = "cli_" + UUID.randomUUID().toString().substring(0, 6)
                clients[newClientId] = ClientItem(
                    id = newClientId,
                    name = client.trim(),
                    phone = clientPhone.trim(),
                    email = clientEmail.trim(),
                    totalBookings = 1,
                    lastVisitDateKey = dateKey,
                    businessId = businessId
                )
            }

            ApiResult.Success(id)
        }
    }

    override suspend fun rescheduleAppointment(
        appointmentId: String,
        dateKey: String,
        time: String,
        businessId: String
    ): ApiResult<Unit> {
        val guardError = checkGuardrails(requireActiveMembership = true)
        if (guardError != null) return guardError
        if (networkDelayMs > 0) delay(networkDelayMs)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida con el servidor"))

        return mutex.withLock {
            val existing = appointments[appointmentId]
                ?: return@withLock ApiResult.Error(404, "Appointment $appointmentId not found")
            if (existing.businessId != businessId) {
                return@withLock ApiResult.Error(404, "Appointment does not belong to active business")
            }
            if (existing.status.isTerminal) {
                return@withLock ApiResult.Error(409, "Cannot reschedule terminal appointment (${existing.status})")
            }

            val bufferMinutes = existing.bookingBufferMinutes
            val newStart = timeZoneManager.minutesFromMidnight(time)
            val newEnd = newStart + existing.durationMinutes + bufferMinutes

            val hasOverlap = appointments.values
                .filter { it.businessId == businessId && it.dateKey == dateKey && it.id != appointmentId && it.status != AppointmentStatus.Cancelado }
                .any { other ->
                    val otherStart = timeZoneManager.minutesFromMidnight(other.time)
                    val otherEnd = otherStart + other.durationMinutes + other.bookingBufferMinutes
                    newStart < otherEnd && newEnd > otherStart
                }

            if (hasOverlap) {
                return@withLock ApiResult.Error(409, "Conflicto de horario: $time ($dateKey) no está libre.")
            }

            val updated = existing.copy(
                dateKey = dateKey,
                time = time
            )
            appointments[appointmentId] = updated
            ApiResult.Success(Unit)
        }
    }

    override suspend fun updateAppointmentStatus(
        appointmentId: String,
        status: AppointmentStatus,
        businessId: String
    ): ApiResult<Unit> {
        val guardError = checkGuardrails(requireActiveMembership = true)
        if (guardError != null) return guardError
        if (networkDelayMs > 0) delay(networkDelayMs)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida con el servidor"))

        return mutex.withLock {
            val existing = appointments[appointmentId]
                ?: return@withLock ApiResult.Error(404, "Appointment $appointmentId not found")
            if (existing.businessId != businessId) {
                return@withLock ApiResult.Error(404, "Appointment does not belong to active business")
            }

            if (!existing.status.canTransitionTo(status, existing.paymentStatus)) {
                return@withLock ApiResult.Error(
                    409,
                    "Transición no permitida de ${existing.status} a $status (paymentStatus=${existing.paymentStatus})"
                )
            }

            appointments[appointmentId] = existing.copy(status = status)
            ApiResult.Success(Unit)
        }
    }

    override suspend fun getServices(businessId: String): ApiResult<List<ServiceItem>> {
        val guardError = checkGuardrails(requireActiveMembership = false)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida"))
        if (guardError != null) return guardError
        return ApiResult.Success(
            services.values
                .filter { it.businessId == businessId }
                .sortedBy { it.name }
        )
    }

    override suspend fun saveService(
        name: String,
        durationMinutes: Int,
        price: Double,
        status: String,
        serviceId: String?,
        category: String,
        photoUrl: String?,
        bookingBufferMinutes: Int?,
        workingHours: Map<Int, DaySchedule>,
        unavailableDates: List<String>,
        businessId: String,
        idempotencyKey: String?
    ): ApiResult<ServiceItem> {
        val guardError = checkGuardrails(requireActiveMembership = true)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida"))
        if (guardError != null) return guardError

        if (name.trim().length < 2) return ApiResult.Error(400, "El nombre del servicio debe tener al menos 2 caracteres.")
        if (durationMinutes < 10 || durationMinutes > 1440) return ApiResult.Error(400, "Duración debe estar entre 10 y 1440 minutos.")
        if (price <= 0) return ApiResult.Error(400, "El precio debe ser mayor a 0.")

        return mutex.withLock {
            val id = serviceId ?: ("srv_" + UUID.randomUUID().toString().substring(0, 6))
            val item = ServiceItem(
                id = id,
                name = name.trim(),
                durationMinutes = durationMinutes,
                price = price,
                status = status,
                businessId = businessId,
                category = category,
                photoUrl = photoUrl,
                bookingBufferMinutes = bookingBufferMinutes,
                workingHours = workingHours,
                unavailableDates = unavailableDates
            )
            services[id] = item
            ApiResult.Success(item)
        }
    }

    override suspend fun deleteService(
        serviceId: String,
        businessId: String
    ): ApiResult<Unit> {
        val guardError = checkGuardrails(requireActiveMembership = true)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida"))
        if (guardError != null) return guardError

        return mutex.withLock {
            val existing = services[serviceId]
            if (existing == null || existing.businessId != businessId) {
                return@withLock ApiResult.Error(404, "Service not found")
            }
            services.remove(serviceId)
            ApiResult.Success(Unit)
        }
    }

    override suspend fun getClients(businessId: String): ApiResult<List<ClientItem>> {
        val guardError = checkGuardrails(requireActiveMembership = false)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida"))
        if (guardError != null) return guardError
        return ApiResult.Success(
            clients.values
                .filter { it.businessId == businessId }
                .sortedBy { it.name }
        )
    }

    override suspend fun createClient(
        name: String,
        phone: String,
        email: String,
        notes: String,
        avatarUrl: String?,
        businessId: String
    ): ApiResult<ClientItem> {
        val guardError = checkGuardrails(requireActiveMembership = true)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida"))
        if (guardError != null) return guardError

        if (name.trim().length < 2) return ApiResult.Error(400, "Nombre inválido")
        if (phone.filter { it.isDigit() }.length < 6) return ApiResult.Error(400, "Teléfono inválido")

        return mutex.withLock {
            val id = "cli_" + UUID.randomUUID().toString().substring(0, 6)
            val client = ClientItem(
                id = id,
                name = name.trim(),
                phone = phone.trim(),
                email = email.trim(),
                avatarUrl = avatarUrl,
                totalBookings = 0,
                lastVisitDateKey = null,
                notes = notes.trim(),
                businessId = businessId
            )
            clients[id] = client
            ApiResult.Success(client)
        }
    }

    override suspend fun updateClient(client: ClientItem): ApiResult<ClientItem> {
        val guardError = checkGuardrails(requireActiveMembership = true)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida"))
        if (guardError != null) return guardError

        return mutex.withLock {
            clients[client.id] = client
            ApiResult.Success(client)
        }
    }

    override suspend fun deleteClient(clientId: String): ApiResult<Unit> = mutex.withLock {
        if (clients.remove(clientId) != null) ApiResult.Success(Unit) else ApiResult.Error(404, "Cliente no encontrado")
    }

    override suspend fun getBusinessProfile(businessId: String): ApiResult<BusinessProfile> {
        val guardError = checkGuardrails(requireActiveMembership = false)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida"))
        if (guardError != null) return guardError
        val profile = businesses[businessId]
            ?: return ApiResult.Error(404, "Business profile not found")
        val effectiveProfile = if (simulateMembershipExpired) {
            profile.copy(
                membership = profile.membership.copy(
                    status = "expired",
                    daysRemaining = 0
                )
            )
        } else {
            profile
        }
        return ApiResult.Success(effectiveProfile)
    }

    override suspend fun createBusinessProfile(name: String): ApiResult<Unit> =
        ApiResult.Error(501, "El origen simulado no admite crear negocios.")

    override suspend fun getAvailability(serviceId: String, dateKey: String, excludeAppointmentId: String?): ApiResult<List<com.pediturno.servicios.core.timezone.SlotAvailability>> =
        ApiResult.Error(501, "El origen simulado no admite disponibilidad.")

    override suspend fun updateBusinessSettings(
        leadTimeMinutes: Int,
        horizonDays: Int,
        bufferMinutes: Int,
        autoConfirm: Boolean,
        businessId: String
    ): ApiResult<BusinessProfile> {
        val guardError = checkGuardrails(requireActiveMembership = true)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida"))
        if (guardError != null) return guardError

        return mutex.withLock {
            val current = businesses[businessId]
                ?: return@withLock ApiResult.Error(404, "Business profile not found")
            val updated = current.copy(
                bookingRules = current.bookingRules.copy(
                    leadTimeHours = (leadTimeMinutes / 60).coerceIn(0, 720),
                    horizonDays = horizonDays.coerceIn(1, 365),
                    bufferMinutes = bufferMinutes.coerceIn(0, 240),
                    autoConfirm = autoConfirm
                )
            )
            businesses[businessId] = updated
            ApiResult.Success(updated)
        }
    }

    override suspend fun getDashboard(monthKey: String): ApiResult<DashboardSummary> = mutex.withLock {
        val monthAppointments = appointments.values.filter { it.dateKey.startsWith(monthKey) }
        ApiResult.Success(DashboardSummary(
            monthKey = monthKey,
            timeZone = timeZoneManager.businessZoneId.id,
            upcomingAppointmentsCount = appointments.values.count { !it.status.isTerminal },
            totalClients = clients.size,
            monthlyRevenue = monthAppointments.filter { it.status == AppointmentStatus.Completado }.sumOf { it.priceAtBooking },
            upcomingAppointments = appointments.values.filter { !it.status.isTerminal }.sortedBy { it.dateKey + it.time }.take(5)
        ))
    }

    override suspend fun updateFullBusinessProfile(profile: BusinessProfile): ApiResult<BusinessProfile> {
        val guardError = checkGuardrails(requireActiveMembership = true)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida"))
        if (guardError != null) return guardError

        return mutex.withLock {
            businesses[profile.id] = profile
            ApiResult.Success(profile)
        }
    }

    override suspend fun getOwnerSettings(): ApiResult<BookingRules> = mutex.withLock {
        ApiResult.Success(businesses.values.firstOrNull()?.bookingRules ?: BookingRules())
    }

    override suspend fun updateOwnerSettings(settings: BookingRules): ApiResult<BookingRules> = mutex.withLock {
        val current = businesses.values.firstOrNull() ?: return@withLock ApiResult.Error(404, "Business profile not found")
        businesses[current.id] = current.copy(bookingRules = settings)
        ApiResult.Success(settings)
    }

    override suspend fun getClientHistory(clientId: String): ApiResult<List<Appointment>> = mutex.withLock {
        ApiResult.Success(appointments.values.filter { it.clientPhone == clients[clientId]?.phone }.sortedByDescending { it.dateKey + it.time })
    }

    override suspend fun sendAppointmentNotification(appointmentId: String, kind: AppointmentNotificationKind): ApiResult<Unit> = mutex.withLock {
        if (appointments.containsKey(appointmentId)) ApiResult.Success(Unit) else ApiResult.Error(404, "Turno no encontrado")
    }

    override suspend fun checkSlugAvailability(slug: String, currentBusinessId: String): ApiResult<Boolean> {
        val clean = slug.trim().lowercase()
        val taken = businesses.values.any { it.id != currentBusinessId && it.slug.trim().lowercase() == clean }
        return ApiResult.Success(!taken)
    }

    override suspend fun registerDeviceToken(
        token: String,
        appVersion: String
    ): ApiResult<Unit> {
        if (networkDelayMs > 0) delay(networkDelayMs)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida"))
        registeredDeviceTokens.add(token)
        return ApiResult.Success(Unit)
    }

    override suspend fun unregisterDeviceToken(token: String): ApiResult<Unit> {
        if (networkDelayMs > 0) delay(networkDelayMs)
        registeredDeviceTokens.remove(token)
        return ApiResult.Success(Unit)
    }

    override suspend fun requestAccountDeletion(reason: String): ApiResult<String> {
        val guardError = checkGuardrails(requireActiveMembership = false)
        if (simulateNetworkError) return ApiResult.NetworkError(java.io.IOException("Conexión perdida"))
        if (guardError != null) return guardError
        return ApiResult.Success("SOL-DEL-2026-" + UUID.randomUUID().toString().substring(0, 6).uppercase())
    }

    override suspend fun createMercadoPagoHandoff(): ApiResult<String> =
        ApiResult.Error(501, "Marketplace OAuth no se simula: requiere un ticket firmado del servidor.")

    override suspend fun getMercadoPagoStatus(): ApiResult<MercadoPagoConnectionStatus> = mutex.withLock {
        val mp = businesses.values.firstOrNull()?.mercadopago ?: MercadoPagoSettings()
        ApiResult.Success(MercadoPagoConnectionStatus(connected = mp.isConnected, configured = mp.isConnected, depositsEnabled = mp.isConnected, canConfigureDeposits = mp.isConnected, requireDeposit = mp.requireDeposit, depositType = mp.depositType, depositValue = mp.depositValue))
    }

    override suspend fun updateMercadoPagoSettings(requireDeposit: Boolean, depositType: String, depositValue: Double): ApiResult<MercadoPagoConnectionStatus> = mutex.withLock {
        val current = businesses.values.firstOrNull() ?: return@withLock ApiResult.Error(404, "Business profile not found")
        if (!current.mercadopago.isConnected) return@withLock ApiResult.Error(403, "Mercado Pago no está conectado")
        val updated = current.mercadopago.copy(requireDeposit = requireDeposit, depositType = depositType, depositValue = depositValue)
        businesses[current.id] = current.copy(mercadopago = updated)
        ApiResult.Success(MercadoPagoConnectionStatus(configured = true, connected = true, depositsEnabled = true, canConfigureDeposits = true, requireDeposit = updated.requireDeposit, depositType = updated.depositType, depositValue = updated.depositValue))
    }

    override suspend fun disconnectMercadoPago(): ApiResult<MercadoPagoConnectionStatus> = mutex.withLock {
        val current = businesses.values.firstOrNull() ?: return@withLock ApiResult.Error(404, "Business profile not found")
        businesses[current.id] = current.copy(mercadopago = current.mercadopago.copy(isConnected = false, requireDeposit = false))
        ApiResult.Success(MercadoPagoConnectionStatus())
    }

    fun isTokenRegistered(token: String): Boolean = registeredDeviceTokens.contains(token)

    suspend fun seedCustomAppointment(appointment: Appointment) {
        mutex.withLock {
            appointments[appointment.id] = appointment
        }
    }

    fun clearAll() {
        appointments.clear()
        services.clear()
        clients.clear()
        businesses.clear()
        idempotencyLedger.clear()
        seedInitialData()
    }
}
