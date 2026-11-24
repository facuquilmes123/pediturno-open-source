package com.pediturno.servicios.domain.usecase

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.data.repository.AgendaRepository

class RescheduleAppointmentUseCase(
    private val agendaRepository: AgendaRepository
) {
    suspend operator fun invoke(
        appointmentId: String,
        dateKey: String,
        time: String,
        businessId: String
    ): ApiResult<Unit> {
        if (!time.matches(Regex("^([01]\\d|2[0-3]):[0-5]\\d$"))) {
            return ApiResult.Error(400, "Horario inválido (formato HH:mm esperado).")
        }
        return agendaRepository.rescheduleAppointment(appointmentId, dateKey, time, businessId)
    }
}
