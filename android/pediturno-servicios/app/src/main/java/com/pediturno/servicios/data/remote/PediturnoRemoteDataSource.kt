package com.pediturno.servicios.data.remote

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.model.AppointmentNotificationKind
import com.pediturno.servicios.data.model.BusinessProfile
import com.pediturno.servicios.data.model.ClientItem
import com.pediturno.servicios.data.model.DaySchedule
import com.pediturno.servicios.data.model.ServiceItem
import com.pediturno.servicios.data.model.BookingRules
import com.pediturno.servicios.data.model.MercadoPagoConnectionStatus
import com.pediturno.servicios.data.model.DashboardSummary
import com.pediturno.servicios.core.timezone.SlotAvailability

interface PediturnoRemoteDataSource {
    suspend fun getAppointments(
        dateKey: String,
        businessId: String
    ): ApiResult<List<Appointment>>

    suspend fun createAppointment(
        client: String,
        clientPhone: String,
        clientEmail: String,
        serviceId: String,
        dateKey: String,
        time: String,
        status: AppointmentStatus = AppointmentStatus.Confirmado,
        idempotencyKey: String? = null,
        businessId: String
    ): ApiResult<String>

    suspend fun rescheduleAppointment(
        appointmentId: String,
        dateKey: String,
        time: String,
        businessId: String
    ): ApiResult<Unit>

    suspend fun updateAppointmentStatus(
        appointmentId: String,
        status: AppointmentStatus,
        businessId: String
    ): ApiResult<Unit>

    suspend fun getServices(
        businessId: String
    ): ApiResult<List<ServiceItem>>

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
        businessId: String,
        idempotencyKey: String? = null
    ): ApiResult<ServiceItem>

    suspend fun deleteService(
        serviceId: String,
        businessId: String
    ): ApiResult<Unit>

    suspend fun getClients(
        businessId: String
    ): ApiResult<List<ClientItem>>

    suspend fun createClient(
        name: String,
        phone: String,
        email: String = "",
        notes: String = "",
        avatarUrl: String? = null,
        businessId: String
    ): ApiResult<ClientItem>

    suspend fun updateClient(
        client: ClientItem
    ): ApiResult<ClientItem>

    suspend fun deleteClient(clientId: String): ApiResult<Unit>

    suspend fun getBusinessProfile(
        businessId: String
    ): ApiResult<BusinessProfile>

    /** Creates the first server-owned Servicios profile after Firebase sign-in. */
    suspend fun createBusinessProfile(name: String): ApiResult<Unit>

    suspend fun getAvailability(serviceId: String, dateKey: String, excludeAppointmentId: String? = null): ApiResult<List<SlotAvailability>>
    suspend fun getDashboard(monthKey: String): ApiResult<DashboardSummary>

    suspend fun updateBusinessSettings(
        leadTimeMinutes: Int,
        horizonDays: Int,
        bufferMinutes: Int,
        autoConfirm: Boolean,
        businessId: String
    ): ApiResult<BusinessProfile>

    suspend fun getOwnerSettings(): ApiResult<BookingRules>
    suspend fun updateOwnerSettings(settings: BookingRules): ApiResult<BookingRules>

    suspend fun getClientHistory(clientId: String): ApiResult<List<Appointment>>
    suspend fun sendAppointmentNotification(appointmentId: String, kind: AppointmentNotificationKind): ApiResult<Unit>

    suspend fun updateFullBusinessProfile(
        profile: BusinessProfile
    ): ApiResult<BusinessProfile>

    suspend fun checkSlugAvailability(
        slug: String,
        currentBusinessId: String
    ): ApiResult<Boolean>

    suspend fun registerDeviceToken(
        token: String,
        appVersion: String = "1.0.0"
    ): ApiResult<Unit>

    suspend fun unregisterDeviceToken(
        token: String
    ): ApiResult<Unit>

    suspend fun requestAccountDeletion(
        reason: String
    ): ApiResult<String>

    suspend fun createMercadoPagoHandoff(): ApiResult<String>
    suspend fun getMercadoPagoStatus(): ApiResult<MercadoPagoConnectionStatus>
    suspend fun updateMercadoPagoSettings(requireDeposit: Boolean, depositType: String, depositValue: Double): ApiResult<MercadoPagoConnectionStatus>
    suspend fun disconnectMercadoPago(): ApiResult<MercadoPagoConnectionStatus>
}
