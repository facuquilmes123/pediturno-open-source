package com.pediturno.servicios.service

import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import com.google.firebase.auth.FirebaseAuth
import com.pediturno.servicios.PediturnoApp
import com.pediturno.servicios.data.repository.PushDiagnosticEvent
import com.pediturno.servicios.data.repository.PushRepository
import com.pediturno.servicios.ui.MainActivity
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

class PediturnoFirebaseMessagingService : FirebaseMessagingService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    override fun onNewToken(token: String) { scope.launch { (application as? PediturnoApp)?.pushRepository?.registerToken(token) } }
    override fun onMessageReceived(message: RemoteMessage) { dispatchNotification(this, message.data, message.notification?.title, message.notification?.body) }
    companion object {
        const val EXTRA_APPOINTMENT_ID = "appointmentId"; const val EXTRA_DATE_KEY = "dateKey"
        const val EXTRA_DESTINATION = "destination"
        const val EXTRA_OWNER_ID = "ownerId"
        fun dispatchNotification(context: Context, data: Map<String, String>, remoteTitle: String? = null, remoteBody: String? = null) {
            val ownerId = runCatching { FirebaseAuth.getInstance().currentUser?.uid }.getOrNull()
            if (!OwnerPushPolicy.accepts(data, ownerId)) return
            val appointmentId = data[EXTRA_APPOINTMENT_ID]?.takeIf { it.isNotBlank() }
            if (appointmentId == null && data["destination"] != "agenda") return
            val dateKey = data[EXTRA_DATE_KEY].orEmpty(); val client = data["client"].orEmpty().ifBlank { "Cliente" }; val service = data["service"].orEmpty().ifBlank { "Servicio" }; val time = data["time"].orEmpty()
            val title = remoteTitle?.takeIf { it.isNotBlank() } ?: "Agenda actualizada"
            val body = remoteBody?.takeIf { it.isNotBlank() } ?: if (appointmentId == null) "Tenés una nueva reserva. Abrí la agenda para verla." else "$client — $service${if (time.isBlank()) "" else " • $time"}"
            (context.applicationContext as? PediturnoApp)?.pushRepository?.recordPushEvent(PushDiagnosticEvent(title = title, body = body, appointmentId = appointmentId.orEmpty(), dateKey = dateKey, timestampLabel = LocalTime.now().format(DateTimeFormatter.ofPattern("HH:mm"))))
            if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(context, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return
            val target = Intent(context, MainActivity::class.java).apply { flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP; appointmentId?.let { putExtra(EXTRA_APPOINTMENT_ID, it) }; putExtra(EXTRA_DATE_KEY, dateKey); putExtra(EXTRA_DESTINATION, "agenda"); putExtra(EXTRA_OWNER_ID, ownerId) }
            val pending = PendingIntent.getActivity(context, (appointmentId ?: "agenda").hashCode(), target, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            val notification = NotificationCompat.Builder(context, PushRepository.CHANNEL_APPOINTMENTS).setSmallIcon(android.R.drawable.ic_dialog_info).setContentTitle(title).setContentText(body).setContentIntent(pending).setAutoCancel(true).build()
            (context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager).notify((appointmentId ?: "agenda").hashCode(), notification)
        }
    }
}
