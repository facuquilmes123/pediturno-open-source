package com.pediturno.servicios.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

@Immutable
@Serializable
data class ClientItem(
    val id: String,
    val name: String,
    val phone: String,
    val email: String = "",
    val avatarUrl: String? = null,
    val totalBookings: Int = 0,
    val lastVisitDateKey: String? = null,
    val notes: String = "",
    val businessId: String
)
