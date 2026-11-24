package com.pediturno.servicios.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

@Serializable
enum class AppointmentStatus(val label: String) {
    Confirmado("Confirmado"),
    Pendiente("Pendiente"),
    Completado("Completado"),
    Cancelado("Cancelado");

    /**
     * Paridad exacta con `src/lib/appointment-state.ts` (`ALLOWED_STATUS_TRANSITIONS`)
     * y bloqueo de confirmación/completado cuando existe pago/seña pendiente.
     */
    fun canTransitionTo(next: AppointmentStatus, paymentStatus: String? = null): Boolean {
        if (this == next) return true
        if (paymentStatus.equals("pending", ignoreCase = true) &&
            (next == Confirmado || next == Completado)
        ) {
            return false
        }
        return when (this) {
            Pendiente -> next == Confirmado || next == Completado || next == Cancelado
            Confirmado -> next == Completado || next == Cancelado
            Completado -> false
            Cancelado -> false
        }
    }

    val isTerminal: Boolean
        get() = this == Completado || this == Cancelado

    companion object {
        fun fromString(value: String): AppointmentStatus {
            return entries.firstOrNull { it.name.equals(value.trim(), ignoreCase = true) } ?: Pendiente
        }
    }
}

@Immutable
@Serializable
data class Appointment(
    val id: String,
    val client: String,
    val clientPhone: String,
    val clientEmail: String = "",
    val serviceId: String,
    val service: String,
    val dateKey: String,
    val time: String,
    val durationMinutes: Int,
    val bookingBufferMinutes: Int = 15,
    val priceAtBooking: Double,
    val status: AppointmentStatus,
    val businessId: String,
    val paymentStatus: String? = null,
    val depositAmount: Double = 0.0,
    val depositPaid: Double = 0.0,
    val paymentReviewRequired: Boolean = false,
    val notes: String = "",
    val fromCache: Boolean = false
) {
    val depositState: DepositPaymentState
        get() = when {
            depositAmount <= 0.0 -> DepositPaymentState.NONE
            paymentReviewRequired || paymentStatus in listOf("review", "reversal_review", "refunded", "charged_back") -> DepositPaymentState.REVIEW
            paymentStatus == "paid" && depositPaid >= depositAmount -> DepositPaymentState.PAID
            paymentStatus == "expired" -> DepositPaymentState.EXPIRED
            else -> DepositPaymentState.PENDING
        }
}

enum class DepositPaymentState { NONE, PENDING, PAID, REVIEW, EXPIRED }
