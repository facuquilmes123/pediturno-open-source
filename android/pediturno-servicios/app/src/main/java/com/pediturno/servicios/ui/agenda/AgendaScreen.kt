package com.pediturno.servicios.ui.agenda

import coil3.compose.AsyncImage
import androidx.compose.ui.layout.ContentScale

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.ManagedActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Image
import androidx.compose.ui.res.painterResource
import com.pediturno.servicios.R
import com.pediturno.servicios.ui.components.DesktopWebAccessCard
import com.pediturno.servicios.ui.components.copyDesktopWebAddress
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material.icons.outlined.Category
import androidx.compose.material.icons.outlined.DeleteOutline
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.Event
import androidx.compose.material.icons.outlined.Group
import androidx.compose.material.icons.outlined.NotificationsActive
import androidx.compose.material.icons.outlined.Refresh
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Share
import androidx.compose.material.icons.outlined.Storefront
import androidx.compose.material.icons.outlined.Verified
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.Snackbar
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.collectLatest
import kotlinx.coroutines.withContext
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pediturno.servicios.core.theme.AmberContainer
import com.pediturno.servicios.core.theme.AmberPending
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.BorderSubtle
import com.pediturno.servicios.core.theme.CobaltPrimary
import com.pediturno.servicios.core.theme.CrimsonCancelled
import com.pediturno.servicios.core.theme.CrimsonContainer
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.EmeraldContainer
import com.pediturno.servicios.core.theme.MintContainer
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.ObsidianCanvas
import com.pediturno.servicios.core.theme.OnMintPrimary
import com.pediturno.servicios.core.theme.SlateDeep
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.model.ServiceItem
import com.pediturno.servicios.data.repository.AgendaLoadState
import com.pediturno.servicios.service.PediturnoFirebaseMessagingService
import com.pediturno.servicios.ui.auth.GoogleCredentialManager
import com.pediturno.servicios.ui.components.AgendaSkeletonLoader
import com.pediturno.servicios.ui.components.AgendaPdfExportAction
import com.pediturno.servicios.ui.components.ClientsCsvExportAction
import com.pediturno.servicios.ui.components.rememberAgendaPdfExportLauncher
import com.pediturno.servicios.ui.components.rememberClientsCsvExportLauncher
import com.pediturno.servicios.ui.components.AppointmentCard
import com.pediturno.servicios.ui.components.ClientContactActions
import com.pediturno.servicios.ui.components.BusinessDashboardOverview
import com.pediturno.servicios.ui.components.GuidedTourOverlay
import com.pediturno.servicios.ui.components.LiveStorefrontPreview
import com.pediturno.servicios.ui.components.MercadoPagoSettingsDashboardCard
import com.pediturno.servicios.ui.components.MetricsOverviewStrip
import com.pediturno.servicios.ui.components.QrCodeCanvas
import com.pediturno.servicios.ui.components.SyncStatusPill
import com.pediturno.servicios.ui.components.TimeZoneInfoBanner
import com.pediturno.servicios.ui.components.WeeklyDateStrip
import java.text.NumberFormat
import java.util.Locale
import kotlinx.coroutines.launch

object WorkspaceNavigationTestTags {
    const val BUSINESS = "workspace_navigation_business"
    const val AGENDA = "workspace_nav_agenda"
    const val SERVICES = "workspace_nav_services"
    const val CLIENTS = "workspace_nav_clients"
}

object WorkspaceActionTestTags {
    const val EDIT_PROFILE = "workspace_edit_profile"
    const val DISMISS_MESSAGE = "workspace_dismiss_message"
    const val SERVICE_AVAILABILITY_SAVE = "workspace_service_availability_save"
    const val NEW_APPOINTMENT = "workspace_new_appointment"
    const val AGENDA_LIST = "workspace_agenda_list"
    const val SERVICES_LIST = "workspace_services_list"
    const val CLIENTS_LIST = "workspace_clients_list"
    fun serviceCard(serviceId: String) = "workspace_service_card_$serviceId"
    fun servicePause(serviceId: String) = "workspace_service_pause_$serviceId"
    fun serviceAvailability(serviceId: String) = "workspace_service_availability_$serviceId"
    fun serviceEdit(serviceId: String) = "workspace_service_edit_$serviceId"
    fun serviceDelete(serviceId: String) = "workspace_service_delete_$serviceId"
    fun clientCard(clientId: String) = "workspace_client_card_$clientId"
    const val SERVICE_DELETE_CONFIRM = "workspace_service_delete_confirm"
    const val SERVICE_DELETE_CANCEL = "workspace_service_delete_cancel"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgendaScreen(
    viewModel: AgendaViewModel,
    timeZoneManager: BusinessTimeZoneManager,
    onLogoutClick: () -> Unit,
    modifier: Modifier = Modifier,
    onAccountDeletionAccepted: (String) -> Unit = {}
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    // Only small UI coordinates enter SavedState; repositories reload the owned models.
    // MainActivity keys this entire composition to the authenticated UID.
    var savedDialog by rememberSaveable { mutableStateOf("") }
    var savedTab by rememberSaveable { mutableStateOf(WorkspaceTab.AGENDA.name) }
    var savedDate by rememberSaveable { mutableStateOf("") }
    var restoredWorkspace by remember { mutableStateOf(false) }
    LaunchedEffect(uiState.businessProfile.id, uiState.isServicesLoading, uiState.isClientsLoading, uiState.dateKey, uiState.loadState) {
        if (!restoredWorkspace && uiState.businessProfile.id.isNotBlank() &&
            !uiState.isServicesLoading && !uiState.isClientsLoading) {
            val tab = WorkspaceTab.entries.firstOrNull { it.name == savedTab } ?: WorkspaceTab.AGENDA
            viewModel.selectTab(tab)
            if (savedDate.matches(Regex("\\d{4}-\\d{2}-\\d{2}")) && savedDate != uiState.dateKey) {
                viewModel.selectDate(savedDate)
                return@LaunchedEffect
            }
            val kind = savedDialog.substringBefore(':')
            val id = savedDialog.substringAfter(':', "")
            if (kind == "reschedule" && uiState.loadState is AgendaLoadState.Loading) return@LaunchedEffect
            when (kind) {
                "new-service" -> viewModel.openServiceDialog(null)
                "service" -> uiState.services.firstOrNull { it.id == id }?.let(viewModel::openServiceDialog)
                "new-client" -> viewModel.openClientDialog()
                "client" -> uiState.clients.firstOrNull { it.id == id }?.let(viewModel::openClientDetail)
                "appointment" -> viewModel.openCreateDialog()
                "reschedule" -> (uiState.loadState as? AgendaLoadState.Loaded)?.appointments?.firstOrNull { it.id == id }?.let(viewModel::openRescheduleDialog)
                "profile" -> viewModel.openEditBusinessProfile()
                "availability" -> uiState.services.firstOrNull { it.id == id }?.let(viewModel::openServiceAvailabilityDialog)
            }
            restoredWorkspace = true
        }
    }
    LaunchedEffect(uiState, restoredWorkspace) {
        if (restoredWorkspace) {
            savedTab = uiState.activeTab.name
            savedDate = uiState.dateKey
            savedDialog = when {
                uiState.isServiceDialogOpen -> uiState.serviceToEdit?.let { "service:${it.id}" } ?: "new-service"
                uiState.isClientDialogOpen -> "new-client"
                uiState.isClientDetailDialogOpen -> "client:${uiState.selectedClient?.id.orEmpty()}"
                uiState.isCreateDialogOpen -> "appointment"
                uiState.isRescheduleDialogOpen -> "reschedule:${uiState.appointmentToReschedule?.id.orEmpty()}"
                uiState.isEditBusinessProfileOpen -> "profile"
                uiState.isServiceAvailabilityDialogOpen -> "availability:${uiState.serviceForAvailability?.id.orEmpty()}"
                else -> ""
            }
        }
    }
    val deletionTicket = uiState.lastDeletionTicket
    LaunchedEffect(deletionTicket) {
        if (deletionTicket != null) onAccountDeletionAccepted(deletionTicket)
    }
    if (deletionTicket != null) {
        AccountDeletionReceiptScreen(deletionTicket, onContinue = onLogoutClick)
        return
    }
    val availability by viewModel.availabilityUiState.collectAsStateWithLifecycle()
    val clientHistory by viewModel.clientHistoryUiState.collectAsStateWithLifecycle()
    val dashboard by viewModel.dashboardUiState.collectAsStateWithLifecycle()
    val reauth by viewModel.reauthUiState.collectAsStateWithLifecycle()
    val billing by viewModel.billingUiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val agendaExportLauncher = rememberAgendaPdfExportLauncher(viewModel.agendaExport, viewModel::showMessage)
    val clientsExportLauncher = rememberClientsCsvExportLauncher(viewModel.clientsExport, viewModel::showMessage)
    val context = LocalContext.current
    val reauthCredentialManager = remember(context) { GoogleCredentialManager(context) }
    val reauthScope = rememberCoroutineScope()

    var hasNotificationPermission by remember {
        mutableStateOf(
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ContextCompat.checkSelfPermission(
                    context,
                    Manifest.permission.POST_NOTIFICATIONS
                ) == PackageManager.PERMISSION_GRANTED
            } else {
                true
            }
        )
    }

    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        hasNotificationPermission = granted
        viewModel.showMessage(
            if (granted) "Permiso de notificaciones concedido." else "Notificaciones silenciadas por el usuario."
        )
    }

    LaunchedEffect(Unit) {
        val shouldOpenTour = withContext(Dispatchers.IO) {
            val prefs = context.getSharedPreferences("pediturno_ui_prefs", Context.MODE_PRIVATE)
            if (prefs.getBoolean("has_completed_guided_tour", false)) {
                false
            } else {
                prefs.edit().putBoolean("has_completed_guided_tour", true).apply()
                true
            }
        }
        if (shouldOpenTour) {
            viewModel.openGuidedTour()
        }
    }

    LaunchedEffect(Unit) {
        viewModel.snackBarMessages.collectLatest { message ->
            snackbarHostState.showSnackbar(message)
        }
    }
    LaunchedEffect(Unit) { viewModel.loadDashboard() }

    val initials = uiState.businessProfile.name
        .split(" ")
        .filter { it.isNotBlank() && it.first().isLetter() }
        .take(2)
        .mapNotNull { it.firstOrNull()?.uppercaseChar() }
        .joinToString("")
        .ifEmpty { "PS" }
    val currentMembership = uiState.businessProfile.membership
    val membershipLabel = if (uiState.businessProfile.id.isBlank()) {
        "Plan sin verificar"
    } else if (currentMembership.isPro) {
        when (currentMembership.status.lowercase(Locale.ROOT)) {
            "lifetime" -> "Plan Pro"
            "grace_period" -> "Plan Pro (Gracia)"
            else -> "Plan Pro"
        }
    } else {
        "Plan Gratis (${currentMembership.currentMonthUsage}/${currentMembership.monthlyQuota ?: 40})"
    }

    Scaffold(
        modifier = modifier.fillMaxSize(),
        snackbarHost = {
            SnackbarHost(snackbarHostState) { data ->
                Snackbar(
                    containerColor = SurfaceLevel2,
                    contentColor = TextHighEmphasis,
                    action = {
                        TextButton(
                            onClick = { data.dismiss() },
                            modifier = Modifier.testTag(WorkspaceActionTestTags.DISMISS_MESSAGE)
                        ) { Text("Cerrar", color = MintPrimary) }
                    }
                ) { Text(data.visuals.message) }
            }
        },
        containerColor = ObsidianCanvas,
        topBar = {
            TopAppBar(
                title = {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .clickable(onClick = viewModel::openSubscriptionDialog)
                    ) {
                        Box(
                            modifier = Modifier
                                .size(36.dp)
                                .clip(CircleShape)
                                .background(SurfaceLevel2)
                                .border(1.dp, MintPrimary, CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = initials,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                color = MintPrimary
                            )
                        }

                        Spacer(modifier = Modifier.width(10.dp))

                        Column {
                            Text(
                                text = uiState.businessProfile.name,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                                color = TextHighEmphasis
                            )
                            Text(
                                text = "$membershipLabel • Horarios por servicio",
                                fontSize = 11.sp,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                                color = TextMediumEmphasis
                            )
                        }
                    }
                },
                actions = {
                    IconButton(onClick = {
                        runCatching {
                            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(
                                    Intent.EXTRA_TEXT,
                                    "Reservá tu turno en línea sin instalar nada en: ${uiState.businessProfile.publicBookingUrl}"
                                )
                            }
                            context.startActivity(Intent.createChooser(shareIntent, "Compartir enlace público"))
                        }
                    }) {
                        Icon(
                            imageVector = Icons.Outlined.Share,
                            contentDescription = "Compartir enlace público",
                            tint = MintPrimary
                        )
                    }

                    IconButton(onClick = { viewModel.refreshAllWorkspaceData() }) {
                        Icon(
                            imageVector = Icons.Outlined.Refresh,
                            contentDescription = "Refrescar datos",
                            tint = TextMediumEmphasis
                        )
                    }

                    IconButton(onClick = onLogoutClick) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.Logout,
                            contentDescription = "Cerrar sesión",
                            tint = TextSubtle
                        )
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(containerColor = ObsidianCanvas)
            )
        },
        bottomBar = {
            NavigationBar(
                containerColor = SurfaceLevel1,
                tonalElevation = 0.dp,
                modifier = Modifier.border(1.dp, BorderHairline)
            ) {
                val navColors = NavigationBarItemDefaults.colors(
                    selectedIconColor = MintPrimary,
                    selectedTextColor = MintPrimary,
                    indicatorColor = MintContainer,
                    unselectedIconColor = TextSubtle,
                    unselectedTextColor = TextSubtle
                )

                NavigationBarItem(
                    selected = uiState.activeTab == WorkspaceTab.AGENDA,
                    onClick = { viewModel.selectTab(WorkspaceTab.AGENDA) },
                    modifier = Modifier.testTag(WorkspaceNavigationTestTags.AGENDA),
                    icon = { Icon(Icons.Outlined.CalendarMonth, contentDescription = null) },
                    label = { Text("Agenda", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    colors = navColors
                )
                NavigationBarItem(
                    selected = uiState.activeTab == WorkspaceTab.SERVICIOS,
                    onClick = { viewModel.selectTab(WorkspaceTab.SERVICIOS) },
                    modifier = Modifier.testTag(WorkspaceNavigationTestTags.SERVICES),
                    icon = { Icon(Icons.Outlined.Category, contentDescription = null) },
                    label = { Text("Servicios", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    colors = navColors
                )
                NavigationBarItem(
                    selected = uiState.activeTab == WorkspaceTab.CLIENTES,
                    onClick = { viewModel.selectTab(WorkspaceTab.CLIENTES) },
                    modifier = Modifier.testTag(WorkspaceNavigationTestTags.CLIENTS),
                    icon = { Icon(Icons.Outlined.Group, contentDescription = null) },
                    label = { Text("Clientes", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    colors = navColors
                )
                NavigationBarItem(
                    selected = uiState.activeTab == WorkspaceTab.NEGOCIO,
                    onClick = { viewModel.selectTab(WorkspaceTab.NEGOCIO) },
                    modifier = Modifier.testTag(WorkspaceNavigationTestTags.BUSINESS),
                    icon = { Icon(Icons.Outlined.Storefront, contentDescription = null) },
                    label = { Text("Mi Negocio", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    colors = navColors
                )
            }
        },
        floatingActionButton = {
            when (uiState.activeTab) {
                WorkspaceTab.AGENDA -> {
                    ExtendedFloatingActionButton(
                        onClick = { viewModel.openCreateDialog() },
                        containerColor = MintPrimary,
                        contentColor = OnMintPrimary,
                        icon = { Icon(imageVector = Icons.Default.Add, contentDescription = null) },
                        text = { Text("Turno", fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        shape = RoundedCornerShape(9999.dp),
                        modifier = Modifier.testTag(WorkspaceActionTestTags.NEW_APPOINTMENT)
                            .semantics { contentDescription = "Nuevo Turno" }
                    )
                }
                WorkspaceTab.SERVICIOS -> {
                    ExtendedFloatingActionButton(
                        onClick = { viewModel.openServiceDialog(null) },
                        containerColor = MintPrimary,
                        contentColor = OnMintPrimary,
                        icon = { Icon(imageVector = Icons.Default.Add, contentDescription = null) },
                        text = { Text("Servicio", fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        shape = RoundedCornerShape(9999.dp),
                        modifier = Modifier.semantics { contentDescription = "Nuevo Servicio" }
                    )
                }
                WorkspaceTab.CLIENTES -> {
                    ExtendedFloatingActionButton(
                        onClick = { viewModel.openClientDialog() },
                        containerColor = MintPrimary,
                        contentColor = OnMintPrimary,
                        icon = { Icon(imageVector = Icons.Default.Add, contentDescription = null) },
                        text = { Text("Cliente", fontWeight = FontWeight.Bold, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                        shape = RoundedCornerShape(9999.dp),
                        modifier = Modifier.semantics { contentDescription = "Nuevo Cliente" }
                    )
                }
                WorkspaceTab.NEGOCIO -> {}
            }
        }
    ) { innerPadding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(innerPadding)
                .consumeWindowInsets(innerPadding)
                .background(ObsidianCanvas)
        ) {
            AnimatedContent(
                targetState = uiState.activeTab,
                transitionSpec = {
                    (fadeIn(animationSpec = tween(220, easing = FastOutSlowInEasing)) +
                        scaleIn(initialScale = 0.98f, animationSpec = tween(220, easing = FastOutSlowInEasing)))
                        .togetherWith(fadeOut(animationSpec = tween(150)))
                },
                label = "WorkspaceTabTransition"
            ) { targetTab ->
                when (targetTab) {
                    WorkspaceTab.AGENDA -> AgendaTabContent(
                        uiState = uiState,
                        dashboard = dashboard,
                        viewModel = viewModel,
                        timeZoneManager = timeZoneManager,
                        pdfLauncher = agendaExportLauncher
                    )
                    WorkspaceTab.SERVICIOS -> ServicesTabContent(
                        uiState = uiState,
                        viewModel = viewModel
                    )
                    WorkspaceTab.CLIENTES -> ClientsTabContent(
                        uiState = uiState,
                        viewModel = viewModel,
                        csvLauncher = clientsExportLauncher
                    )
                    WorkspaceTab.NEGOCIO -> BusinessAndPlayTabContent(
                        uiState = uiState,
                        viewModel = viewModel,
                        hasNotificationPermission = hasNotificationPermission,
                        onRequestNotificationPermission = {
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                permissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                            }
                        }
                    )
                }
            }
        }
    }

    val currentAppointments = (uiState.loadState as? AgendaLoadState.Loaded)?.appointments ?: emptyList()

    if (uiState.isCreateDialogOpen) {
        CreateAppointmentDialog(
            services = uiState.services,
            dateKey = uiState.dateKey,
            availability = availability,
            onLoadAvailability = { serviceId, dateKey -> viewModel.loadAvailability(serviceId, dateKey) },
            bookingBufferMinutes = uiState.businessProfile.bookingBufferMinutes,
            prefillClientName = uiState.prefillClientName,
            prefillClientPhone = uiState.prefillClientPhone,
            prefillClientEmail = uiState.prefillClientEmail,
            onDismiss = { viewModel.closeCreateDialog() },
            onConfirm = { client, phone, email, serviceId, time ->
                viewModel.createAppointment(client, phone, email, serviceId, time)
            },
            isSubmitting = uiState.isSubmittingAction,
            errorMessage = uiState.dialogError
        )
    }

    if (uiState.isRescheduleDialogOpen && uiState.appointmentToReschedule != null) {
        RescheduleAppointmentDialog(
            appointment = uiState.appointmentToReschedule!!,
            todayDateKey = timeZoneManager.todayDateKey(),
            availability = availability,
            onLoadAvailability = { serviceId, dateKey, excludeAppointmentId ->
                viewModel.loadAvailability(serviceId, dateKey, excludeAppointmentId)
            },
            onDismiss = { viewModel.closeRescheduleDialog() },
            onConfirm = { id, dateKey, time ->
                viewModel.rescheduleAppointment(id, dateKey, time)
            },
            isSubmitting = uiState.isSubmittingAction,
            errorMessage = uiState.dialogError
        )
    }

    if (uiState.selectedAppointmentDetail != null) {
        AppointmentDetailDialog(
            appointment = uiState.selectedAppointmentDetail!!,
            onDismiss = { viewModel.closeAppointmentDetail() },
            onReschedule = { viewModel.openRescheduleDialog(it) },
            onStatusChange = { appt, status -> viewModel.updateStatus(appt, status) },
            onSendNotification = viewModel::sendAppointmentNotification
        )
    }

    if (uiState.isServiceDialogOpen) {
        SaveServiceDialog(
            initialService = uiState.serviceToEdit,
            isSubmitting = uiState.isSubmittingAction,
            errorMessage = uiState.dialogError,
            onDismiss = { viewModel.closeServiceDialog() },
            onUploadImage = { uri, onUploaded -> viewModel.uploadImage(uri, com.pediturno.servicios.data.repository.ImageCategory.SERVICE, onUploaded) },
            onConfirm = { name, dur, price, status, photoUrl ->
                viewModel.saveService(name, dur, price, status, photoUrl = photoUrl)
            }
        )
    }

    if (uiState.isClientDialogOpen) {
        CreateClientDialog(
            isSubmitting = uiState.isSubmittingAction,
            errorMessage = uiState.dialogError,
            onDismiss = { viewModel.closeClientDialog() },
            onUploadAvatar = { uri, onUploaded ->
                viewModel.uploadImage(uri, com.pediturno.servicios.data.repository.ImageCategory.AVATAR, onUploaded)
            },
            onConfirm = { name, phone, email, _, avatarUrl ->
                viewModel.createClient(name, phone, email, "", avatarUrl)
            }
        )
    }

    if (uiState.isDeleteAccountDialogOpen) {
        AccountDeletionDialog(
            isSubmitting = uiState.isSubmittingAction,
            onDismiss = { viewModel.closeDeleteAccountDialog() },
            onConfirm = { reason ->
                viewModel.requestAccountDeletion(reason)
            }
        )
    }

    if (reauth.isOpen) {
        ReauthenticationDialog(
            email = reauth.email,
            allowPassword = reauth.allowPassword,
            allowGoogle = reauth.allowGoogle,
            isLoading = reauth.isLoading,
            error = reauth.error,
            onPasswordSubmit = viewModel::submitDeletionReauthPassword,
            onGoogleClick = {
                reauthScope.launch {
                    reauthCredentialManager.requestIdToken().fold(
                        onSuccess = viewModel::submitDeletionReauthGoogle,
                        onFailure = { error ->
                            viewModel.showDeletionReauthError(
                                error.message ?: "No se pudo iniciar la confirmación con Google."
                            )
                        }
                    )
                }
            },
            onDismiss = viewModel::dismissDeletionReauth
        )
    }

    if (uiState.isMonthViewOpen) {
        MonthCalendarDialog(
            currentDateKey = uiState.dateKey,
            todayDateKey = timeZoneManager.todayDateKey(),
            onDateSelected = { dateKey ->
                viewModel.selectDate(dateKey)
            },
            onDismiss = viewModel::closeMonthView
        )
    }

    if (uiState.isServiceAvailabilityDialogOpen && uiState.serviceForAvailability != null) {
        ServiceAvailabilityDialog(
            service = uiState.serviceForAvailability!!,
            todayDateKey = timeZoneManager.todayDateKey(),
            onSaveAvailability = { serviceId, hours, holidays ->
                viewModel.saveServiceAvailability(serviceId, hours, holidays)
            },
            onDismiss = { viewModel.closeServiceAvailabilityDialog() },
            isSubmitting = uiState.isSubmittingAction,
            errorMessage = uiState.dialogError
        )
    }

    if (uiState.isClientDetailDialogOpen && uiState.selectedClient != null) {
        ClientDetailDialog(
            client = uiState.selectedClient!!,
            history = clientHistory,
            onLoadHistory = viewModel::loadClientHistory,
            onUpdateClient = { updatedClient ->
                viewModel.updateClient(updatedClient)
            },
            onUploadAvatar = { uri, onUploaded ->
                viewModel.uploadImage(uri, com.pediturno.servicios.data.repository.ImageCategory.AVATAR, onUploaded)
            },
            onDeleteClient = viewModel::deleteClient,
            onBookAppointmentForClient = { client ->
                viewModel.closeClientDetail()
                viewModel.openCreateDialog(
                    clientName = client.name,
                    clientPhone = client.phone,
                    clientEmail = client.email
                )
            },
            onDismiss = { viewModel.closeClientDetail() },
            isSubmitting = uiState.isSubmittingAction,
            errorMessage = uiState.dialogError
        )
    }

    if (uiState.isEditBusinessProfileOpen) {
        EditBusinessProfileDialog(
            profile = uiState.businessProfile,
            isSubmitting = uiState.isSubmittingAction,
            onSaveProfile = { updatedProfile, logoUri ->
                viewModel.saveFullBusinessProfile(updatedProfile, logoUri)
            },
            errorMessage = uiState.dialogError,
            onDismiss = { viewModel.closeEditBusinessProfile() }
        )
    }

    if (uiState.isSubscriptionDialogOpen) {
        SubscriptionPlanDialog(
            membership = uiState.businessProfile.membership,
            billing = billing,
            onDismiss = { viewModel.closeSubscriptionDialog() },
            onPurchase = { activity -> viewModel.purchaseMembership(activity) },
            onRestore = { viewModel.restoreMemberships() },
            onRefresh = {
                viewModel.refreshBilling()
                viewModel.refreshAllWorkspaceData()
            }
        )
    }

    if (uiState.isGuidedTourOpen) {
        GuidedTourOverlay(
            currentStep = uiState.tourStep,
            onStepChange = viewModel::setTourStep,
            onDismiss = viewModel::closeGuidedTour
        )
    }
}

@Composable
private fun AgendaTabContent(
    uiState: AgendaUiState,
    dashboard: DashboardUiState,
    viewModel: AgendaViewModel,
    timeZoneManager: BusinessTimeZoneManager,
    pdfLauncher: ManagedActivityResultLauncher<String, Uri?>
) {
    val allAppointments = (uiState.loadState as? AgendaLoadState.Loaded)?.appointments ?: emptyList()
    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .testTag(WorkspaceActionTestTags.AGENDA_LIST),
        contentPadding = PaddingValues(bottom = 104.dp)
    ) {
        item {
            FlowRow(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                val isOffline = (uiState.loadState as? AgendaLoadState.Loaded)?.isOfflineCache ?: uiState.isSimulatedOffline
                SyncStatusPill(isOfflineCache = isOffline, hasVerifiedData = uiState.loadState is AgendaLoadState.Loaded, isLoading = uiState.loadState is AgendaLoadState.Loading)
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    modifier = Modifier
                        .clip(RoundedCornerShape(9999.dp))
                        .background(SurfaceLevel1)
                        .border(1.dp, BorderHairline, RoundedCornerShape(9999.dp))
                        .clickable { viewModel.toggleMonthView() }
                        .heightIn(min = 48.dp)
                        .padding(horizontal = 10.dp)
                ) {
                    Icon(Icons.Outlined.CalendarMonth, "Ver mes completo", tint = MintPrimary, modifier = Modifier.size(15.dp))
                    Spacer(modifier = Modifier.width(6.dp))
                    Text(uiState.displayDate, fontSize = 12.sp, color = TextHighEmphasis, fontWeight = FontWeight.SemiBold)
                }
            }
        }
        item {
            WeeklyDateStrip(
                selectedDateKey = uiState.dateKey,
                onDateSelect = { newDateKey -> viewModel.loadAgenda(newDateKey) },
                timeZoneManager = timeZoneManager,
                modifier = Modifier.padding(vertical = 4.dp)
            )
        }
        item {
            BusinessDashboardOverview(
                monthKey = dashboard.monthKey,
                upcomingAppointmentsCount = dashboard.upcomingAppointmentsCount,
                totalClients = dashboard.totalClients,
                monthlyRevenue = dashboard.monthlyRevenue,
                upcomingAppointments = dashboard.upcomingAppointments,
                isLoading = dashboard.isLoading,
                hasLoadedData = dashboard.hasLoadedData,
                error = dashboard.error,
                onRetry = viewModel::loadDashboard,
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
            )
        }
        if (allAppointments.isNotEmpty()) {
            item {
                AgendaPdfExportAction(
                    request = viewModel.agendaExport,
                    launcher = pdfLauncher,
                    businessName = uiState.businessProfile.name,
                    dateLabel = uiState.displayDate,
                    appointments = allAppointments,
                    onMessage = viewModel::showMessage,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )
            }
            item {
                MetricsOverviewStrip(
                    appointments = allAppointments,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                )
            }
        }
        item {
            TimeZoneInfoBanner(
                modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                timeZoneName = timeZoneManager.formatZoneLabel(uiState.businessProfile.timeZone)
            )
        }
        item {
            OutlinedTextField(
                value = uiState.searchQuery,
                onValueChange = viewModel::setSearchQuery,
                placeholder = { Text("Buscar por cliente, teléfono o servicio...", fontSize = 12.sp) },
                leadingIcon = { Icon(Icons.Outlined.Search, null, tint = TextSubtle, modifier = Modifier.size(18.dp)) },
                trailingIcon = if (uiState.searchQuery.isNotBlank()) {
                    { IconButton(onClick = { viewModel.setSearchQuery("") }) { Icon(Icons.Default.Close, "Limpiar búsqueda", tint = TextSubtle, modifier = Modifier.size(16.dp)) } }
                } else null,
                singleLine = true,
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MintPrimary,
                    unfocusedBorderColor = BorderHairline,
                    focusedTextColor = TextHighEmphasis,
                    unfocusedTextColor = TextHighEmphasis
                ),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp)
            )
        }
        item {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                val filters: List<Pair<String, AppointmentStatus?>> = listOf(
                    "Todos (${allAppointments.size})" to null,
                    "Confirmados" to AppointmentStatus.Confirmado,
                    "Pendientes" to AppointmentStatus.Pendiente,
                    "Completados" to AppointmentStatus.Completado,
                    "Cancelados" to AppointmentStatus.Cancelado
                )
                filters.forEach { (label, status) ->
                    val isSelected = uiState.statusFilter == status
                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(9999.dp))
                            .background(if (isSelected) MintPrimary else SurfaceLevel2)
                            .border(1.dp, if (isSelected) MintPrimary else BorderHairline, RoundedCornerShape(9999.dp))
                            .clickable { viewModel.setStatusFilter(status) }
                            .heightIn(min = 48.dp)
                            .padding(horizontal = 12.dp),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(label, fontSize = 11.sp, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium, color = if (isSelected) OnMintPrimary else TextMediumEmphasis)
                    }
                }
            }
        }

        when (val state = uiState.loadState) {
            is AgendaLoadState.Loading -> item { AgendaSkeletonLoader(modifier = Modifier.padding(16.dp)) }
            is AgendaLoadState.Error -> item {
                Box(modifier = Modifier.fillMaxWidth().padding(24.dp), contentAlignment = Alignment.Center) {
                    Column {
                      Text(text = state.message, color = TextSubtle, fontSize = 14.sp)
                      if (state.code == 403 && state.message.contains("correo", ignoreCase = true)) {
                          TextButton(onClick = viewModel::resendVerificationEmail) { Text("Reenviar verificación") }
                          TextButton(onClick = viewModel::retryVerifiedBootstrap) { Text("Ya verifiqué mi correo") }
                      } else {
                          TextButton(onClick = { viewModel.refreshAllWorkspaceData() }) { Text("Reintentar") }
                      }
                  }
                }
            }
            is AgendaLoadState.Loaded -> {
                val filtered = state.appointments.filter { apt ->
                    val matchesStatus = uiState.statusFilter == null || apt.status == uiState.statusFilter
                    val query = uiState.searchQuery.trim()
                    matchesStatus && (query.isEmpty() || apt.client.contains(query, ignoreCase = true) ||
                        apt.clientPhone.contains(query, ignoreCase = true) || apt.service.contains(query, ignoreCase = true))
                }
                if (filtered.isEmpty()) {
                    item {
                        Box(modifier = Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Box(
                                    modifier = Modifier.clip(CircleShape).background(SurfaceLevel1)
                                        .border(1.dp, BorderHairline, CircleShape).padding(16.dp)
                                ) { Icon(Icons.Outlined.Event, null, tint = MintPrimary, modifier = Modifier.size(26.dp)) }
                                Spacer(modifier = Modifier.height(12.dp))
                                Text("Sin turnos que coincidan con el filtro", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = TextHighEmphasis)
                                Spacer(modifier = Modifier.height(4.dp))
                                Text("Usá '+ Nuevo Turno' para agendar manualmente", fontSize = 12.sp, color = TextMediumEmphasis)
                            }
                        }
                    }
                } else {
                    items(filtered, key = { it.id }) { appointment ->
                        AppointmentCard(
                            appointment = appointment,
                            isHighlighted = appointment.id == uiState.highlightedAppointmentId,
                            onCardClick = viewModel::openAppointmentDetail,
                            onRescheduleClick = viewModel::openRescheduleDialog,
                            onStatusChange = viewModel::updateStatus,
                            onExternalActionError = viewModel::showMessage,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 5.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun ServicesTabContent(
    uiState: AgendaUiState,
    viewModel: AgendaViewModel
) {
    val currencyFormat = remember {
        NumberFormat.getCurrencyInstance(Locale.forLanguageTag("es-AR")).apply {
            minimumFractionDigits = 2
            maximumFractionDigits = 2
        }
    }

    val totalCount = uiState.services.size
    val activeCount = uiState.services.count { it.isActive }
    val pausedCount = totalCount - activeCount
    val bufferMin = uiState.businessProfile.bookingBufferMinutes
    var pendingServiceDeletion by remember { mutableStateOf<ServiceItem?>(null) }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .testTag(WorkspaceActionTestTags.SERVICES_LIST),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 88.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "Catálogo de Servicios",
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextHighEmphasis
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = "Tus servicios, precios y disponibilidad para reservar en línea",
                    fontSize = 12.sp,
                    color = TextMediumEmphasis
                )
            }
        }

        // Tira de métricas de servicios
        item {
            BoxWithConstraints(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(SurfaceLevel1)
                    .border(1.dp, BorderHairline, RoundedCornerShape(16.dp))
                    .padding(horizontal = 14.dp, vertical = 12.dp)
            ) {
                // Give each metric enough width when system text is enlarged.
                val columns = if (maxWidth >= 280.dp * LocalDensity.current.fontScale) 4 else 2
                FlowRow(
                    modifier = Modifier.fillMaxWidth(),
                    maxItemsInEachRow = columns,
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
                        Text("TOTAL", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = TextSubtle, letterSpacing = 0.05.sp)
                        Spacer(modifier = Modifier.height(2.dp))
                        Text("$totalCount", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = TextHighEmphasis)
                        Text("registrados", fontSize = 10.sp, color = TextSubtle)
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
                        Text("EN LÍNEA", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = EmeraldConfirmed, letterSpacing = 0.05.sp)
                        Spacer(modifier = Modifier.height(2.dp))
                        Text("$activeCount", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = EmeraldConfirmed)
                        Text("disponibles", fontSize = 10.sp, color = TextSubtle)
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
                        Text("EN PAUSA", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = AmberPending, letterSpacing = 0.05.sp)
                        Spacer(modifier = Modifier.height(2.dp))
                        Text("$pausedCount", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = AmberPending)
                        Text("ocultos", fontSize = 10.sp, color = TextSubtle)
                    }
                    Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.weight(1f)) {
                        Text("PAUSA", fontSize = 9.sp, fontWeight = FontWeight.Bold, color = MintPrimary, letterSpacing = 0.05.sp)
                        Spacer(modifier = Modifier.height(2.dp))
                        Text("${bufferMin}m", fontSize = 16.sp, fontWeight = FontWeight.Bold, color = MintPrimary)
                        Text("entre turnos", fontSize = 10.sp, color = TextSubtle)
                    }
                }
            }
        }

        if (uiState.isServicesLoading && uiState.services.isEmpty()) {
            item {
                LoadingCatalogState(label = "Cargando catálogo de servicios…")
            }
        } else if (uiState.servicesError != null && uiState.services.isEmpty()) {
            item {
                CatalogLoadError(
                    message = uiState.servicesError,
                    retryLabel = "Reintentar catálogo",
                    onRetry = viewModel::retryServices
                )
            }
        } else if (uiState.services.isEmpty()) {
            item {
                EmptyCatalogState("Todavía no cargaste servicios. Creá el primero para poder ofrecer turnos.")
            }
        } else if (uiState.servicesError != null) {
            item {
                CatalogLoadError(
                    message = uiState.servicesError,
                    retryLabel = "Reintentar",
                    onRetry = viewModel::retryServices
                )
            }
        }

        items(uiState.services, key = { it.id }) { service ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(18.dp))
                    .background(SurfaceLevel1)
                    .border(1.dp, BorderHairline, RoundedCornerShape(18.dp))
                    .testTag(WorkspaceActionTestTags.serviceCard(service.id))
                    .padding(16.dp)
            ) {
                Column(modifier = Modifier.fillMaxWidth()) {
                    // Fila superior: Icono de servicio + Título + Status Pill
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        // Badge con icono de categoría/servicio
                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(MintPrimary.copy(alpha = 0.12f))
                                .border(1.dp, MintPrimary.copy(alpha = 0.25f), RoundedCornerShape(12.dp)),
                            contentAlignment = Alignment.Center
                        ) {
                            Icon(
                                imageVector = Icons.Outlined.Category,
                                contentDescription = null,
                                tint = MintPrimary,
                                modifier = Modifier.size(20.dp)
                            )
                            if (!service.photoUrl.isNullOrBlank()) {
                                AsyncImage(model = service.photoUrl, contentDescription = "Foto de ${service.name}", contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize().clip(RoundedCornerShape(12.dp)))
                            }
                        }

                        Spacer(modifier = Modifier.width(12.dp))

                        // Nombre de servicio
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = service.name,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextHighEmphasis,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(
                                    imageVector = Icons.Outlined.Schedule,
                                    contentDescription = null,
                                    tint = TextSubtle,
                                    modifier = Modifier.size(13.dp)
                                )
                                Spacer(modifier = Modifier.width(4.dp))
                                Text(
                                    text = "${service.durationMinutes} min · ${service.bookingBufferMinutes ?: bufferMin} min entre turnos",
                                    style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
                                    fontSize = 11.sp,
                                    color = TextMediumEmphasis,
                                    fontWeight = FontWeight.Medium
                                )
                            }
                        }

                        Spacer(modifier = Modifier.width(8.dp))

                        // Status Badge interactivo (En línea / En pausa con Switch unificado en cabecera)
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier
                                .clip(RoundedCornerShape(9999.dp))
                                .background(if (service.isActive) EmeraldContainer else AmberContainer)
                                .border(
                                    1.dp,
                                    if (service.isActive) EmeraldConfirmed.copy(alpha = 0.3f) else AmberPending.copy(alpha = 0.3f),
                                    RoundedCornerShape(9999.dp)
                                )
                                .padding(start = 10.dp, end = 2.dp, top = 2.dp, bottom = 2.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(6.dp)
                                    .clip(CircleShape)
                                    .background(if (service.isActive) EmeraldConfirmed else AmberPending)
                            )
                            Spacer(modifier = Modifier.width(5.dp))
                            Text(
                                text = if (service.isActive) "En línea" else "En pausa",
                                fontSize = 11.sp,
                                fontWeight = FontWeight.Bold,
                                color = if (service.isActive) EmeraldConfirmed else AmberPending
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Switch(
                                checked = service.isActive,
                                onCheckedChange = { viewModel.toggleServiceStatus(service) },
                                colors = SwitchDefaults.colors(
                                    checkedThumbColor = Color.White,
                                    checkedTrackColor = EmeraldConfirmed,
                                    uncheckedThumbColor = Color.White,
                                    uncheckedTrackColor = SurfaceLevel2
                                ),
                                modifier = Modifier
                                    .scale(0.8f)
                                    .testTag(WorkspaceActionTestTags.servicePause(service.id))
                            )
                        }
                    }

                    Spacer(modifier = Modifier.height(12.dp))

                    // Separador sutil
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(BorderHairline)
                    )

                    Spacer(modifier = Modifier.height(10.dp))

                    // Fila inferior: Precio en cifras tabulares y acciones (sin colisión con estado)
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Column {
                            Text(
                                text = "TARIFA",
                                fontSize = 9.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextSubtle,
                                letterSpacing = 0.05.sp
                            )
                            Text(
                                text = currencyFormat.format(service.price),
                                style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
                                fontSize = 17.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextHighEmphasis
                            )
                        }

                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(4.dp)
                        ) {
                            IconButton(
                                onClick = { viewModel.openServiceAvailabilityDialog(service) },
                                modifier = Modifier
                                    .size(48.dp)
                                    .testTag(WorkspaceActionTestTags.serviceAvailability(service.id))
                            ) {
                                Icon(
                                    Icons.Outlined.Schedule,
                                    contentDescription = "Horarios y Feriados",
                                    tint = MintPrimary,
                                    modifier = Modifier.size(20.dp)
                                )
                            }

                            IconButton(
                                onClick = { viewModel.openServiceDialog(service) },
                                modifier = Modifier
                                    .size(48.dp)
                                    .testTag(WorkspaceActionTestTags.serviceEdit(service.id))
                            ) {
                                Icon(
                                    Icons.Outlined.Edit,
                                    contentDescription = "Editar",
                                    tint = TextMediumEmphasis,
                                    modifier = Modifier.size(20.dp)
                                )
                            }

                            IconButton(
                                onClick = { pendingServiceDeletion = service },
                                modifier = Modifier
                                    .size(48.dp)
                                    .testTag(WorkspaceActionTestTags.serviceDelete(service.id))
                            ) {
                                Icon(
                                    Icons.Outlined.DeleteOutline,
                                    contentDescription = "Eliminar",
                                    tint = CrimsonCancelled,
                                    modifier = Modifier.size(20.dp)
                                )
                            }
                        }
                    }
                }
            }
        }
    }

    pendingServiceDeletion?.let { service ->
        AlertDialog(
            onDismissRequest = { pendingServiceDeletion = null },
            title = { Text("¿Eliminar servicio?") },
            text = {
                Text(
                    "Se eliminará “${service.name}”. Si tiene turnos asociados, primero tendrás que resolverlos."
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        pendingServiceDeletion = null
                        viewModel.deleteService(service)
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = CrimsonCancelled),
                    modifier = Modifier.testTag(WorkspaceActionTestTags.SERVICE_DELETE_CONFIRM)
                ) { Text("Eliminar") }
            },
            dismissButton = {
                TextButton(
                    onClick = { pendingServiceDeletion = null },
                    modifier = Modifier.testTag(WorkspaceActionTestTags.SERVICE_DELETE_CANCEL)
                ) { Text("Cancelar") }
            }
        )
    }
}

@Composable
private fun ClientsTabContent(
    uiState: AgendaUiState,
    viewModel: AgendaViewModel,
    csvLauncher: ManagedActivityResultLauncher<String, Uri?>
) {
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    var clientSearchQuery by rememberSaveable { mutableStateOf("") }

    val filteredClients = remember(uiState.clients, clientSearchQuery) {
        if (clientSearchQuery.isBlank()) {
            uiState.clients
        } else {
            val q = clientSearchQuery.trim().lowercase()
            uiState.clients.filter {
                it.name.lowercase().contains(q) ||
                it.phone.contains(q) ||
                it.email.lowercase().contains(q)
            }
        }
    }

    LazyColumn(
        modifier = Modifier
            .fillMaxSize()
            .testTag(WorkspaceActionTestTags.CLIENTS_LIST),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 88.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        item {
            Text(
                text = "Directorio de Clientes",
                fontSize = 18.sp,
                fontWeight = FontWeight.Bold,
                color = TextHighEmphasis
            )
            Text(
                text = "Contacto directo a 1 toque y agendamiento rápido",
                fontSize = 12.sp,
                color = TextMediumEmphasis
            )
            Spacer(modifier = Modifier.height(4.dp))
            ClientsCsvExportAction(
                request = viewModel.clientsExport,
                launcher = csvLauncher,
                clients = uiState.clients,
                exportAllowed = !uiState.isClientsLoading && uiState.clientsError == null && uiState.businessProfile.id.isNotBlank(),
                onMessage = viewModel::showMessage
            )
            Spacer(modifier = Modifier.height(8.dp))
            OutlinedTextField(
                value = clientSearchQuery,
                onValueChange = { clientSearchQuery = it },
                placeholder = { Text("Buscar por nombre, teléfono o email…", fontSize = 13.sp, color = TextSubtle) },
                leadingIcon = {
                    Icon(Icons.Outlined.Search, contentDescription = null, tint = TextSubtle, modifier = Modifier.size(18.dp))
                },
                trailingIcon = {
                    if (clientSearchQuery.isNotEmpty()) {
                        IconButton(onClick = { clientSearchQuery = "" }, modifier = Modifier.size(24.dp)) {
                            Icon(Icons.Default.Close, contentDescription = "Limpiar", tint = TextSubtle, modifier = Modifier.size(16.dp))
                        }
                    }
                },
                singleLine = true,
                shape = RoundedCornerShape(12.dp),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = MintPrimary,
                    unfocusedBorderColor = BorderHairline,
                    focusedContainerColor = SurfaceLevel1,
                    unfocusedContainerColor = SurfaceLevel1
                ),
                modifier = Modifier.fillMaxWidth()
            )
        }

        if (uiState.isClientsLoading && uiState.clients.isEmpty()) {
            item {
                LoadingCatalogState(label = "Cargando clientes…")
            }
        } else if (uiState.clientsError != null && uiState.clients.isEmpty()) {
            item {
                CatalogLoadError(
                    message = uiState.clientsError,
                    retryLabel = "Reintentar clientes",
                    onRetry = viewModel::retryClients
                )
            }
        } else if (uiState.clients.isEmpty()) {
            item {
                EmptyCatalogState("Todavía no hay clientes cargados. Podés crear uno desde el botón Nuevo Cliente.")
            }
        } else if (filteredClients.isEmpty()) {
            item {
                EmptyCatalogState("No se encontraron clientes que coincidan con “$clientSearchQuery”.")
            }
        } else if (uiState.clientsError != null) {
            item {
                CatalogLoadError(
                    message = uiState.clientsError,
                    retryLabel = "Reintentar",
                    onRetry = viewModel::retryClients
                )
            }
        }

        items(filteredClients, key = { it.id }) { client ->
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(16.dp))
                    .background(SurfaceLevel1)
                    .border(1.dp, BorderHairline, RoundedCornerShape(16.dp))
                    .padding(14.dp)
            ) {
                Column {
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(10.dp))
                            .clickable { viewModel.openClientDetail(client) }
                            .testTag(WorkspaceActionTestTags.clientCard(client.id))
                            .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        val initials = client.name.split(" ")
                            .filter { it.isNotBlank() }
                            .take(2)
                            .mapNotNull { it.firstOrNull()?.uppercaseChar() }
                            .joinToString("")
                            .ifBlank { "C" }

                        Box(
                            modifier = Modifier
                                .size(40.dp)
                                .clip(CircleShape)
                                .background(SurfaceLevel2)
                                .border(1.dp, BorderHairline, CircleShape),
                            contentAlignment = Alignment.Center
                        ) {
                            Text(
                                text = initials,
                                fontSize = 14.sp,
                                fontWeight = FontWeight.Bold,
                                color = MintPrimary
                            )
                            if (!client.avatarUrl.isNullOrBlank()) {
                                AsyncImage(model = client.avatarUrl, contentDescription = "Foto de ${client.name}", contentScale = ContentScale.Crop, modifier = Modifier.matchParentSize().clip(CircleShape))
                            }
                        }

                        Spacer(modifier = Modifier.width(12.dp))

                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = client.name,
                                fontSize = 15.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextHighEmphasis,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                            Spacer(modifier = Modifier.height(2.dp))
                            Text(
                                text = "${client.phone} • ${client.email.ifBlank { "Sin correo" }}",
                                fontSize = 12.sp,
                                color = TextMediumEmphasis,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis
                            )
                        }

                        Icon(
                            imageVector = Icons.AutoMirrored.Outlined.ArrowForward,
                            contentDescription = "Ver ficha de cliente",
                            tint = TextSubtle,
                            modifier = Modifier.size(18.dp)
                        )
                    }

                    Spacer(modifier = Modifier.height(10.dp))
                    Box(
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(1.dp)
                            .background(BorderHairline)
                    )
                    Spacer(modifier = Modifier.height(10.dp))

                    ClientContactActions(
                        onWhatsApp = {
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            val clean = client.phone.filter { it.isDigit() }
                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://wa.me/$clean"))) }
                                .onFailure { viewModel.showMessage("No se encontró WhatsApp para $clean") }
                        },
                        onCall = {
                            haptics.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                            val clean = client.phone.filter { it.isDigit() }
                            runCatching { context.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:$clean"))) }
                                .onFailure { viewModel.showMessage("Marcador no disponible ($clean)") }
                        },
                        onSchedule = {
                            viewModel.openCreateDialog(clientName = client.name, clientPhone = client.phone, clientEmail = client.email)
                        }
                    )
                }
            }
        }
    }
}

@Composable
private fun LoadingCatalogState(label: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 20.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
        Spacer(Modifier.width(10.dp))
        Text(label, color = TextMediumEmphasis, fontSize = 13.sp)
    }
}

@Composable
private fun CatalogLoadError(message: String, retryLabel: String, onRetry: () -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(CrimsonContainer)
            .border(1.dp, CrimsonCancelled.copy(alpha = 0.35f), RoundedCornerShape(14.dp))
            .padding(14.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text(message, color = CrimsonCancelled, fontSize = 13.sp)
        OutlinedButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(retryLabel)
        }
    }
}

@Composable
private fun EmptyCatalogState(message: String) {
    Text(
        text = message,
        color = TextMediumEmphasis,
        fontSize = 13.sp,
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 20.dp)
    )
}

@Composable
private fun BusinessAndPlayTabContent(
    uiState: AgendaUiState,
    viewModel: AgendaViewModel,
    hasNotificationPermission: Boolean,
    onRequestNotificationPermission: () -> Unit
) {
    val context = LocalContext.current
    val profile = uiState.businessProfile
    val billing by viewModel.billingUiState.collectAsStateWithLifecycle()
    val mercadoPago by viewModel.mercadoPagoUiState.collectAsStateWithLifecycle()

    LaunchedEffect(Unit) { viewModel.refreshMercadoPagoStatus() }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        DesktopWebAccessCard(onCopyAddress = {
            runCatching {
                copyDesktopWebAddress(context)
            }.onSuccess { viewModel.showMessage("Dirección web copiada. Abrila en el navegador de tu PC.") }
                .onFailure { viewModel.showMessage("No pudimos copiar la dirección. Entrá a pediturno.com desde tu PC.") }
        })

        // Previsualización en Vivo de la Página Pública
        LiveStorefrontPreview(
            profile = profile,
            modifier = Modifier.padding(bottom = 2.dp)
        )

        Button(
            onClick = { viewModel.openEditBusinessProfile() },
            colors = ButtonDefaults.buttonColors(
                containerColor = MintPrimary,
                contentColor = OnMintPrimary
            ),
            shape = RoundedCornerShape(12.dp),
            modifier = Modifier
                .fillMaxWidth()
                .testTag(WorkspaceActionTestTags.EDIT_PROFILE)
                .height(46.dp)
        ) {
            Icon(
                imageVector = Icons.Outlined.Edit,
                contentDescription = null,
                modifier = Modifier.size(16.dp),
                tint = OnMintPrimary
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "Personalizar Página Web y Estilos",
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp,
                color = OnMintPrimary
            )
        }

        // El estado se obtiene del servidor; nunca se deduce de un toggle local.
        if (mercadoPago.depositsEnabled || mercadoPago.connected || profile.mercadopago.isConnected) MercadoPagoSettingsDashboardCard(
            connected = mercadoPago.connected,
            depositsEnabled = mercadoPago.depositsEnabled,
            canConfigureDeposits = mercadoPago.canConfigureDeposits,
            requireDeposit = mercadoPago.requireDeposit,
            depositValue = mercadoPago.depositValue,
            depositType = mercadoPago.depositType,
            isLoading = mercadoPago.isLoading,
            error = mercadoPago.error,
            onConfigureClick = {
                if (profile.mercadopago.isConnected) {
                    viewModel.showMessage("No se pudo cargar la configuración de señas. Actualizá la pantalla y volvé a intentar.")
                } else {
                    viewModel.connectMercadoPago(context)
                }
            },
            onSaveSettings = viewModel::saveMercadoPagoSettings,
            onDisconnectClick = viewModel::disconnectMercadoPago
        )

        // 0. Guía Rápida & Tour de Bienvenida
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(SurfaceLevel1)
                .border(1.dp, BorderHairline, RoundedCornerShape(18.dp))
                .padding(16.dp)
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "TOUR GUIADO INTERACTIVO",
                        fontSize = 11.sp,
                        fontWeight = FontWeight.Bold,
                        color = MintPrimary,
                        letterSpacing = 0.05.sp
                    )
                    Spacer(modifier = Modifier.height(3.dp))
                    Text(
                        text = "Repasa el paso a paso de cada función clave de la app",
                        fontSize = 12.sp,
                        color = TextMediumEmphasis
                    )
                }
                Spacer(modifier = Modifier.width(10.dp))
                Button(
                    onClick = { viewModel.openGuidedTour() },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MintPrimary,
                        contentColor = OnMintPrimary
                    ),
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.size(16.dp), tint = OnMintPrimary)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Ver Tour", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = OnMintPrimary)
                }
            }
        }

        // 1. Enlace Público y Código QR en mostrador
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(SurfaceLevel1)
                .border(1.dp, BorderHairline, RoundedCornerShape(18.dp))
                .padding(16.dp)
        ) {
            Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.fillMaxWidth()) {
                Text(
                    text = "ENLACE PÚBLICO DE RESERVAS WEB",
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold,
                    color = MintPrimary,
                    letterSpacing = 0.05.sp
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Tus clientes reservan en la web sin instalar la app",
                    fontSize = 12.sp,
                    color = TextMediumEmphasis
                )
                Spacer(modifier = Modifier.height(12.dp))

                QrCodeCanvas(content = profile.publicBookingUrl)

                Spacer(modifier = Modifier.height(10.dp))
                Text(
                    text = profile.publicBookingUrl,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextHighEmphasis
                )
                Spacer(modifier = Modifier.height(10.dp))
                Button(
                    onClick = {
                        runCatching {
                            val shareIntent = Intent(Intent.ACTION_SEND).apply {
                                type = "text/plain"
                                putExtra(Intent.EXTRA_TEXT, "Reservá tu turno en línea en: ${profile.publicBookingUrl}")
                            }
                            context.startActivity(Intent.createChooser(shareIntent, "Compartir enlace público"))
                        }
                    },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = MintPrimary,
                        contentColor = OnMintPrimary
                    ),
                    shape = RoundedCornerShape(9999.dp)
                ) {
                    Icon(Icons.Outlined.Share, contentDescription = null, modifier = Modifier.size(16.dp), tint = OnMintPrimary)
                    Spacer(modifier = Modifier.width(6.dp))
                    Text("Compartir por WhatsApp / Redes", fontWeight = FontWeight.Bold, fontSize = 12.sp, color = OnMintPrimary)
                }
            }
        }

        // 2. Mi Plan y Suscripción
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(SurfaceLevel1)
                .border(1.dp, BorderHairline, RoundedCornerShape(18.dp))
                .padding(16.dp)
        ) {
            val isPro = profile.membership.isPro
            val currentUsage = profile.membership.currentMonthUsage
            val monthlyQuota = profile.membership.monthlyQuota ?: 40
            val progress = if (monthlyQuota > 0) (currentUsage.toFloat() / monthlyQuota.toFloat()).coerceIn(0f, 1f) else 1f

            Column {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.SpaceBetween,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(
                            imageVector = Icons.Outlined.Verified,
                            contentDescription = null,
                            tint = if (isPro) EmeraldConfirmed else MintPrimary
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "Mi Plan y Facturación",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextHighEmphasis
                        )
                    }

                    Box(
                        modifier = Modifier
                            .clip(RoundedCornerShape(8.dp))
                            .background(if (isPro) EmeraldContainer else MintContainer)
                            .padding(horizontal = 8.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = if (isPro) "PRO" else "GRATIS",
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold,
                            color = if (isPro) EmeraldConfirmed else MintPrimary
                        )
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                if (!isPro) {
                    Text(
                        text = "Plan Gratis: $currentUsage de $monthlyQuota turnos este mes",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = TextHighEmphasis
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    LinearProgressIndicator(
                        progress = { progress },
                        modifier = Modifier
                            .fillMaxWidth()
                            .height(8.dp)
                            .clip(RoundedCornerShape(4.dp)),
                        color = if (progress >= 0.9f) EmeraldConfirmed else MintPrimary,
                        trackColor = SurfaceLevel2
                    )
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Todas las funciones incluidas. Sin límite de tiempo.",
                        fontSize = 12.sp,
                        color = TextMediumEmphasis
                    )
                } else {
                    Text(
                        text = "Plan Pro Activo • Turnos ilimitados por mes",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = EmeraldConfirmed
                    )
                    if (profile.membership.expiresAtIso.isNotBlank()) {
                        Text(
                            text = "Vencimiento / Renovación: hasta ${profile.membership.expiresAtIso.take(10)}",
                            fontSize = 12.sp,
                            color = TextMediumEmphasis
                        )
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                Button(
                    onClick = { viewModel.openSubscriptionDialog() },
                    modifier = Modifier.fillMaxWidth().height(48.dp),
                    colors = ButtonDefaults.buttonColors(containerColor = MintPrimary, contentColor = OnMintPrimary),
                    shape = RoundedCornerShape(12.dp)
                ) {
                    Text(
                        text = if (isPro) "Ver detalles de mi suscripción" else "Ver planes y pasar a Pro",
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Bold
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(
                        enabled = !billing.isLoading,
                        onClick = viewModel::restoreMemberships,
                        modifier = Modifier.weight(1f).height(48.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Restaurar", color = MintPrimary, fontSize = 12.sp)
                    }

                    OutlinedButton(
                        onClick = {
                            runCatching {
                                context.startActivity(
                                    Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/account/subscriptions"))
                                )
                            }
                        },
                        modifier = Modifier.weight(1f).height(48.dp),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Gestionar en Play", color = MintPrimary, fontSize = 12.sp)
                    }
                }

                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.Center) {
                    TextButton(
                        onClick = {
                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://pediturno.com/terminos"))) }
                        }
                    ) { Text("Términos", color = TextSubtle, fontSize = 11.sp) }
                    Text("•", color = TextSubtle, modifier = Modifier.align(Alignment.CenterVertically))
                    TextButton(
                        onClick = {
                            runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://pediturno.com/privacy-policy"))) }
                        }
                    ) { Text("Privacidad", color = TextSubtle, fontSize = 11.sp) }
                }
            }
        }

        // 3. Reglas de Agenda del Negocio
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(SurfaceLevel1)
                .border(1.dp, BorderHairline, RoundedCornerShape(18.dp))
                .padding(16.dp)
        ) {
            Column {
                Text(
                    text = "Reglas Operativas de Reserva",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextHighEmphasis
                )
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "• Anticipación mínima (Lead Time): ${profile.bookingLeadTimeMinutes} min\n" +
                        "• Horizonte máximo: ${profile.bookingHorizonDays} días\n" +
                        "• Tiempo entre turnos: ${profile.bookingBufferMinutes} min\n" +
                        "• Confirmación automática: ${if (profile.autoConfirmBookings) "Sí" else "No"}",
                    style = LocalTextStyle.current.copy(fontFeatureSettings = "tnum"),
                    fontSize = 12.sp,
                    color = TextMediumEmphasis
                )
                Spacer(modifier = Modifier.height(10.dp))

                // Fila 1: Pausa de cortesía entre citas (15m buffer)
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Pausa entre turnos (15 min)",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = TextHighEmphasis
                        )
                        Text(
                            text = "Margen de cortesía y descanso entre citas consecutivas",
                            fontSize = 11.sp,
                            color = TextMediumEmphasis
                        )
                    }
                    Switch(
                        checked = profile.bookingBufferMinutes > 0,
                        onCheckedChange = { checked ->
                            viewModel.updateBusinessSettings(
                                leadTimeMinutes = profile.bookingLeadTimeMinutes,
                                horizonDays = profile.bookingHorizonDays,
                                bufferMinutes = if (checked) 15 else 0,
                                autoConfirm = profile.autoConfirmBookings
                            )
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = MintPrimary,
                            uncheckedThumbColor = Color.White,
                            uncheckedTrackColor = SurfaceLevel2
                        )
                    )
                }

                Spacer(modifier = Modifier.height(6.dp))

                // Fila 2: Confirmación automática de turnos
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 4.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Confirmación automática",
                            fontSize = 13.sp,
                            fontWeight = FontWeight.SemiBold,
                            color = TextHighEmphasis
                        )
                        Text(
                            text = "Los turnos quedan confirmados sin requerir aprobación manual",
                            fontSize = 11.sp,
                            color = TextMediumEmphasis
                        )
                    }
                    Switch(
                        checked = profile.autoConfirmBookings,
                        onCheckedChange = { checked ->
                            viewModel.updateBusinessSettings(
                                leadTimeMinutes = profile.bookingLeadTimeMinutes,
                                horizonDays = profile.bookingHorizonDays,
                                bufferMinutes = profile.bookingBufferMinutes,
                                autoConfirm = checked
                            )
                        },
                        colors = SwitchDefaults.colors(
                            checkedThumbColor = Color.White,
                            checkedTrackColor = MintPrimary,
                            uncheckedThumbColor = Color.White,
                            uncheckedTrackColor = SurfaceLevel2
                        )
                    )
                }
            }
        }

        // 4. Notificaciones y Sedes Multi-Sucursal
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(SurfaceLevel1)
                .border(1.dp, BorderHairline, RoundedCornerShape(18.dp))
                .padding(16.dp)
        ) {
            Column {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.NotificationsActive, contentDescription = null, tint = MintPrimary)
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = "Notificaciones y Sedes",
                        fontSize = 15.sp,
                        fontWeight = FontWeight.Bold,
                        color = TextHighEmphasis
                    )
                }
                Spacer(modifier = Modifier.height(6.dp))
                Text(
                    text = "Alertas en tiempo real: ${if (hasNotificationPermission) "Activas y sincronizadas" else "Requieren permiso"}",
                    fontSize = 12.sp,
                    color = if (hasNotificationPermission) EmeraldConfirmed else AmberPending,
                    fontWeight = FontWeight.SemiBold
                )
                if (!hasNotificationPermission) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Button(
                        onClick = onRequestNotificationPermission,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MintPrimary,
                            contentColor = OnMintPrimary
                        ),
                        shape = RoundedCornerShape(10.dp)
                    ) {
                        Text("Activar Notificaciones", fontSize = 11.sp, color = OnMintPrimary)
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(BorderHairline)
                )
                Spacer(modifier = Modifier.height(12.dp))

                Text(text = "NEGOCIO ACTIVO", fontSize = 10.sp, fontWeight = FontWeight.Bold, color = TextSubtle, letterSpacing = 0.05.sp)
                Spacer(modifier = Modifier.height(4.dp))
                Text(text = profile.name.ifBlank { "Sin datos verificados" }, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = TextHighEmphasis)
            }
        }

        // 5. Privacidad y eliminación de cuenta
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(18.dp))
                .background(SurfaceLevel1)
                .border(1.dp, BorderHairline, RoundedCornerShape(18.dp))
                .padding(16.dp)
        ) {
            Column {
                Text(
                    text = "Privacidad y eliminación de cuenta",
                    fontSize = 14.sp,
                    fontWeight = FontWeight.Bold,
                    color = TextHighEmphasis
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = "Podés solicitar la baja de tu cuenta y la eliminación de datos operativos desde la app o vía web.",
                    fontSize = 12.sp,
                    color = TextMediumEmphasis
                )
                if (uiState.lastDeletionTicket != null) {
                    Spacer(modifier = Modifier.height(6.dp))
                    Text(
                        text = "Ticket de baja registrado: ${uiState.lastDeletionTicket}",
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold,
                        color = AmberPending
                    )
                }
                Spacer(modifier = Modifier.height(10.dp))
                OutlinedButton(
                    onClick = { viewModel.openDeleteAccountDialog() },
                    shape = RoundedCornerShape(10.dp)
                ) {
                    Text("Solicitar Eliminación de Cuenta", color = CrimsonCancelled, fontSize = 12.sp)
                }
            }
        }

        Spacer(modifier = Modifier.height(24.dp))
    }
}
