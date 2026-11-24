package com.pediturno.servicios.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

@Immutable
@Serializable
data class UserSession(
    val uid: String = "",
    val email: String = "",
    val displayName: String = "",
    val token: String = "",
    val activeBusinessId: String = "",
    val isAuthenticated: Boolean = false
)
