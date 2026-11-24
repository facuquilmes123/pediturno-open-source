package com.pediturno.servicios.domain.usecase

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.repository.AgendaRepository

class CreateAppointmentUseCase(
    private val agendaRepository: AgendaRepository
) {
    suspend operator fun invoke(
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
        val trimmedClient = client.trim()
        val digitsOnly = clientPhone.filter { it.isDigit() }

        if (trimmedClient.length < 2) {
            return ApiResult.Error(400, "El nombre del cliente debe tener al menos 2 caracteres.")
        }
        if (digitsOnly.length < 6) {
            return ApiResult.Error(400, "El teléfono debe contener al menos 6 dígitos numéricos.")
        }
        if (!time.matches(Regex("^([01]\\d|2[0-3]):[0-5]\\d$"))) {
            return ApiResult.Error(400, "Horario inválido (formato HH:mm esperado).")
        }

        return agendaRepository.createAppointment(
            client = trimmedClient,
            clientPhone = clientPhone.trim(),
            clientEmail = clientEmail.trim(),
            serviceId = serviceId,
            dateKey = dateKey,
            time = time,
            status = status,
            idempotencyKey = idempotencyKey,
            businessId = businessId,
            maxRetriesOnNetworkDrop = maxRetriesOnNetworkDrop
        )
    }
}
