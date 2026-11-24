package com.pediturno.servicios.domain.usecase

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.repository.AgendaRepository

class UpdateAppointmentStatusUseCase(
    private val agendaRepository: AgendaRepository
) {
    suspend operator fun invoke(
        appointmentId: String,
        dateKey: String,
        newStatus: AppointmentStatus,
        businessId: String
    ): ApiResult<Unit> {
        return agendaRepository.updateAppointmentStatus(appointmentId, dateKey, newStatus, businessId)
    }
}
