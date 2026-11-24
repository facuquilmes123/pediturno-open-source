package com.pediturno.servicios.data.remote

import com.pediturno.servicios.BuildConfig
import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.core.network.AuthInterceptor
import com.pediturno.servicios.core.network.executeOwnerRead
import com.pediturno.servicios.core.network.RequestOwner
import com.pediturno.servicios.core.network.ProductionGuardInterceptor
import com.pediturno.servicios.data.repository.AppCheckTokenRepository
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.model.BusinessProfile
import com.pediturno.servicios.data.model.BookingRules
import com.pediturno.servicios.data.model.Address
import com.pediturno.servicios.data.model.GeoLocation
import com.pediturno.servicios.data.model.CustomThemeColors
import com.pediturno.servicios.data.model.SocialLink
import com.pediturno.servicios.data.model.SocialLinkType
import com.pediturno.servicios.data.model.MembershipInfo
import com.pediturno.servicios.data.model.DashboardSummary
import com.pediturno.servicios.data.model.MercadoPagoSettings
import com.pediturno.servicios.data.model.MercadoPagoConnectionStatus
import com.pediturno.servicios.data.model.AppointmentNotificationKind
import com.pediturno.servicios.data.model.ClientItem
import com.pediturno.servicios.data.model.DaySchedule
import com.pediturno.servicios.data.model.ServiceItem
import java.io.IOException
import java.math.BigDecimal
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.encodeToJsonElement
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.HttpUrl.Companion.toHttpUrl

/**
 * Implementación HTTP real conectada a los endpoints Next.js de Pediturno
 * (`POST /api/owner/appointments`, `POST /api/owner/appointments/{id}/reschedule`,
 * `POST /api/owner/appointments/{id}/status`, `POST/PATCH/DELETE /api/owner/services`,
 * `POST /api/business/profile`) protegida por [ProductionGuardInterceptor] y [AuthInterceptor].
 */
class HttpPediturnoRemoteDataSource(
    private val baseUrl: String,
    tokenProvider: () -> String?,
    private val appCheckTokens: AppCheckTokenRepository? = null,
    private val requireAppCheck: Boolean = true,
    allowProductionMutations: Boolean = false,
    customClient: OkHttpClient? = null,
    private val ownerProvider: (() -> String?)? = null
) : PediturnoRemoteDataSource {

    private val json = Json {
        ignoreUnknownKeys = true
        encodeDefaults = true
    }

    private val mediaType = "application/json; charset=utf-8".toMediaType()

    val okHttpClient: OkHttpClient = customClient ?: OkHttpClient.Builder()
        .addInterceptor(ProductionGuardInterceptor(allowProductionMutations = allowProductionMutations))
        .addInterceptor(AuthInterceptor(tokenProvider = tokenProvider, appCheckTokenProvider = { appCheckTokens?.currentToken() }, ownerProvider = ownerProvider))
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(15, TimeUnit.SECONDS)
        .writeTimeout(15, TimeUnit.SECONDS)
        .build()

    private fun requestBuilder(): Request.Builder = Request.Builder().apply {
        ownerProvider?.let { tag(RequestOwner::class.java, RequestOwner(it())) }
    }

    private fun verifyReadOwner(captured: String?, businessId: String? = null) {
        if (ownerProvider != null && (captured.isNullOrBlank() || captured != ownerProvider.invoke() ||
                businessId != null && captured != businessId)) {
            throw IOException("La sesión cambió. Volvé a cargar desde la cuenta actual.")
        }
    }

    private suspend fun executeRead(request: Request): okhttp3.Response {
        val captured = request.tag(RequestOwner::class.java)
        return executeOwnerRead(okHttpClient, request, {
            captured == null || (!captured.uid.isNullOrBlank() && captured.uid == ownerProvider?.invoke())
        })
    }

    @Serializable
    private data class CreateAppointmentPayload(
        val client: String,
        val clientPhone: String,
        val clientEmail: String,
        val serviceId: String,
        val dateKey: String,
        val time: String,
        val status: String
    )

    @Serializable
    private data class ReschedulePayload(
        val dateKey: String,
        val time: String
    )

    /** The endpoint returns only this acknowledgement; the agenda is reloaded after writing. */
    @Serializable
    private data class RescheduleAcknowledgement(
        val id: String,
        val date: String,
        val time: String
    )

    @Serializable
    private data class RescheduleResponse(
        val appointment: RescheduleAcknowledgement
    )

    @Serializable
    private data class StatusUpdatePayload(
        val status: String
    )

    @Serializable
    private data class SaveServicePayload(
        val id: String? = null,
        val name: String,
        val duration: Int,
        val price: String,
        val status: String,
        val photo: String? = null,
        val bookingBufferMinutes: Int? = null,
        val workingHours: Map<Int, DaySchedule> = emptyMap(),
        val unavailableDates: List<String> = emptyList()
    )

    @Serializable
    private data class DeleteServicePayload(
        val id: String
    )

    @Serializable private data class ServiceDto(
        val id: String, val name: String = "", val duration: JsonElement? = null, val price: JsonElement? = null,
        val status: String = "Pausado", val photo: String? = null,
        val workingHours: Map<Int, DaySchedule> = emptyMap(), val unavailableDates: List<String> = emptyList(),
        val bookingBufferMinutes: Int? = null
    )
    @Serializable private data class ServicesResponse(val services: List<ServiceDto> = emptyList(), val nextCursor: String? = null)
    @Serializable private data class ClientDto(
        val id: String, val name: String = "", val phone: String = "", val email: String? = null,
        val avatar: String? = null, val lastAppointment: String? = null
    )
    @Serializable private data class ClientsResponse(val clients: List<ClientDto> = emptyList(), val nextCursor: String? = null)
    @Serializable private data class ClientWrite(val name: String, val phone: String, val email: String? = null, val avatar: String? = null)
    @Serializable private data class ClientIdResponse(val id: String)
    @Serializable private data class AvailabilitySlotDto(val time: String, val available: Boolean)
    @Serializable private data class AvailabilityResponse(val slots: List<AvailabilitySlotDto> = emptyList())
    @Serializable private data class AppointmentDto(
        val id: String, val client: String = "", val clientPhone: String = "", val clientEmail: String? = null,
        val serviceId: String? = null, val service: String? = null, val dateKey: String? = null, val time: String = "",
        val durationMinutes: Int? = null, val priceAtBooking: Double? = null, val status: String = "Pendiente",
        val paymentStatus: String? = null, val depositAmount: Double? = null,
        val depositPaid: Double? = null, val paymentReviewRequired: Boolean = false
    )
    @Serializable
    private data class AgendaResponse(
        val appointments: List<AppointmentDto> = emptyList(),
        val nextCursor: String? = null
    )
    @Serializable private data class DashboardResponse(
        val monthKey: String = "", val timeZone: String = "America/Argentina/Buenos_Aires",
        val upcomingAppointmentsCount: Int = 0, val totalClients: Int = 0,
        val monthlyRevenue: Double = 0.0, val upcomingAppointments: List<AppointmentDto> = emptyList()
    )
    @Serializable private data class ClientHistoryResponse(val appointments: List<AppointmentDto> = emptyList(), val nextCursor: String? = null)
    @Serializable private data class OwnerSettingsWire(
        val autoConfirm: Boolean = true,
        val bookingLeadTimeHours: Int = 2,
        val bookingHorizonDays: Int = 30,
        val appointmentBufferMinutes: Int = 15,
        val remindersEnabled: Boolean = false,
        val newAppointmentNotificationsEnabled: Boolean = false,
        val notificationEmail: String? = null
    ) {
        fun toDomain() = BookingRules(
            leadTimeHours = bookingLeadTimeHours,
            horizonDays = bookingHorizonDays,
            bufferMinutes = appointmentBufferMinutes,
            autoConfirm = autoConfirm,
            remindersEnabled = remindersEnabled,
            notifyNewByEmail = newAppointmentNotificationsEnabled,
            notificationEmail = notificationEmail.orEmpty()
        )
    }
    @Serializable private data class OwnerSettingsResponse(val bookingSettings: OwnerSettingsWire)
    @Serializable private data class NotificationPayload(val kind: String)
    @Serializable private data class MercadoPagoSettingsWire(
        val requireDeposit: Boolean = false,
        val depositType: String = "percentage",
        val depositValue: Double = 0.0
    )
    @Serializable private data class MercadoPagoStatusWire(
        val configured: Boolean = false,
        val connected: Boolean = false,
        val depositsEnabled: Boolean = false,
        val canConfigureDeposits: Boolean = false,
        val settings: MercadoPagoSettingsWire = MercadoPagoSettingsWire()
    ) {
        fun toDomain() = MercadoPagoConnectionStatus(
            configured = configured, connected = connected, depositsEnabled = depositsEnabled,
            canConfigureDeposits = canConfigureDeposits, requireDeposit = settings.requireDeposit,
            depositType = settings.depositType, depositValue = settings.depositValue
        )
    }
    @Serializable private data class SocialLinkWrite(val id: String, val type: String, val url: String, val title: String? = null)
    @Serializable private data class BusinessProfileWrite(
        val name: String,
        val slug: String,
        val description: String,
        val logo: String? = null,
        val whatsappButtonEnabled: Boolean,
        val whatsappNumber: String,
        val address: Address,
        val socialLinks: List<SocialLinkWrite>,
        val theme: String,
        val customTheme: CustomThemeColors,
        val location: GeoLocation? = null,
        val bookingSettings: OwnerSettingsWire
    )

    private fun ServiceDto.toDomain(ownerId: String) = ServiceItem(
        id = id, name = name, durationMinutes = duration.asIntOrNull("duration") ?: 0,
        price = price.asFiniteDoubleOrNull("price") ?: 0.0, status = status,
        businessId = ownerId, photoUrl = photo, workingHours = workingHours,
        unavailableDates = unavailableDates, bookingBufferMinutes = bookingBufferMinutes
    )
    /** Owner data includes legacy documents where duration/price were strings. */
    private fun JsonElement?.asIntOrNull(field: String): Int? {
        if (this == null || this is JsonNull) return null
        return jsonPrimitive.contentOrNull?.toIntOrNull()
            ?: throw IllegalArgumentException("Campo $field inválido en respuesta de servicio")
    }
    private fun JsonElement?.asFiniteDoubleOrNull(field: String): Double? {
        if (this == null || this is JsonNull) return null
        val value = jsonPrimitive.contentOrNull?.toDoubleOrNull()
            ?: throw IllegalArgumentException("Campo $field inválido en respuesta de servicio")
        require(value.isFinite()) { "Campo $field no finito en respuesta de servicio" }
        return value
    }
    private fun ClientDto.toDomain(ownerId: String) = ClientItem(
        id = id, name = name, phone = phone, email = email.orEmpty(), avatarUrl = avatar,
        lastVisitDateKey = lastAppointment?.take(10), businessId = ownerId
    )
    private fun AppointmentDto.toDomain(ownerId: String) = Appointment(
        id = id, client = client, clientPhone = clientPhone, clientEmail = clientEmail.orEmpty(),
        serviceId = serviceId.orEmpty(), service = service.orEmpty(), dateKey = dateKey.orEmpty(), time = time,
        durationMinutes = durationMinutes ?: 0, priceAtBooking = priceAtBooking ?: 0.0,
        status = AppointmentStatus.fromString(status), businessId = ownerId, paymentStatus = paymentStatus,
        depositAmount = depositAmount ?: 0.0, depositPaid = depositPaid ?: 0.0,
        paymentReviewRequired = paymentReviewRequired
    )
    private fun businessFromBootstrap(root: kotlinx.serialization.json.JsonObject): BusinessProfile {
        val b = root["business"]?.jsonObject ?: error("Business missing")
        fun str(key: String) = b[key]?.jsonPrimitive?.contentOrNull.orEmpty()
        // Owner-safe optional objects are intentionally nullable in the API.
        // Calling JsonElement.jsonObject on JSON null throws and used to make a
        // perfectly valid bootstrap response look like a malformed profile.
        val booking = b["bookingSettings"] as? kotlinx.serialization.json.JsonObject
        val mp = b["mercadopago"] as? kotlinx.serialization.json.JsonObject
        val address = b["address"] as? kotlinx.serialization.json.JsonObject
        val location = b["location"] as? kotlinx.serialization.json.JsonObject
        val customTheme = b["customTheme"] as? kotlinx.serialization.json.JsonObject
        val membership = b["membership"] as? kotlinx.serialization.json.JsonObject
        val socialLinks = (b["socialLinks"] as? kotlinx.serialization.json.JsonArray).orEmpty().mapNotNull { element ->
            val link = element as? kotlinx.serialization.json.JsonObject ?: return@mapNotNull null
            val url = link["url"]?.jsonPrimitive?.contentOrNull?.takeIf(String::isNotBlank) ?: return@mapNotNull null
            val type = link["type"]?.jsonPrimitive?.contentOrNull?.uppercase()?.let { value -> SocialLinkType.entries.firstOrNull { it.name == value } } ?: SocialLinkType.CUSTOM
            SocialLink(id = link["id"]?.jsonPrimitive?.contentOrNull ?: url, type = type, url = url, title = link["title"]?.jsonPrimitive?.contentOrNull.orEmpty())
        }
        return BusinessProfile(
            id = str("id"), name = str("name"), email = str("email"), slug = str("slug"),
            businessType = str("businessType").ifBlank { "services" }, timeZone = str("timeZone").ifBlank { "America/Argentina/Buenos_Aires" },
            description = str("description"), logoUrl = b["logo"]?.jsonPrimitive?.contentOrNull,
            whatsappButtonEnabled = b["whatsappButtonEnabled"]?.jsonPrimitive?.booleanOrNull == true,
            whatsappNumber = str("whatsappNumber"),
            address = Address(
                street = address?.get("street")?.jsonPrimitive?.contentOrNull.orEmpty(), number = address?.get("number")?.jsonPrimitive?.contentOrNull.orEmpty(),
                city = address?.get("city")?.jsonPrimitive?.contentOrNull.orEmpty(), province = address?.get("province")?.jsonPrimitive?.contentOrNull.orEmpty(),
                postalCode = address?.get("postalCode")?.jsonPrimitive?.contentOrNull.orEmpty(), country = address?.get("country")?.jsonPrimitive?.contentOrNull ?: "Argentina"
            ),
            location = location?.let { GeoLocation(it["lat"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: return@let null, it["lng"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: return@let null) },
            socialLinks = socialLinks,
            theme = str("theme").ifBlank { "menta" },
            customTheme = CustomThemeColors(
                primary = customTheme?.get("primary")?.jsonPrimitive?.contentOrNull ?: "#4FB5AB",
                background = customTheme?.get("background")?.jsonPrimitive?.contentOrNull ?: "#F0F0F0",
                accent = customTheme?.get("accent")?.jsonPrimitive?.contentOrNull ?: "#3B998F"
            ),
            bookingRules = BookingRules(
                leadTimeHours = booking?.get("bookingLeadTimeHours")?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 2,
                horizonDays = booking?.get("bookingHorizonDays")?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 30,
                bufferMinutes = booking?.get("appointmentBufferMinutes")?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 15,
                autoConfirm = booking?.get("autoConfirm")?.jsonPrimitive?.booleanOrNull != false,
                remindersEnabled = booking?.get("remindersEnabled")?.jsonPrimitive?.booleanOrNull == true,
                notifyNewByEmail = booking?.get("newAppointmentNotificationsEnabled")?.jsonPrimitive?.booleanOrNull == true,
                notificationEmail = booking?.get("notificationEmail")?.jsonPrimitive?.contentOrNull.orEmpty()
            ),
            membership = MembershipInfo(
                plan = membership?.get("plan")?.jsonPrimitive?.contentOrNull ?: if (membership?.get("type")?.jsonPrimitive?.contentOrNull in listOf("pro", "lifetime")) "pro" else "free",
                planName = if (membership?.get("plan")?.jsonPrimitive?.contentOrNull == "pro" || membership?.get("type")?.jsonPrimitive?.contentOrNull in listOf("pro", "lifetime")) "Plan Pro" else "Plan Gratis",
                status = membership?.get("status")?.jsonPrimitive?.contentOrNull ?: membership?.get("type")?.jsonPrimitive?.contentOrNull ?: "free",
                source = membership?.get("source")?.jsonPrimitive?.contentOrNull ?: "FREE",
                monthlyQuota = membership?.get("monthlyQuota")?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: if (membership?.get("plan")?.jsonPrimitive?.contentOrNull == "pro") null else 40,
                currentMonthUsage = membership?.get("currentMonthUsage")?.jsonPrimitive?.contentOrNull?.toIntOrNull() ?: 0,
                currentMonthKey = membership?.get("currentMonthKey")?.jsonPrimitive?.contentOrNull.orEmpty(),
                expiresAtIso = membership?.get("expiresAt")?.jsonPrimitive?.contentOrNull.orEmpty(),
                autoRenewEnabled = membership?.get("autoRenew")?.jsonPrimitive?.booleanOrNull == true
            ),
            mercadopago = MercadoPagoSettings(
                isConnected = mp?.get("connected")?.jsonPrimitive?.booleanOrNull == true,
                requireDeposit = mp?.get("requireDeposit")?.jsonPrimitive?.booleanOrNull == true,
                depositType = mp?.get("depositType")?.jsonPrimitive?.contentOrNull ?: "percentage",
                depositValue = mp?.get("depositValue")?.jsonPrimitive?.contentOrNull?.toDoubleOrNull() ?: 0.0
            )
        )
    }

    @Serializable
    private data class DeviceTokenPayload(
        val token: String,
        val platform: String = "android"
    )

    private fun extractErrorMessage(bodyString: String, fallback: String): String {
        val message = runCatching {
            val obj = json.parseToJsonElement(bodyString).jsonObject
            obj["error"]?.jsonPrimitive?.content
        }.getOrNull().orEmpty()
        return when (message) {
            "Slot already booked", "Selected time is unavailable", "Booking resource changed" -> "El horario ya no está disponible. Actualizá la agenda y elegí otro."
            "Booking unavailable", "Appointment update unavailable", "Bootstrap unavailable" -> "No se pudo completar la operación. Actualizá y volvé a intentar."
            "Invalid request" -> "Revisá los datos ingresados y volvé a intentar."
            "Invalid date" -> "Ingresá una fecha válida."
            "Invalid slug" -> "Usá un enlace público con letras, números y guiones."
            "Slug unavailable" -> "Ese enlace público ya está en uso. Elegí otro."
            "Invalid booking settings" -> "Revisá las reglas de reserva y el correo para avisos."
            "Business profile required" -> "Completá el perfil de tu negocio para continuar."
            "Invalid image URL or image storage unavailable" -> "No se pudo guardar el logo. Volvé a seleccionarlo."
            "Unable to save business profile" -> "No se pudo guardar el perfil. Volvé a intentar."
            "Invalid service details", "New services cannot include an id" -> "Revisá los datos del servicio y volvé a guardar."
            "Invalid service name" -> "Ingresá un nombre de servicio de entre 2 y 80 caracteres."
            "Invalid service duration" -> "La duración debe ser de entre 10 y 1440 minutos."
            "Invalid service price" -> "Ingresá un precio mayor que cero, con hasta dos decimales."
            "Invalid service status" -> "Elegí si el servicio está activo o en pausa."
            "Invalid service image" -> "No se pudo guardar la foto. Volvé a seleccionarla."
            "Configure availability before activating the service" -> "Configurá los horarios del servicio antes de activarlo."
            "Service has legacy reservations", "Service has active reservations" -> "Este servicio tiene turnos asociados. Resolvelos antes de modificarlo o eliminarlo."
            "Service unavailable", "Services unavailable" -> "No se pudo cargar el servicio. Actualizá la pantalla y volvé a intentar."
            "Save temporarily unavailable" -> "No se pudieron guardar los cambios. Volvé a intentar."
            "Invalid client details", "Invalid client name" -> "Revisá los datos del cliente y volvé a guardar."
            "Invalid client phone" -> "Ingresá un teléfono válido."
            "Invalid client email" -> "Ingresá un correo electrónico válido."
            "Invalid client avatar" -> "No se pudo guardar la foto del cliente. Volvé a seleccionarla."
            "Authentication required" -> "Tu sesión venció. Volvé a iniciar sesión."
            "" -> "No se pudo completar la operación. Volvé a intentar."
            else -> message.replace(Regex("\\bbuffer\\b", RegexOption.IGNORE_CASE), "tiempo entre turnos")
        }
    }

    private fun clientWriteBody(item: ClientWrite) =
        JsonObject(json.encodeToJsonElement(item).jsonObject.filterValues { it != JsonNull })
            .toString().toRequestBody(mediaType)

    override suspend fun getAppointments(
        dateKey: String,
        businessId: String
    ): ApiResult<List<Appointment>> = withContext(Dispatchers.IO) {
        val capturedReadOwner = ownerProvider?.invoke()
        try {
            val appointments = mutableListOf<Appointment>()
            var cursor: String? = null
            do {
                verifyReadOwner(capturedReadOwner, businessId)
                val url = "${baseUrl.trimEnd('/')}/v1/owner/agenda".toHttpUrl().newBuilder()
                    .addQueryParameter("date", dateKey)
                    .addQueryParameter("limit", "100")
                    .apply { cursor?.let { addQueryParameter("cursor", it) } }
                    .build()
                val page = executeRead(requestBuilder().url(url).get().build()).use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) {
                        return@withContext ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                    }
                    json.decodeFromString<AgendaResponse>(body)
                }
                appointments += page.appointments.map { it.toDomain(businessId) }
                cursor = page.nextCursor
            } while (cursor != null)
            verifyReadOwner(capturedReadOwner, businessId)
            ApiResult.Success(appointments.sortedWith(compareBy<Appointment> { it.time }.thenBy { it.id }))
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        } catch (_: Exception) {
            ApiResult.Error(502, "Respuesta de agenda inválida.")
        }
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
    ): ApiResult<String> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/owner/appointments"
        val payload = json.encodeToString(
            CreateAppointmentPayload(
                client = client,
                clientPhone = clientPhone,
                clientEmail = clientEmail,
                serviceId = serviceId,
                dateKey = dateKey,
                time = time,
                status = status.name
            )
        )
        val reqBuilder = requestBuilder()
            .url(url)
            .post(payload.toRequestBody(mediaType))
        if (!idempotencyKey.isNullOrBlank()) {
            reqBuilder.header("Idempotency-Key", idempotencyKey)
        }
        val request = reqBuilder.build()

        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    val returnedId = runCatching {
                        json.parseToJsonElement(body).jsonObject["id"]?.jsonPrimitive?.content
                    }.getOrNull()?.takeIf { it.isNotBlank() }
                    if (returnedId == null) ApiResult.Error(502, "El servidor no confirmó el identificador del turno.")
                    else ApiResult.Success(returnedId)
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            ApiResult.Error(502, "Respuesta de turno inválida.")
        }
    }

    override suspend fun rescheduleAppointment(
        appointmentId: String,
        dateKey: String,
        time: String,
        businessId: String
    ): ApiResult<Unit> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/owner/appointments/$appointmentId/reschedule"
        val payload = json.encodeToString(ReschedulePayload(dateKey = dateKey, time = time))
        val request = requestBuilder()
            .url(url)
            .post(payload.toRequestBody(mediaType))
            .build()

        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    val acknowledgement = json.decodeFromString<RescheduleResponse>(body).appointment
                    check(
                        acknowledgement.id == appointmentId &&
                            acknowledgement.time == time &&
                            acknowledgement.date.isNotBlank()
                    ) { "Invalid reschedule acknowledgement" }
                    ApiResult.Success(Unit)
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            ApiResult.Error(502, "Respuesta de turno inválida.")
        }
    }

    override suspend fun updateAppointmentStatus(
        appointmentId: String,
        status: AppointmentStatus,
        businessId: String
    ): ApiResult<Unit> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/owner/appointments/$appointmentId/status"
        val payload = json.encodeToString(StatusUpdatePayload(status = status.name))
        val request = requestBuilder()
            .url(url)
            .post(payload.toRequestBody(mediaType))
            .build()

        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    ApiResult.Success(Unit)
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            ApiResult.Error(502, "Respuesta de turno inválida.")
        }
    }

    override suspend fun getServices(businessId: String): ApiResult<List<ServiceItem>> = withContext(Dispatchers.IO) {
        val capturedReadOwner = ownerProvider?.invoke()
        val all = mutableListOf<ServiceItem>()
        var cursor: String? = null
        var pages = 0
        try {
            do {
                verifyReadOwner(capturedReadOwner, businessId)
                if (++pages > 100) return@withContext ApiResult.Error(502, "La paginación de servicios no finalizó.")
                val url = "${baseUrl.trimEnd('/')}/v1/owner/services".toHttpUrl().newBuilder()
                    .addQueryParameter("limit", "100").apply { cursor?.let { addQueryParameter("cursor", it) } }.build()
                executeRead(requestBuilder().url(url).get().build()).use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) return@withContext ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                    val page = json.decodeFromString<ServicesResponse>(body)
                    all += page.services.map { it.toDomain(businessId) }
                    cursor = page.nextCursor?.takeIf { it.isNotBlank() }
                }
            } while (cursor != null)
            verifyReadOwner(capturedReadOwner, businessId)
            ApiResult.Success(all)
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) {
            ApiResult.Error(502, "Respuesta de servicios inválida.")
        }
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
    ): ApiResult<ServiceItem> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/v1/owner/services"
        if (!price.isFinite() || price <= 0) return@withContext ApiResult.Error(400, "Ingresá un precio válido mayor que cero.")
        val payloadFields = json.encodeToJsonElement(
            SaveServicePayload(
                id = serviceId,
                name = name,
                duration = durationMinutes,
                price = BigDecimal.valueOf(price).stripTrailingZeros().toPlainString(),
                status = status,
                photo = photoUrl,
                bookingBufferMinutes = bookingBufferMinutes,
                workingHours = workingHours,
                unavailableDates = unavailableDates
            )
        ).jsonObject
        // id/photo are optional; an explicit null buffer resets the inherited pause.
        val payload = JsonObject(payloadFields.filter { (key, value) ->
            value != JsonNull || key == "bookingBufferMinutes"
        }).toString()
        val requestBuilder = requestBuilder().url(url)
        val request = if (serviceId == null) {
            requestBuilder.apply { idempotencyKey?.let { header("X-Idempotency-Key", it) } }.post(payload.toRequestBody(mediaType)).build()
        } else {
            requestBuilder.patch(payload.toRequestBody(mediaType)).build()
        }

        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    // Legacy proxy returns {id}; re-read is the only authoritative full DTO.
                    val id = json.parseToJsonElement(body).jsonObject["id"]?.jsonPrimitive?.contentOrNull ?: serviceId
                    if (id == null) ApiResult.Error(502, "El servidor no confirmó el servicio guardado.")
                    else when (val refreshed = getServices(businessId)) {
                        is ApiResult.Success -> refreshed.data.firstOrNull { it.id == id }?.let { ApiResult.Success(it) }
                            ?: ApiResult.Error(502, "El servicio guardado no se pudo releer.")
                        is ApiResult.Error -> refreshed
                        is ApiResult.NetworkError -> refreshed
                    }
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            ApiResult.Error(502, "Respuesta de servicio inválida.")
        }
    }

    override suspend fun deleteService(
        serviceId: String,
        businessId: String
    ): ApiResult<Unit> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/v1/owner/services"
        val request = requestBuilder()
            .url(url)
            .delete(json.encodeToString(DeleteServicePayload(id = serviceId)).toRequestBody(mediaType))
            .build()

        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    ApiResult.Success(Unit)
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            ApiResult.Error(502, "Respuesta de servicio inválida.")
        }
    }

    override suspend fun getClients(businessId: String): ApiResult<List<ClientItem>> = withContext(Dispatchers.IO) {
        val capturedReadOwner = ownerProvider?.invoke()
        val all = mutableListOf<ClientItem>()
        var cursor: String? = null
        var pages = 0
        try {
            do {
                verifyReadOwner(capturedReadOwner, businessId)
                if (++pages > 100) return@withContext ApiResult.Error(502, "La paginación de clientes no finalizó.")
                val url = "${baseUrl.trimEnd('/')}/v1/owner/clients".toHttpUrl().newBuilder()
                    .addQueryParameter("limit", "100").apply { cursor?.let { addQueryParameter("cursor", it) } }.build()
                executeRead(requestBuilder().url(url).get().build()).use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) return@withContext ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                    val page = json.decodeFromString<ClientsResponse>(body)
                    all += page.clients.map { it.toDomain(businessId) }
                    cursor = page.nextCursor?.takeIf { it.isNotBlank() }
                }
            } while (cursor != null)
            verifyReadOwner(capturedReadOwner, businessId)
            ApiResult.Success(all)
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) {
            ApiResult.Error(502, "Respuesta de clientes inválida.")
        }
    }

    override suspend fun createClient(
        name: String,
        phone: String,
        email: String,
        notes: String,
        avatarUrl: String?,
        businessId: String
    ): ApiResult<ClientItem> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/v1/owner/clients"
        val item = ClientWrite(name = name.trim(), phone = phone.trim(), email = email.trim(), avatar = avatarUrl?.takeIf { it.startsWith("https://") })
        val request = requestBuilder()
            .url(url)
            .post(clientWriteBody(item))
            .build()
        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    val id = json.decodeFromString<ClientIdResponse>(body).id
                    when (val refreshed = getClients(businessId)) {
                        is ApiResult.Success -> refreshed.data.firstOrNull { it.id == id }?.let { ApiResult.Success(it) } ?: ApiResult.Error(502, "El cliente guardado no se pudo releer.")
                        is ApiResult.Error -> refreshed; is ApiResult.NetworkError -> refreshed
                    }
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            ApiResult.Error(502, "Respuesta de cliente inválida.")
        }
    }

    override suspend fun updateClient(client: ClientItem): ApiResult<ClientItem> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/v1/owner/clients/${client.id}"
        val request = requestBuilder()
            .url(url)
            .patch(clientWriteBody(ClientWrite(client.name.trim(), client.phone.trim(), client.email.trim(), client.avatarUrl?.takeIf { it.startsWith("https://") })))
            .build()
        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    when (val refreshed = getClients(client.businessId)) {
                        is ApiResult.Success -> refreshed.data.firstOrNull { it.id == client.id }?.let { ApiResult.Success(it) } ?: ApiResult.Error(502, "El cliente guardado no se pudo releer.")
                        is ApiResult.Error -> refreshed; is ApiResult.NetworkError -> refreshed
                    }
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            ApiResult.Error(502, "Respuesta de cliente inválida.")
        }
    }

    override suspend fun deleteClient(clientId: String): ApiResult<Unit> = withContext(Dispatchers.IO) {
        val request = requestBuilder().url("${baseUrl.trimEnd('/')}/v1/owner/clients/$clientId").delete().build()
        try { okHttpClient.newCall(request).execute().use { response -> if (response.isSuccessful) ApiResult.Success(Unit) else ApiResult.Error(response.code, extractErrorMessage(response.body?.string().orEmpty(), response.message)) } } catch (error: IOException) { ApiResult.NetworkError(error) }
    }

    override suspend fun getBusinessProfile(businessId: String): ApiResult<BusinessProfile> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/v1/owner/bootstrap"
        val request = requestBuilder().url(url).get().build()
        try {
            executeRead(request).use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    ApiResult.Success(businessFromBootstrap(json.parseToJsonElement(body).jsonObject))
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message),
                        runCatching { json.parseToJsonElement(body).jsonObject["code"]?.jsonPrimitive?.contentOrNull }.getOrNull())
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        } catch (e: CancellationException) {
            throw e
        } catch (_: Exception) {
            ApiResult.Error(502, "Respuesta de perfil inválida.")
        }
    }

    override suspend fun createBusinessProfile(name: String): ApiResult<Unit> = withContext(Dispatchers.IO) {
        val safeName = name.trim()
        if (safeName.length < 3) return@withContext ApiResult.Error(400, "Indicá el nombre de tu negocio para continuar.")
        val appCheckToken = appCheckTokens?.limitedUseToken()
        if (requireAppCheck && appCheckToken.isNullOrBlank()) {
            return@withContext ApiResult.Error(503, "No se pudo validar la integridad de esta instalación. Reintentá desde la app oficial.")
        }
        val payload = """{"name":${json.encodeToString(safeName)},"businessType":"services"}"""
        val request = requestBuilder().url("${baseUrl.trimEnd('/')}/business/profile")
            .apply { appCheckToken?.takeIf { it.isNotBlank() }?.let { header("X-Firebase-AppCheck", it) } }
            .post(payload.toRequestBody(mediaType)).build()
        try {
            okHttpClient.newCall(request).execute().use { response ->
                if (response.isSuccessful) ApiResult.Success(Unit)
                else ApiResult.Error(response.code, extractErrorMessage(response.body?.string().orEmpty(), response.message))
            }
        } catch (error: IOException) {
            ApiResult.NetworkError(error)
        }
    }

    override suspend fun getAvailability(serviceId: String, dateKey: String, excludeAppointmentId: String?): ApiResult<List<com.pediturno.servicios.core.timezone.SlotAvailability>> = withContext(Dispatchers.IO) {
        val url = okhttp3.HttpUrl.Builder().scheme(if (baseUrl.startsWith("https")) "https" else "http")
            .host(java.net.URI(baseUrl).host).port(if (java.net.URI(baseUrl).port > 0) java.net.URI(baseUrl).port else if (baseUrl.startsWith("https")) 443 else 80)
            .addPathSegments(java.net.URI(baseUrl).path.trim('/')).addPathSegments("v1/owner/availability")
            .addQueryParameter("serviceId", serviceId).addQueryParameter("date", dateKey)
            .apply { excludeAppointmentId?.let { addQueryParameter("excludeAppointmentId", it) } }.build()
        try { executeRead(requestBuilder().url(url).get().build()).use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) ApiResult.Error(response.code, extractErrorMessage(body, response.message))
            else ApiResult.Success(json.decodeFromString<AvailabilityResponse>(body).slots.map { com.pediturno.servicios.core.timezone.SlotAvailability(it.time, it.available) })
        }} catch (e: IOException) { ApiResult.NetworkError(e) } catch (e: Exception) { ApiResult.Error(502, "Respuesta de disponibilidad inválida.") }
    }

    override suspend fun getDashboard(monthKey: String): ApiResult<DashboardSummary> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/v1/owner/dashboard".toHttpUrl().newBuilder()
            .addQueryParameter("monthKey", monthKey).build()
        try { executeRead(requestBuilder().url(url).get().build()).use { response ->
            val body = response.body?.string().orEmpty()
            if (!response.isSuccessful) return@use ApiResult.Error(response.code, extractErrorMessage(body, response.message))
            val dashboard = json.decodeFromString<DashboardResponse>(body)
            ApiResult.Success(DashboardSummary(
                monthKey = dashboard.monthKey.ifBlank { monthKey }, timeZone = dashboard.timeZone,
                upcomingAppointmentsCount = dashboard.upcomingAppointmentsCount, totalClients = dashboard.totalClients,
                monthlyRevenue = dashboard.monthlyRevenue, upcomingAppointments = dashboard.upcomingAppointments.map { it.toDomain("") }
            ))
        }} catch (e: IOException) { ApiResult.NetworkError(e) }
        catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { ApiResult.Error(502, "Respuesta del resumen inválida.") }
    }

    override suspend fun updateBusinessSettings(
        leadTimeMinutes: Int,
        horizonDays: Int,
        bufferMinutes: Int,
        autoConfirm: Boolean,
        businessId: String
    ): ApiResult<BusinessProfile> = withContext(Dispatchers.IO) {
        when (val result = updateOwnerSettings(BookingRules(
            leadTimeHours = (leadTimeMinutes / 60).coerceAtLeast(0), horizonDays = horizonDays,
            bufferMinutes = bufferMinutes, autoConfirm = autoConfirm
        ))) {
            is ApiResult.Success -> getBusinessProfile(businessId)
            is ApiResult.Error -> result
            is ApiResult.NetworkError -> result
        }
    }

    override suspend fun updateFullBusinessProfile(profile: BusinessProfile): ApiResult<BusinessProfile> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/business/profile"
        val payload = BusinessProfileWrite(
            name = profile.name.trim(), slug = profile.slug.trim(), description = profile.description,
            logo = profile.logoUrl.orEmpty(), whatsappButtonEnabled = profile.whatsappButtonEnabled,
            whatsappNumber = profile.whatsappNumber, address = profile.address,
            socialLinks = profile.socialLinks.map { SocialLinkWrite(it.id, it.type.name.lowercase(), it.url, it.title.takeIf(String::isNotBlank)) },
            theme = profile.theme, customTheme = profile.customTheme, location = profile.location,
            bookingSettings = OwnerSettingsWire(
                autoConfirm = profile.bookingRules.autoConfirm,
                bookingLeadTimeHours = profile.bookingRules.leadTimeHours,
                bookingHorizonDays = profile.bookingRules.horizonDays,
                appointmentBufferMinutes = profile.bookingRules.bufferMinutes,
                remindersEnabled = profile.bookingRules.remindersEnabled,
                newAppointmentNotificationsEnabled = profile.bookingRules.notifyNewByEmail,
                notificationEmail = profile.bookingRules.notificationEmail.trim()
            )
        )
        val request = requestBuilder()
            .url(url)
            .post(json.encodeToString(payload).toRequestBody(mediaType))
            .build()
        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    getBusinessProfile(profile.id)
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        }
    }

    override suspend fun getOwnerSettings(): ApiResult<BookingRules> = withContext(Dispatchers.IO) {
        val request = requestBuilder().url("${baseUrl.trimEnd('/')}/v1/owner/settings").get().build()
        try {
            executeRead(request).use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) ApiResult.Success(json.decodeFromString<OwnerSettingsResponse>(body).bookingSettings.toDomain())
                else ApiResult.Error(response.code, extractErrorMessage(body, response.message))
            }
        } catch (e: IOException) { ApiResult.NetworkError(e) }
        catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { ApiResult.Error(502, "Respuesta de ajustes inválida.") }
    }

    override suspend fun updateOwnerSettings(settings: BookingRules): ApiResult<BookingRules> = withContext(Dispatchers.IO) {
        val wire = OwnerSettingsWire(
            autoConfirm = settings.autoConfirm, bookingLeadTimeHours = settings.leadTimeHours,
            bookingHorizonDays = settings.horizonDays, appointmentBufferMinutes = settings.bufferMinutes,
            remindersEnabled = settings.remindersEnabled,
            newAppointmentNotificationsEnabled = settings.notifyNewByEmail,
            notificationEmail = settings.notificationEmail.trim()
        )
        val request = requestBuilder().url("${baseUrl.trimEnd('/')}/v1/owner/settings")
            .patch(json.encodeToString(wire).toRequestBody(mediaType)).build()
        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) ApiResult.Success(json.decodeFromString<OwnerSettingsResponse>(body).bookingSettings.toDomain())
                else ApiResult.Error(response.code, extractErrorMessage(body, response.message))
            }
        } catch (e: IOException) { ApiResult.NetworkError(e) }
        catch (_: Exception) { ApiResult.Error(502, "Respuesta de ajustes inválida.") }
    }

    override suspend fun getClientHistory(clientId: String): ApiResult<List<Appointment>> = withContext(Dispatchers.IO) {
        val capturedReadOwner = ownerProvider?.invoke()
        val appointments = mutableListOf<Appointment>()
        var cursor: String? = null
        var pages = 0
        try {
            do {
                verifyReadOwner(capturedReadOwner)
                if (++pages > 100) return@withContext ApiResult.Error(502, "La paginación de historial no finalizó.")
                val url = "${baseUrl.trimEnd('/')}/v1/owner/clients/$clientId/history".toHttpUrl().newBuilder()
                    .addQueryParameter("limit", "100").apply { cursor?.let { addQueryParameter("cursor", it) } }.build()
                executeRead(requestBuilder().url(url).get().build()).use { response ->
                    val body = response.body?.string().orEmpty()
                    if (!response.isSuccessful) return@withContext ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                    val page = json.decodeFromString<ClientHistoryResponse>(body)
                    appointments += page.appointments.map { it.toDomain("") }
                    cursor = page.nextCursor?.takeIf { it.isNotBlank() }
                }
            } while (cursor != null)
            verifyReadOwner(capturedReadOwner)
            ApiResult.Success(appointments)
        } catch (e: IOException) { ApiResult.NetworkError(e) }
        catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { ApiResult.Error(502, "Respuesta de historial inválida.") }
    }

    override suspend fun sendAppointmentNotification(appointmentId: String, kind: AppointmentNotificationKind): ApiResult<Unit> = withContext(Dispatchers.IO) {
        val request = requestBuilder().url("${baseUrl.trimEnd('/')}/v1/owner/appointments/$appointmentId/notify")
            .post(json.encodeToString(NotificationPayload(kind.wireValue)).toRequestBody(mediaType)).build()
        try { okHttpClient.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (response.isSuccessful) ApiResult.Success(Unit) else ApiResult.Error(response.code, extractErrorMessage(body, response.message))
        }} catch (e: IOException) { ApiResult.NetworkError(e) }
    }

    override suspend fun checkSlugAvailability(slug: String, currentBusinessId: String): ApiResult<Boolean> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/business/slug?slug=${slug.trim()}"
        val request = requestBuilder().url(url).get().build()
        try {
            executeRead(request).use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    val available = runCatching {
                        json.parseToJsonElement(body).jsonObject["available"]?.jsonPrimitive?.booleanOrNull
                    }.getOrNull()
                    if (available == null) ApiResult.Error(502, "Respuesta de disponibilidad inválida.") else ApiResult.Success(available)
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        }
    }

    override suspend fun registerDeviceToken(
        token: String,
        appVersion: String
    ): ApiResult<Unit> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/v1/owner/device/token"
        val payload = json.encodeToString(DeviceTokenPayload(token = token))
        val request = requestBuilder()
            .url(url)
            .post(payload.toRequestBody(mediaType))
            .build()
        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    ApiResult.Success(Unit)
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        }
    }

    override suspend fun unregisterDeviceToken(token: String): ApiResult<Unit> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/v1/owner/device/token"
        val payload = json.encodeToString(DeviceTokenPayload(token = token))
        val request = requestBuilder()
            .url(url)
            .delete(payload.toRequestBody(mediaType))
            .build()
        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    ApiResult.Success(Unit)
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        }
    }

    override suspend fun requestAccountDeletion(reason: String): ApiResult<String> = withContext(Dispatchers.IO) {
        val url = "${baseUrl.trimEnd('/')}/v1/owner/account/delete-request"
        val request = requestBuilder()
            .url(url)
            .delete()
            .build()
        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (response.isSuccessful) {
                    val id = runCatching {
                        json.parseToJsonElement(body).jsonObject["requestId"]?.jsonPrimitive?.contentOrNull
                    }.getOrNull()
                    if (id.isNullOrBlank()) ApiResult.Error(502, "El servidor no confirmó la solicitud de baja.") else ApiResult.Success(id)
                } else {
                    ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                }
            }
        } catch (e: IOException) {
            ApiResult.NetworkError(e)
        }
    }

    override suspend fun createMercadoPagoHandoff(): ApiResult<String> = withContext(Dispatchers.IO) {
        val request = requestBuilder().url("${baseUrl.trimEnd('/')}/v1/owner/mercadopago/handoff").post("{}".toRequestBody(mediaType)).build()
        try {
            okHttpClient.newCall(request).execute().use { response ->
                val body = response.body?.string().orEmpty()
                if (!response.isSuccessful) return@use ApiResult.Error(response.code, extractErrorMessage(body, response.message))
                val url = runCatching { json.parseToJsonElement(body).jsonObject["url"]?.jsonPrimitive?.content }.getOrNull()
                if (url.isNullOrBlank()) ApiResult.Error(502, "El servidor no devolvió una URL de conexión.") else ApiResult.Success(url)
            }
        } catch (error: IOException) { ApiResult.NetworkError(error) }
    }

    override suspend fun getMercadoPagoStatus(): ApiResult<MercadoPagoConnectionStatus> = withContext(Dispatchers.IO) {
        val request = requestBuilder().url("${baseUrl.trimEnd('/')}/v1/owner/mercadopago").get().build()
        try { okHttpClient.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (response.isSuccessful) ApiResult.Success(json.decodeFromString<MercadoPagoStatusWire>(body).toDomain())
            else ApiResult.Error(response.code, extractErrorMessage(body, response.message))
        }} catch (e: IOException) { ApiResult.NetworkError(e) }
        catch (_: Exception) { ApiResult.Error(502, "Respuesta de Mercado Pago inválida.") }
    }

    override suspend fun updateMercadoPagoSettings(requireDeposit: Boolean, depositType: String, depositValue: Double): ApiResult<MercadoPagoConnectionStatus> = withContext(Dispatchers.IO) {
        val safeType = depositType.takeIf { it == "fixed" || it == "percentage" }
            ?: return@withContext ApiResult.Error(400, "Tipo de seña inválido.")
        if (depositValue < 0.0) return@withContext ApiResult.Error(400, "El valor de seña no puede ser negativo.")
        val payload = MercadoPagoSettingsWire(requireDeposit, safeType, depositValue)
        val request = requestBuilder().url("${baseUrl.trimEnd('/')}/v1/owner/mercadopago")
            .patch(json.encodeToString(payload).toRequestBody(mediaType)).build()
        try { okHttpClient.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (response.isSuccessful) ApiResult.Success(json.decodeFromString<MercadoPagoStatusWire>(body).toDomain())
            else ApiResult.Error(response.code, extractErrorMessage(body, response.message))
        }} catch (e: IOException) { ApiResult.NetworkError(e) }
        catch (_: Exception) { ApiResult.Error(502, "Respuesta de Mercado Pago inválida.") }
    }

    override suspend fun disconnectMercadoPago(): ApiResult<MercadoPagoConnectionStatus> = withContext(Dispatchers.IO) {
        val request = requestBuilder().url("${baseUrl.trimEnd('/')}/v1/owner/mercadopago").delete().build()
        try { okHttpClient.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            if (response.isSuccessful) ApiResult.Success(json.decodeFromString<MercadoPagoStatusWire>(body).toDomain())
            else ApiResult.Error(response.code, extractErrorMessage(body, response.message))
        }} catch (e: IOException) { ApiResult.NetworkError(e) }
        catch (_: Exception) { ApiResult.Error(502, "Respuesta de Mercado Pago inválida.") }
    }
}
