package com.pediturno.servicios.data.repository

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import com.google.firebase.messaging.FirebaseMessaging
import com.pediturno.servicios.BuildConfig
import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.data.remote.PediturnoRemoteDataSource
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.tasks.await

data class PushDiagnosticEvent(val id: String = UUID.randomUUID().toString(), val title: String, val body: String, val appointmentId: String, val dateKey: String, val timestampLabel: String)

class PushRepository(private val remoteDataSource: PediturnoRemoteDataSource) {
    companion object { const val CHANNEL_APPOINTMENTS = "booking_updates"; const val CHANNEL_NAME = "Turnos y modificaciones" }
    private val _currentToken = MutableStateFlow<String?>(null)
    val currentToken: StateFlow<String?> = _currentToken.asStateFlow()
    private val _recentPushEvents = MutableStateFlow<List<PushDiagnosticEvent>>(emptyList())
    val recentPushEvents: StateFlow<List<PushDiagnosticEvent>> = _recentPushEvents.asStateFlow()
    fun setupNotificationChannels(context: Context) { (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).createNotificationChannel(NotificationChannel(CHANNEL_APPOINTMENTS, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH)) }
    suspend fun ensureRegistered(): ApiResult<Unit> = try { registerToken(FirebaseMessaging.getInstance().token.await()) } catch (error: Exception) { ApiResult.NetworkError(error) }
    /** Compatibility action: asks FCM for the currently valid token, never manufactures one locally. */
    suspend fun rotateToken(): ApiResult<String> = try {
        val token = FirebaseMessaging.getInstance().token.await()
        when (val result = registerToken(token)) { is ApiResult.Success -> ApiResult.Success(token); is ApiResult.Error -> result; is ApiResult.NetworkError -> result }
    } catch (error: Exception) { ApiResult.NetworkError(error) }
    suspend fun registerToken(token: String): ApiResult<Unit> { if (token.isBlank()) return ApiResult.Error(400, "Token FCM vacío"); return remoteDataSource.registerDeviceToken(token, BuildConfig.VERSION_NAME).also { if (it is ApiResult.Success) _currentToken.value = token } }
    suspend fun unregisterCurrentToken(): ApiResult<Unit> { val token = _currentToken.value ?: return ApiResult.Success(Unit); return remoteDataSource.unregisterDeviceToken(token).also { if (it is ApiResult.Success) _currentToken.value = null } }
    fun clearSession(context: Context) {
        _currentToken.value = null
        _recentPushEvents.value = emptyList()
        (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).cancelAll()
    }
    fun recordPushEvent(event: PushDiagnosticEvent) { _recentPushEvents.value = (listOf(event) + _recentPushEvents.value).take(10) }
}
