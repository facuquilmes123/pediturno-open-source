package com.pediturno.servicios.ui

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.os.Build
import com.google.firebase.auth.FirebaseAuth
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import android.net.Uri
import androidx.compose.ui.Modifier
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.pediturno.servicios.PediturnoApp
import com.pediturno.servicios.core.theme.PediturnoTheme
import com.pediturno.servicios.service.PediturnoFirebaseMessagingService
import com.pediturno.servicios.ui.agenda.releaseDraftPhotos
import com.pediturno.servicios.ui.agenda.AgendaScreen
import com.pediturno.servicios.ui.agenda.AgendaViewModel
import com.pediturno.servicios.ui.agenda.AccountDeletionReceiptScreen
import com.pediturno.servicios.ui.auth.LoginScreen
import com.pediturno.servicios.ui.auth.LoginViewModel
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.withContext
import coil3.SingletonImageLoader
import com.pediturno.servicios.data.export.EncryptedExportPayloadStore
import com.pediturno.servicios.data.export.AgendaExportSnapshot
import com.pediturno.servicios.data.model.ClientItem
import kotlinx.serialization.builtins.ListSerializer
import androidx.compose.runtime.key

class MainActivity : ComponentActivity() {

    private var pendingDeepLinkAppointmentId by mutableStateOf<String?>(null)
    private var pendingDeepLinkDateKey by mutableStateOf<String?>(null)
    private var pendingAgendaOpen by mutableStateOf(false)
    private var workspaceResumeGeneration by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.BLACK),
            navigationBarStyle = SystemBarStyle.dark(Color.BLACK)
        )
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            window.isNavigationBarContrastEnforced = false
        }
        extractDeepLinkFromIntent(intent)

        val app = application as PediturnoApp

        val agendaViewModelFactory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                return AgendaViewModel(
                    agendaRepository = app.agendaRepository,
                    createAppointmentUseCase = app.createAppointmentUseCase,
                    rescheduleAppointmentUseCase = app.rescheduleAppointmentUseCase,
                    updateAppointmentStatusUseCase = app.updateAppointmentStatusUseCase,
                    timeZoneManager = app.timeZoneManager,
                    authRepository = app.authRepository,
                    pushRepository = app.pushRepository,
                    billingRepository = app.googlePlayBillingRepository,
                    billingBackend = app.googlePlayBillingBackend,
                    imageRepository = app.businessImageRepository,
                    packageName = packageName,
                    agendaExportStore = EncryptedExportPayloadStore(applicationContext, app.authRepository.session.value.uid, "agenda", AgendaExportSnapshot.serializer(), currentOwner = { app.authRepository.session.value.takeIf { it.isAuthenticated }?.uid }),
                    clientsExportStore = EncryptedExportPayloadStore(applicationContext, app.authRepository.session.value.uid, "clients", ListSerializer(ClientItem.serializer()), currentOwner = { app.authRepository.session.value.takeIf { it.isAuthenticated }?.uid })
                ) as T
            }
        }

        val loginViewModelFactory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T {
                return LoginViewModel(
                    authRepository = app.authRepository
                ) as T
            }
        }

        setContent {
            PediturnoTheme {
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    val session by app.authRepository.session.collectAsStateWithLifecycle()
                    val workspaceStore: WorkspaceSessionStoreViewModel = viewModel()
                    var deletionReceipt by rememberSaveable { mutableStateOf<String?>(null) }

                    if (deletionReceipt != null) {
                        LaunchedEffect(deletionReceipt) {
                            workspaceStore.clearAccount()
                            releaseDraftPhotos()
                            app.authRepository.logout()
                            app.pushRepository.clearSession(this@MainActivity)
                            val images = SingletonImageLoader.get(this@MainActivity)
                            images.memoryCache?.clear()
                            withContext(Dispatchers.IO) {
                                app.agendaRepository.clearCachedAgenda()
                                images.diskCache?.clear()
                            }
                        }
                        AccountDeletionReceiptScreen(deletionReceipt!!, onContinue = { deletionReceipt = null })
                    } else if (session.isAuthenticated) {
                        val sessionStoreOwner = workspaceStore.forAccount(session.uid)
                        val agendaViewModel: AgendaViewModel = viewModel(
                            viewModelStoreOwner = sessionStoreOwner,
                            key = "agenda:${session.uid}",
                            factory = agendaViewModelFactory
                        )

                        workspaceStore.attachCleanup(agendaViewModel::clearForSessionChange)

                        LaunchedEffect(session.uid, workspaceResumeGeneration) {
                            agendaViewModel.onWorkspaceResumed()
                        }

                        LaunchedEffect(pendingAgendaOpen, pendingDeepLinkAppointmentId, pendingDeepLinkDateKey) {
                            if (pendingAgendaOpen || pendingDeepLinkAppointmentId != null || pendingDeepLinkDateKey != null) {
                                agendaViewModel.handleDeepLink(
                                    appointmentId = pendingDeepLinkAppointmentId,
                                    dateKey = pendingDeepLinkDateKey
                                )
                                pendingDeepLinkAppointmentId = null
                                pendingDeepLinkDateKey = null
                                pendingAgendaOpen = false
                            }
                        }

                        key(session.uid) { AgendaScreen(
                            viewModel = agendaViewModel,
                            timeZoneManager = app.timeZoneManager,
                            onAccountDeletionAccepted = { ticket ->
                                pendingAgendaOpen = false
                                pendingDeepLinkAppointmentId = null
                                pendingDeepLinkDateKey = null
                                deletionReceipt = ticket
                            },
                            onLogoutClick = {
                                lifecycleScope.launch {
                                    try { app.pushRepository.unregisterCurrentToken() }
                                    finally {
                                        withContext(NonCancellable) {
                                            withContext(Dispatchers.IO) { app.agendaRepository.clearCachedAgenda() }
                                            releaseDraftPhotos()
                                            app.authRepository.logout()
                                            app.pushRepository.clearSession(this@MainActivity)
                                        }
                                    }
                                }
                            }
                        ) }
                    } else {
                        workspaceStore.clearAccount()
                        val loginViewModel: LoginViewModel = viewModel(factory = loginViewModelFactory)
                        LoginScreen(
                            viewModel = loginViewModel,
                            onLoginSuccess = {}
                        )
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        extractDeepLinkFromIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        workspaceResumeGeneration++
    }

    private fun extractDeepLinkFromIntent(intent: Intent?) {
        if (intent == null) return
        val notificationOwner = intent.getStringExtra(PediturnoFirebaseMessagingService.EXTRA_OWNER_ID)
        if (notificationOwner != null && notificationOwner != FirebaseAuth.getInstance().currentUser?.uid) return
        val isVerifiedCalendarLink = intent.data?.let(::isCalendarAppLink) == true
        val apptId = intent.getStringExtra(PediturnoFirebaseMessagingService.EXTRA_APPOINTMENT_ID)
            ?: intent.data?.takeIf { isVerifiedCalendarLink }?.getQueryParameter("appointmentId")
        val dateKey = intent.getStringExtra(PediturnoFirebaseMessagingService.EXTRA_DATE_KEY)
            ?: intent.data?.takeIf { isVerifiedCalendarLink }?.getQueryParameter("date")
        val opensAgenda = intent.getStringExtra(PediturnoFirebaseMessagingService.EXTRA_DESTINATION) == "agenda"
        if (opensAgenda || isVerifiedCalendarLink || !apptId.isNullOrBlank() || !dateKey.isNullOrBlank()) {
            pendingAgendaOpen = true
            pendingDeepLinkAppointmentId = apptId
            pendingDeepLinkDateKey = dateKey
        }
    }

    private fun isCalendarAppLink(uri: Uri): Boolean = uri.isHierarchical &&
        uri.scheme.equals("https", ignoreCase = true) &&
        uri.host.equals("pediturno.com", ignoreCase = true) &&
        uri.path in setOf("/dashboard/calendario", "/dashboard/calendario/")
}
