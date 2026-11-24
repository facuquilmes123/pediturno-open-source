package com.pediturno.servicios.data.model

import androidx.compose.runtime.Immutable

/** Owner dashboard values calculated by the server, never from locally cached bookings. */
@Immutable
data class DashboardSummary(
    val monthKey: String,
    val timeZone: String,
    val upcomingAppointmentsCount: Int,
    val totalClients: Int,
    val monthlyRevenue: Double,
    val upcomingAppointments: List<Appointment>
)
