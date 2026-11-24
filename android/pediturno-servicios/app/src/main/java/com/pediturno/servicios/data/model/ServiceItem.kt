package com.pediturno.servicios.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

@Immutable
@Serializable
data class DayScheduleSlot(
    val start: String,
    val end: String
)

@Immutable
@Serializable
data class DaySchedule(
    val slots: List<DayScheduleSlot> = emptyList(),
    val isAlternating: Boolean = false
)

@Immutable
@Serializable
data class ServiceItem(
    val id: String,
    val name: String,
    val durationMinutes: Int,
    val price: Double,
    val status: String = "Activo",
    val businessId: String,
    val category: String = "General",
    val requiresDeposit: Boolean = false,
    val photoUrl: String? = null,
    val bookingBufferMinutes: Int? = null,
    val workingHours: Map<Int, DaySchedule> = emptyMap(), // 0=Dom, 1=Lun, ..., 6=Sáb
    val unavailableDates: List<String> = emptyList() // YYYY-MM-DD
) {
    val isActive: Boolean
        get() = status.equals("Activo", ignoreCase = true) || status.equals("active", ignoreCase = true)

    val effectiveBufferMinutes: Int
        get() = bookingBufferMinutes ?: 15
}
