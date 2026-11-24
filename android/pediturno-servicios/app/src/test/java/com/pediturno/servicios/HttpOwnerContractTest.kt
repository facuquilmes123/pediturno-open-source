package com.pediturno.servicios

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.data.model.AppointmentNotificationKind
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.DepositPaymentState
import com.pediturno.servicios.data.model.SocialLinkType
import com.pediturno.servicios.data.remote.HttpPediturnoRemoteDataSource
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import org.junit.Assert.*
import org.junit.Test

/** Fixtures are exported from authenticated HTTP calls to the actual Next/Firebase emulators. */
class HttpOwnerContractTest {
    private val fixture = Json.parseToJsonElement(requireNotNull(javaClass.classLoader?.getResource("owner-api-contract.json"))
        .readText()).jsonObject
    private val owner = fixture.getValue("ownerId").jsonPrimitive.content
    private val date = fixture.getValue("dateKey").jsonPrimitive.content
    private val responses = fixture.getValue("responses").jsonObject
    private val serviceId = responses.getValue("services").jsonObject.getValue("services").jsonArray.first().jsonObject.getValue("id").jsonPrimitive.content
    private val clientId = responses.getValue("clients").jsonObject.getValue("clients").jsonArray.first().jsonObject.getValue("id").jsonPrimitive.content
    private val requests = mutableListOf<Request>()

    private fun body(request: Request): JsonObject = Json.parseToJsonElement(Buffer().also { request.body!!.writeTo(it) }.readUtf8()).jsonObject
    private fun <T> successful(result: ApiResult<T>): T {
        assertTrue("Expected the real server contract to decode, got $result", result is ApiResult.Success)
        return (result as ApiResult.Success).data
    }

    private fun remote(reply: ((Request) -> String)? = null): HttpPediturnoRemoteDataSource {
        val client = OkHttpClient.Builder().addInterceptor { chain ->
            val request = chain.request()
            requests.add(request)
            val key = when {
                request.url.encodedPath.endsWith("/bootstrap") -> "bootstrap"
                request.url.encodedPath.endsWith("/services") -> "services"
                request.url.encodedPath.endsWith("/clients") -> "clients"
                request.url.encodedPath.endsWith("/agenda") -> "agenda"
                request.url.encodedPath.endsWith("/settings") -> "settings"
                request.url.encodedPath.endsWith("/mercadopago") -> "mercadopago"
                request.url.encodedPath.endsWith("/dashboard") -> "dashboard"
                request.url.encodedPath.endsWith("/availability") -> "availability"
                else -> null
            }
            val json = reply?.invoke(request) ?: key?.let { responses.getValue(it).toString() } ?: "{}"
            Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("Fixture")
                .body(json.toResponseBody("application/json".toMediaType())).build()
        }.build()
        return HttpPediturnoRemoteDataSource("https://pediturno.test/api", { null }, requireAppCheck = false, customClient = client)
    }

    @Test fun `services envelope duration photo and owner adapt the actual server response`() = runBlocking {
        val service = successful(remote().getServices(owner)).single()
        assertEquals(serviceId, service.id)
        assertEquals(45, service.durationMinutes)
        assertEquals(1234.56, service.price, 0.001)
        assertEquals(owner, service.businessId)
        assertEquals("https://example.test/service.png", service.photoUrl)
    }

    @Test fun `legacy service numeric strings keep duration and exact cents`() = runBlocking {
        val original = responses.getValue("services").jsonObject.getValue("services").jsonArray.first().jsonObject
        val legacy = JsonObject(original + mapOf("duration" to JsonPrimitive("45"), "price" to JsonPrimitive("1234.56")))
        val response = JsonObject(mapOf("services" to JsonArray(listOf(legacy))))
        val service = successful(remote { response.toString() }.getServices(owner)).single()
        assertEquals(45, service.durationMinutes)
        assertEquals(1234.56, service.price, 0.001)
        assertEquals(serviceId, service.id)
    }

    @Test fun `custom palette is read from server and survives a profile save`() = runBlocking {
        val bootstrap = responses.getValue("bootstrap").jsonObject
        val business = bootstrap.getValue("business").jsonObject
        val colors = JsonObject(mapOf("primary" to JsonPrimitive("#112233"), "background" to JsonPrimitive("#F1F2F3"), "accent" to JsonPrimitive("#445566")))
        val payload = JsonObject(bootstrap + ("business" to JsonObject(business + mapOf("theme" to JsonPrimitive("custom"), "customTheme" to colors))))
        val remote = remote { request -> if (request.method == "GET") payload.toString() else "{}" }
        val profile = successful(remote.getBusinessProfile(owner))
        assertEquals("#112233", profile.customTheme.primary)
        assertEquals("#F1F2F3", profile.customTheme.background)
        successful(remote.updateFullBusinessProfile(profile))
        assertEquals(colors, body(requests.first { it.method == "POST" }).getValue("customTheme"))
    }

    @Test fun `nullable legacy customer and appointment fields are safe domain values`() = runBlocking {
        val remote = remote()
        val client = successful(remote.getClients(owner)).single()
        assertEquals(clientId, client.id)
        assertEquals("", client.email)
        assertEquals(owner, client.businessId)
        val appointment = successful(remote.getAppointments(date, owner)).single()
        assertEquals(owner, appointment.businessId)
        assertEquals("", appointment.clientEmail)
        assertEquals(1234.56, appointment.priceAtBooking, 0.001)
        assertEquals(0.0, appointment.depositAmount, 0.001)
    }

    @Test fun `paid deposit amount from server is retained and displayed as paid`() = runBlocking {
        val envelope = responses.getValue("agenda").jsonObject
        val original = envelope.getValue("appointments").jsonArray.first().jsonObject
        val paid = JsonObject(original + mapOf("paymentStatus" to JsonPrimitive("paid"), "depositAmount" to JsonPrimitive(90.0), "depositPaid" to JsonPrimitive(90.0)))
        val payload = JsonObject(envelope + ("appointments" to JsonArray(listOf(paid))))
        val appointment = successful(remote { payload.toString() }.getAppointments(date, owner)).single()
        assertEquals(90.0, appointment.depositPaid, 0.001)
        assertEquals(DepositPaymentState.PAID, appointment.depositState)
    }

    @Test fun `review overrides paid amount and survives the account scoped cache`() = runBlocking {
        val envelope = responses.getValue("agenda").jsonObject
        val original = envelope.getValue("appointments").jsonArray.first().jsonObject
        val review = JsonObject(original + mapOf("paymentStatus" to JsonPrimitive("paid"), "depositAmount" to JsonPrimitive(90.0), "depositPaid" to JsonPrimitive(90.0), "paymentReviewRequired" to JsonPrimitive(true)))
        val payload = JsonObject(envelope + ("appointments" to JsonArray(listOf(review))))
        val appointment = successful(remote { payload.toString() }.getAppointments(date, owner)).single()
        assertTrue(appointment.paymentReviewRequired)
        assertEquals(DepositPaymentState.REVIEW, appointment.depositState)
        val restored = Json.decodeFromString(Appointment.serializer(), Json.encodeToString(Appointment.serializer(), appointment))
        assertEquals(DepositPaymentState.REVIEW, restored.depositState)
        assertEquals(90.0, restored.depositPaid, 0.001)
    }

    @Test fun `pending expired and reversed deposits never appear paid despite an old amount`() = runBlocking {
        val envelope = responses.getValue("agenda").jsonObject
        val original = envelope.getValue("appointments").jsonArray.first().jsonObject
        for ((status, expected) in listOf("pending" to DepositPaymentState.PENDING, "expired" to DepositPaymentState.EXPIRED, "reversal_review" to DepositPaymentState.REVIEW)) {
            val deposit = JsonObject(original + mapOf("paymentStatus" to JsonPrimitive(status), "depositAmount" to JsonPrimitive(90.0), "depositPaid" to JsonPrimitive(90.0)))
            val payload = JsonObject(envelope + ("appointments" to JsonArray(listOf(deposit))))
            assertEquals(expected, successful(remote { payload.toString() }.getAppointments(date, owner)).single().depositState)
        }
    }

    @Test fun `agenda follows opaque cursor and fails instead of returning a partial day`() = runBlocking {
        val envelope = responses.getValue("agenda").jsonObject
        val original = envelope.getValue("appointments").jsonArray.first().jsonObject
        fun page(id: String, next: String?) = JsonObject(envelope + mapOf(
            "appointments" to JsonArray(listOf(JsonObject(original + ("id" to JsonPrimitive(id))))),
            "nextCursor" to (next?.let { JsonPrimitive(it) } ?: JsonNull)
        )).toString()
        val complete = remote { request ->
            if (request.url.queryParameter("cursor") == null) page("page-one-appointment", "page-two")
            else page("page-two-appointment", null)
        }
        assertEquals(setOf("page-one-appointment", "page-two-appointment"),
            successful(complete.getAppointments(date, owner)).map { it.id }.toSet())
        assertEquals("page-two", requests.last().url.queryParameter("cursor"))
        val failedSecondPage = remote { request ->
            if (request.url.queryParameter("cursor") == null) page("partial-appointment", "page-two")
            else "{invalid-json"
        }
        assertTrue(failedSecondPage.getAppointments(date, owner) is ApiResult.Error)
    }

    @Test fun `profile translates nested rules social enum logo and effective membership`() = runBlocking {
        val profile = successful(remote().getBusinessProfile(owner))
        assertEquals("https://example.test/logo.png", profile.logoUrl)
        assertEquals(2, profile.bookingRules.leadTimeHours)
        assertEquals(10, profile.bookingRules.bufferMinutes)
        assertTrue(profile.bookingRules.notifyNewByEmail)
        assertEquals(SocialLinkType.INSTAGRAM, profile.socialLinks.single().type)
        assertTrue(profile.membership.isOperational)
        assertFalse(profile.mercadopago.isConnected)
    }

    @Test fun `profile optional object fields can be explicit JSON null from server`() = runBlocking {
        val bootstrap = responses.getValue("bootstrap").jsonObject
        val originalBusiness = bootstrap.getValue("business").jsonObject
        val nullableFields = listOf("address", "location", "customTheme", "bookingSettings", "mercadopago")
        val business = JsonObject(originalBusiness + nullableFields.associateWith { JsonNull })
        val reply = JsonObject(bootstrap + ("business" to business))
        val profile = successful(remote { reply.toString() }.getBusinessProfile(owner))
        assertEquals(owner, profile.id)
        assertNull(profile.location)
        assertEquals("", profile.address.street)
        assertFalse(profile.mercadopago.isConnected)
    }

    @Test fun `owner settings round trip uses v1 names and hours instead of discarded root fields`() = runBlocking {
        val remote = remote()
        val settings = successful(remote.getOwnerSettings())
        successful(remote.updateOwnerSettings(settings))
        val patch = requests.last()
        assertEquals("PATCH", patch.method)
        assertEquals("/api/v1/owner/settings", patch.url.encodedPath)
        val payload = body(patch)
        assertEquals("2", payload.getValue("bookingLeadTimeHours").jsonPrimitive.content)
        assertEquals("10", payload.getValue("appointmentBufferMinutes").jsonPrimitive.content)
        assertTrue("remindersEnabled" in payload)
        assertFalse("leadTimeMinutes" in payload)
        assertFalse("bookingRules" in payload)
    }

    @Test fun `FCM registration and account deletion cannot regress to wrong HTTP verbs`() = runBlocking {
        val remote = remote { request -> if (request.url.encodedPath.endsWith("/delete-request")) """{"requestId":"request-fixture"}""" else "{}" }
        successful(remote.registerDeviceToken("local-only-test-device-token-for-contract", "1.0.0"))
        val registration = requests.last()
        assertEquals("POST", registration.method)
        assertEquals(setOf("token", "platform"), body(registration).keys)
        successful(remote.unregisterDeviceToken("local-only-test-device-token-for-contract"))
        assertEquals("DELETE", requests.last().method)
        assertEquals(setOf("token", "platform"), body(requests.last()).keys)
        assertEquals("request-fixture", successful(remote.requestAccountDeletion("Motivo con \"comillas\"\ny salto")))
        assertEquals("DELETE", requests.last().method)
        assertEquals("/api/v1/owner/account/delete-request", requests.last().url.encodedPath)
    }

    @Test fun `service CRUD uses collection route id body and backend-authoritative reread`() = runBlocking {
        val remote = remote { request ->
            if (request.method == "GET") responses.getValue("services").toString()
            else """{"id":"$serviceId"}"""
        }
        successful(remote.saveService("Servicio contrato", 45, 1234.56, serviceId = serviceId, businessId = owner))
        val patch = requests.first { it.method == "PATCH" }
        assertEquals("/api/v1/owner/services", patch.url.encodedPath)
        assertEquals(serviceId, body(patch).getValue("id").jsonPrimitive.content)
        assertFalse("serviceId" in body(patch))
        successful(remote.deleteService(serviceId, owner))
        assertEquals("DELETE", requests.last().method)
        assertEquals("/api/v1/owner/services", requests.last().url.encodedPath)
        assertEquals(setOf("id"), body(requests.last()).keys)
    }

    @Test fun `new service omits null id and photo and sends canonical string price`() = runBlocking {
        val remote = remote { request -> if (request.method == "POST") """{"id":"$serviceId"}""" else responses.getValue("services").toString() }
        successful(remote.saveService("Servicio contrato", 45, 1234.56, status = "Pausado", businessId = owner))
        val write = body(requests.first { it.method == "POST" })
        assertFalse("A new service must omit id rather than send null", "id" in write)
        assertFalse("An absent photo must be omitted", "photo" in write)
        assertTrue(write.getValue("price").jsonPrimitive.isString)
        assertEquals("1234.56", write.getValue("price").jsonPrimitive.content)
        assertEquals("Pausado", write.getValue("status").jsonPrimitive.content)
        assertEquals(JsonNull, write["bookingBufferMinutes"])
    }

    @Test fun `client without optional image and email sends valid fields and update clears email`() = runBlocking {
        val remote = remote { request -> if (request.method == "POST") """{"id":"$clientId"}""" else responses.getValue("clients").toString() }
        val created = successful(remote.createClient("Cliente", "549110000001", "", businessId = owner))
        val create = body(requests.first { it.method == "POST" })
        assertFalse("An absent avatar must be omitted", "avatar" in create)
        assertEquals("", create.getValue("email").jsonPrimitive.content)
        successful(remote.updateClient(created.copy(email = "", avatarUrl = null)))
        val update = body(requests.last { it.method == "PATCH" })
        assertEquals("", update.getValue("email").jsonPrimitive.content)
        assertFalse("avatar" in update)
    }

    @Test fun `profile without optional logo or notification email sends API compatible empty strings`() = runBlocking {
        val remote = remote { request -> if (request.method == "POST") "{}" else responses.getValue("bootstrap").toString() }
        val loaded = successful(remote.getBusinessProfile(owner))
        val profile = loaded.copy(logoUrl = null, bookingRules = loaded.bookingRules.copy(notificationEmail = "", notifyNewByEmail = false))
        successful(remote.updateFullBusinessProfile(profile))
        val write = body(requests.first { it.method == "POST" })
        assertEquals("", write.getValue("logo").jsonPrimitive.content)
        assertEquals(profile.socialLinks.single().id, write.getValue("socialLinks").jsonArray.single().jsonObject.getValue("id").jsonPrimitive.content)
        assertEquals("", write.getValue("bookingSettings").jsonObject.getValue("notificationEmail").jsonPrimitive.content)
        assertFalse("mercadopago" in write)
        assertFalse("membership" in write)
    }

    @Test fun `settings explicitly clear a disabled notification email using an empty string`() = runBlocking {
        val remote = remote { """{"bookingSettings":{"notificationEmail":"","newAppointmentNotificationsEnabled":false}}""" }
        val settings = successful(remote.getOwnerSettings()).copy(notificationEmail = "", notifyNewByEmail = false)
        successful(remote.updateOwnerSettings(settings))
        assertEquals("", body(requests.last { it.method == "PATCH" }).getValue("notificationEmail").jsonPrimitive.content)
    }

    @Test fun `availability and dashboard consume server results instead of local schedules`() = runBlocking {
        val remote = remote()
        val slots = successful(remote.getAvailability(serviceId, date, "appointment-to-exclude"))
        assertTrue(slots.isNotEmpty())
        assertEquals("appointment-to-exclude", requests.last().url.queryParameter("excludeAppointmentId"))
        val dashboard = successful(remote.getDashboard(date.take(7)))
        assertEquals(responses.getValue("dashboard").jsonObject.getValue("monthlyRevenue").jsonPrimitive.content.toDouble(), dashboard.monthlyRevenue, 0.001)
        assertEquals(responses.getValue("dashboard").jsonObject.getValue("upcomingAppointments").jsonArray.first().jsonObject.getValue("id").jsonPrimitive.content,
            dashboard.upcomingAppointments.first().id)
    }

    @Test fun `notify sends the accepted kind to the owner scoped v1 route`() = runBlocking {
        val kind = AppointmentNotificationKind.entries.first { it.wireValue == "confirmation" }
        successful(remote { """{"status":"queued"}""" }.sendAppointmentNotification("appointment-fixture", kind))
        assertEquals("POST", requests.last().method)
        assertEquals("/api/v1/owner/appointments/appointment-fixture/notify", requests.last().url.encodedPath)
        assertEquals(setOf("kind"), body(requests.last()).keys)
    }

    @Test fun `reschedule accepts the server acknowledgement instead of requiring a full appointment`() = runBlocking {
        val appointmentId = "appointment-fixture"
        val time = "09:00"
        val remote = remote {
            """{"appointment":{"id":"$appointmentId","date":"2026-10-29T03:00:00.000Z","time":"$time"}}"""
        }

        assertEquals(Unit, successful(remote.rescheduleAppointment(appointmentId, date, time, owner)))
        val request = requests.last()
        assertEquals("POST", request.method)
        assertEquals("/api/owner/appointments/$appointmentId/reschedule", request.url.encodedPath)
        assertEquals(date, body(request).getValue("dateKey").jsonPrimitive.content)
        assertEquals(time, body(request).getValue("time").jsonPrimitive.content)
    }

    @Test fun `reschedule rejects an acknowledgement for another appointment`() = runBlocking {
        val result = remote {
            """{"appointment":{"id":"another-appointment","date":"2026-10-29T03:00:00.000Z","time":"09:00"}}"""
        }.rescheduleAppointment("appointment-fixture", date, "09:00", owner)

        assertTrue(result is ApiResult.Error)
    }

    @Test fun `malformed successful reads are recoverable errors`() = runBlocking {
        val remote = remote { "<html>proxy instead of JSON</html>" }
        assertTrue(remote.getServices(owner) is ApiResult.Error)
        assertTrue(remote.getClients(owner) is ApiResult.Error)
        assertTrue(remote.getAppointments(date, owner) is ApiResult.Error)
        assertTrue(remote.getBusinessProfile(owner) is ApiResult.Error)
    }

    @Test fun `malformed successful writes do not crash the calling screen`() = runBlocking {
        val remote = remote { "<html>proxy instead of JSON</html>" }
        assertTrue(remote.saveService("Servicio contrato", 45, 1234.56, businessId = owner) is ApiResult.Error)
        assertTrue(remote.createClient("Cliente contrato", "5491112345678", businessId = owner) is ApiResult.Error)
    }
    @Test fun `service retry after a lost response and repository recreation keeps one durable operation`() = runBlocking {
        val directory = java.nio.file.Files.createTempDirectory("pediturno-service-retry").toFile()
        val operations = mutableSetOf<String>()
        var posts = 0
        val transport = remote { request ->
            if (request.method == "POST") {
                posts++
                operations += request.header("X-Idempotency-Key") ?: "missing-$posts"
                if (posts == 1) throw java.io.IOException("simulated response lost after commit")
                """{"id":"$serviceId"}"""
            } else responses.getValue("services").toString()
        }
        try {
            val first = com.pediturno.servicios.data.repository.AgendaRepository(transport, directory)
                .saveService("QA retry", 30, 100.0, "Pausado", businessId = owner)
            assertTrue(first is ApiResult.NetworkError)
            successful(com.pediturno.servicios.data.repository.AgendaRepository(transport, directory)
                .saveService("QA retry", 30, 100.0, "Pausado", businessId = owner))
            assertEquals(1, operations.size)
            assertFalse(operations.single().startsWith("missing-"))
        } finally {
            require(directory.canonicalPath.startsWith(java.io.File(System.getProperty("java.io.tmpdir")).canonicalPath))
            directory.deleteRecursively()
        }
    }

}
