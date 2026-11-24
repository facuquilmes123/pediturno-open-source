package com.pediturno.servicios.ui.agenda

import android.app.Activity
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.data.export.PendingWorkspaceExport
import com.pediturno.servicios.data.export.ExportPayloadStore
import com.pediturno.servicios.data.export.AgendaExportSnapshot
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.core.timezone.SlotAvailability
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.model.BusinessProfile
import com.pediturno.servicios.data.model.ClientItem
import com.pediturno.servicios.data.model.DaySchedule
import com.pediturno.servicios.data.model.BookingRules
import com.pediturno.servicios.data.model.MercadoPagoConnectionStatus
import com.pediturno.servicios.data.model.AppointmentNotificationKind
import com.pediturno.servicios.data.model.ServiceItem
import com.pediturno.servicios.data.repository.AgendaLoadState
import com.pediturno.servicios.data.repository.AgendaRepository
import com.pediturno.servicios.data.repository.AuthRepository
import com.pediturno.servicios.data.repository.PushDiagnosticEvent
import com.pediturno.servicios.data.repository.PushRepository
import com.pediturno.servicios.data.repository.GooglePlayBillingBackend
import com.pediturno.servicios.data.repository.GooglePlayBillingRepository
import com.pediturno.servicios.data.repository.BillingEvent
import com.pediturno.servicios.data.repository.MercadoPagoHandoff
import com.pediturno.servicios.data.repository.BusinessImageRepository
import com.pediturno.servicios.data.repository.ImageCategory
import com.pediturno.servicios.domain.usecase.CreateAppointmentUseCase
import com.pediturno.servicios.domain.usecase.RescheduleAppointmentUseCase
import com.pediturno.servicios.domain.usecase.UpdateAppointmentStatusUseCase
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.cancelChildren
import java.util.concurrent.atomic.AtomicLong

enum class WorkspaceTab(val title: String) {
    AGENDA("Agenda"),
    SERVICIOS("Servicios"),
    CLIENTES("Clientes"),
    NEGOCIO("Mi Negocio")
}

data class AgendaUiState(
    val activeTab: WorkspaceTab = WorkspaceTab.AGENDA,
    val activeBusinessId: String = "",
    val businessProfile: BusinessProfile = BusinessProfile(
        id = "",
        name = "",
        slug = "",
        email = ""
    ),
    val dateKey: String = "",
    val displayDate: String = "",
    val isMonthViewOpen: Boolean = false,
    val loadState: AgendaLoadState = AgendaLoadState.Loading,
    val statusFilter: AppointmentStatus? = null,
    val searchQuery: String = "",
    val highlightedAppointmentId: String? = null,
    val selectedAppointmentDetail: Appointment? = null,
    val services: List<ServiceItem> = emptyList(),
    val isServicesLoading: Boolean = false,
    val servicesError: String? = null,
    val clients: List<ClientItem> = emptyList(),
    val isClientsLoading: Boolean = false,
    val clientsError: String? = null,
    val isCreateDialogOpen: Boolean = false,
    val prefillClientName: String = "",
    val prefillClientPhone: String = "",
    val prefillClientEmail: String = "",
    val isRescheduleDialogOpen: Boolean = false,
    val appointmentToReschedule: Appointment? = null,
    val isServiceDialogOpen: Boolean = false,
    val serviceToEdit: ServiceItem? = null,
    val isServiceAvailabilityDialogOpen: Boolean = false,
    val serviceForAvailability: ServiceItem? = null,
    val isClientDialogOpen: Boolean = false,
    val isClientDetailDialogOpen: Boolean = false,
    val selectedClient: ClientItem? = null,
    val isEditBusinessProfileOpen: Boolean = false,
    val isSubscriptionDialogOpen: Boolean = false,
    val isCheckingSlug: Boolean = false,
    val isSlugAvailable: Boolean? = null,
    val isDeleteAccountDialogOpen: Boolean = false,
    val lastDeletionTicket: String? = null,
    val isSimulatedOffline: Boolean = false,
    val isGuidedTourOpen: Boolean = false,
    val tourStep: Int = 0,
    val fcmToken: String? = null,
    val pushEvents: List<PushDiagnosticEvent> = emptyList(),
    val isSubmittingAction: Boolean = false,
    val dialogError: String? = null
)

data class BillingUiState(
    val isLoading: Boolean = false,
    val formattedPrice: String? = null,
    val billingPeriod: String? = null,
    val renewalDescription: String? = null,
    val entitlementStatus: String = "unknown",
    val entitlementExpiresAt: String? = null,
    val canPurchase: Boolean = false,
    val message: String? = null,
    val purchaseResultMessage: String? = null
) {
    val requiresExistingSubscriptionManagement: Boolean
        get() = entitlementStatus in setOf("on_hold", "paused", "pending")
    val recoveryMessage: String?
        get() = when (entitlementStatus) {
            "on_hold" -> "Tu suscripción está suspendida por un problema de pago. Actualizá el método de pago en Google Play para recuperar Pro."
            "paused" -> "Tu suscripción está pausada. Podés reanudarla desde Google Play."
            "pending" -> "Tu compra está pendiente de confirmación en Google Play. No hace falta iniciar otra compra."
            else -> null
        }
    val canStartNewPurchase: Boolean
        get() = canPurchase && !requiresExistingSubscriptionManagement
}

data class AvailabilityUiState(
    val serviceId: String? = null,
    val dateKey: String? = null,
    val slots: List<SlotAvailability> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

data class ClientHistoryUiState(
    val clientId: String? = null,
    val appointments: List<Appointment> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

data class MercadoPagoUiState(
    val configured: Boolean = false,
    val connected: Boolean = false,
    val depositsEnabled: Boolean = false,
    val canConfigureDeposits: Boolean = false,
    val requireDeposit: Boolean = false,
    val depositType: String = "percentage",
    val depositValue: Double = 0.0,
    val isLoading: Boolean = false,
    val error: String? = null
)

data class DashboardUiState(
    val monthKey: String = "",
    val timeZone: String = "",
    val upcomingAppointmentsCount: Int = 0,
    val totalClients: Int = 0,
    val monthlyRevenue: Double = 0.0,
    val upcomingAppointments: List<Appointment> = emptyList(),
    val hasLoadedData: Boolean = false,
    val isLoading: Boolean = false,
    val error: String? = null
)

data class ReauthenticationUiState(
    val isOpen: Boolean = false,
    val isLoading: Boolean = false,
    val error: String? = null,
    val email: String = "",
    val allowPassword: Boolean = false,
    val allowGoogle: Boolean = false
)

class AgendaViewModel(
    private val agendaRepository: AgendaRepository,
    private val createAppointmentUseCase: CreateAppointmentUseCase,
    private val rescheduleAppointmentUseCase: RescheduleAppointmentUseCase,
    private val updateAppointmentStatusUseCase: UpdateAppointmentStatusUseCase,
    private val timeZoneManager: BusinessTimeZoneManager = BusinessTimeZoneManager(),
    private val authRepository: AuthRepository? = null,
    private val pushRepository: PushRepository? = null,
    private val billingRepository: GooglePlayBillingRepository? = null,
    private val billingBackend: GooglePlayBillingBackend? = null,
    private val imageRepository: BusinessImageRepository? = null,
    private val packageName: String = "",
    agendaExportStore: ExportPayloadStore<AgendaExportSnapshot>? = null,
    clientsExportStore: ExportPayloadStore<List<ClientItem>>? = null
) : ViewModel() {

    val agendaExport = PendingWorkspaceExport(viewModelScope, agendaExportStore)
    val clientsExport = PendingWorkspaceExport(viewModelScope, clientsExportStore)

    private val _uiState = MutableStateFlow(AgendaUiState())
    val uiState: StateFlow<AgendaUiState> = _uiState.asStateFlow()

    private val _snackBarMessages = MutableSharedFlow<String>()
    val snackBarMessages: SharedFlow<String> = _snackBarMessages.asSharedFlow()
    private val _billingUiState = MutableStateFlow(BillingUiState())
    val billingUiState: StateFlow<BillingUiState> = _billingUiState.asStateFlow()
    private val _availabilityUiState = MutableStateFlow(AvailabilityUiState())
    val availabilityUiState: StateFlow<AvailabilityUiState> = _availabilityUiState.asStateFlow()
    private val _clientHistoryUiState = MutableStateFlow(ClientHistoryUiState())
    val clientHistoryUiState: StateFlow<ClientHistoryUiState> = _clientHistoryUiState.asStateFlow()
    private val _mercadoPagoUiState = MutableStateFlow(MercadoPagoUiState())
    val mercadoPagoUiState: StateFlow<MercadoPagoUiState> = _mercadoPagoUiState.asStateFlow()
    private val _dashboardUiState = MutableStateFlow(DashboardUiState())
    val dashboardUiState: StateFlow<DashboardUiState> = _dashboardUiState.asStateFlow()
    private val _reauthUiState = MutableStateFlow(ReauthenticationUiState())
    val reauthUiState: StateFlow<ReauthenticationUiState> = _reauthUiState.asStateFlow()
    private var pendingDeletionReason: String? = null
    private var deletionRetryUsed = false
    private val claimedPurchaseTokens = mutableSetOf<String>()
    private val agendaRequestGeneration = AtomicLong(0)
    private val availabilityRequestGeneration = AtomicLong(0)
    private val dashboardRequestGeneration = AtomicLong(0)
    private val clientHistoryRequestGeneration = AtomicLong(0)

    init {
        val today = timeZoneManager.todayDateKey()
        val initialBizId = authRepository?.session?.value?.activeBusinessId.orEmpty()
        _uiState.update {
            it.copy(
                activeBusinessId = initialBizId,
                dateKey = today,
                displayDate = timeZoneManager.formatDisplayDate(today)
            )
        }
        observePushState()
        viewModelScope.launch { pushRepository?.ensureRegistered() }
        observePurchases()
        observeBillingEvents()
        refreshBilling()
        refreshMercadoPagoStatus()
        loadDashboard()
        bootstrapWorkspace(today, initialBizId)
    }

    private fun observePurchases() {
        val billing = billingRepository ?: return
        viewModelScope.launch {
            billing.purchases.collect { purchase ->
                if (!claimedPurchaseTokens.add(purchase.purchaseToken)) return@collect
                _billingUiState.update { it.copy(isLoading = true, message = "Verificando tu compra…", purchaseResultMessage = null) }
                when (val verification = billingBackend?.verify(purchase.purchaseToken, packageName)) {
                    is ApiResult.Success -> {
                        if (verification.data.verified) {
                            refreshBilling()
                            loadBusinessProfile()
                            _snackBarMessages.emit("Membresía verificada.")
                        } else {
                            claimedPurchaseTokens.remove(purchase.purchaseToken)
                            _billingUiState.update { it.copy(isLoading = false, purchaseResultMessage = "La compra todavía no fue verificada. Volvé a intentar más tarde.") }
                        }
                    }
                    is ApiResult.Error -> {
                        claimedPurchaseTokens.remove(purchase.purchaseToken)
                        _billingUiState.update { it.copy(isLoading = false, purchaseResultMessage = verification.message) }
                    }
                    is ApiResult.NetworkError, null -> {
                        claimedPurchaseTokens.remove(purchase.purchaseToken)
                        _billingUiState.update { it.copy(isLoading = false, purchaseResultMessage = "No hay conexión: la membresía no se habilitó. Reintentá restaurar más tarde.") }
                    }
                }
            }
        }
    }

    private fun observeBillingEvents() {
        val billing = billingRepository ?: return
        viewModelScope.launch {
            billing.events.collect { event ->
                when (event) {
                    is BillingEvent.Pending -> _billingUiState.update { it.copy(isLoading = false, purchaseResultMessage = "Tu compra está pendiente de aprobación en Google Play.") }
                    BillingEvent.Cancelled -> _billingUiState.update { it.copy(isLoading = false, purchaseResultMessage = "La compra fue cancelada.") }
                    BillingEvent.NoPurchases -> _billingUiState.update { it.copy(isLoading = false, purchaseResultMessage = "No encontramos compras de Google Play para restaurar.") }
                    is BillingEvent.Error -> _billingUiState.update { it.copy(isLoading = false, purchaseResultMessage = event.message) }
                }
            }
        }
    }

    fun refreshBilling() {
        val billing = billingRepository ?: return
        val backend = billingBackend ?: return
        viewModelScope.launch {
            _billingUiState.update { it.copy(isLoading = true, message = null) }
            val status = backend.status()
            val authorization = backend.account()
            if (status is ApiResult.Success) _billingUiState.update { it.copy(entitlementStatus = status.data.status, entitlementExpiresAt = status.data.expiresAt) }
            billing.connect { connection ->
                if (connection.responseCode != 0) {
                    _billingUiState.update { it.copy(isLoading = false, message = "No se pudo conectar con Google Play. Verificá tu conexión y volvé a intentar.") }
                } else billing.queryProduct { product ->
                    when (product) {
                        is ApiResult.Success -> {
                            val offer = (authorization as? ApiResult.Success)?.data?.let { billing.offerPresentation(product.data, it.basePlanId) }
                            _billingUiState.update { it.copy(isLoading = false, formattedPrice = offer?.formattedPrice, billingPeriod = offer?.billingPeriod, renewalDescription = offer?.renewalDescription, canPurchase = (authorization as? ApiResult.Success)?.data?.purchaseAllowed == true, message = if (offer == null) "El plan mensual no está disponible." else null) }
                        }
                        is ApiResult.Error -> _billingUiState.update { it.copy(isLoading = false, message = product.message) }
                        is ApiResult.NetworkError -> _billingUiState.update { it.copy(isLoading = false, message = "No se pudo consultar Google Play.") }
                    }
                }
            }
        }
    }

    fun purchaseMembership(activity: Activity) {
        val billing = billingRepository ?: return
        val backend = billingBackend ?: return
        viewModelScope.launch {
            _billingUiState.update { it.copy(isLoading = true, message = null, purchaseResultMessage = null) }
            when (val authorization = backend.account()) {
                is ApiResult.Success -> billing.connect { connection ->
                    if (connection.responseCode != 0) _billingUiState.update { it.copy(isLoading = false, message = "No se pudo conectar con Google Play. Verificá tu conexión y volvé a intentar.") }
                    else billing.queryProduct { product ->
                        if (product is ApiResult.Success) {
                            when (val launch = billing.launchSubscription(activity, product.data, authorization.data)) {
                                is ApiResult.Success -> _billingUiState.update { it.copy(isLoading = false, canPurchase = false, message = "Completá la compra en Google Play; se verificará al volver.") }
                                is ApiResult.Error -> _billingUiState.update { it.copy(isLoading = false, message = launch.message) }
                                is ApiResult.NetworkError -> Unit
                            }
                        } else _billingUiState.update { it.copy(isLoading = false, message = (product as? ApiResult.Error)?.message ?: "No se pudo consultar el producto.") }
                    }
                }
                is ApiResult.Error -> _billingUiState.update { it.copy(isLoading = false, message = authorization.message) }
                is ApiResult.NetworkError -> _billingUiState.update { it.copy(isLoading = false, message = "No hay conexión para validar elegibilidad.") }
            }
        }
    }

    fun restoreMemberships() {
        val billing = billingRepository ?: return
        viewModelScope.launch {
            _billingUiState.update { it.copy(isLoading = true, message = "Buscando compras existentes…", purchaseResultMessage = null) }
            billing.restorePurchases { result ->
                _billingUiState.update { it.copy(isLoading = false, message = when (result) { is ApiResult.Error -> result.message; is ApiResult.NetworkError -> "No hay conexión para restaurar."; is ApiResult.Success -> "Compras restauradas: ${result.data}." }) }
                refreshBilling()
            }
        }
    }

    fun connectMercadoPago(context: android.content.Context) {
        viewModelScope.launch {
            when (val handoff = agendaRepository.createMercadoPagoHandoff()) {
                is ApiResult.Success -> MercadoPagoHandoff.open(context, handoff.data).onFailure { _snackBarMessages.emit("No se pudo abrir Mercado Pago.") }
                is ApiResult.Error -> _snackBarMessages.emit("No se pudo iniciar la conexión: ${handoff.message}")
                is ApiResult.NetworkError -> _snackBarMessages.emit("Sin conexión para iniciar Mercado Pago.")
            }
        }
    }

    fun refreshMercadoPagoStatus() {
        viewModelScope.launch {
            _mercadoPagoUiState.update { it.copy(isLoading = true, error = null) }
            when (val result = agendaRepository.getMercadoPagoStatus()) {
                is ApiResult.Success -> _mercadoPagoUiState.value = result.data.toUiState()
                is ApiResult.Error -> _mercadoPagoUiState.update { it.copy(isLoading = false, error = result.message) }
                is ApiResult.NetworkError -> _mercadoPagoUiState.update { it.copy(isLoading = false, error = "Sin conexión para consultar Mercado Pago.") }
            }
        }
    }

    fun saveMercadoPagoSettings(requireDeposit: Boolean, depositType: String, depositValue: Double) {
        viewModelScope.launch {
            _mercadoPagoUiState.update { it.copy(isLoading = true, error = null) }
            when (val result = agendaRepository.updateMercadoPagoSettings(requireDeposit, depositType, depositValue)) {
                is ApiResult.Success -> {
                    _mercadoPagoUiState.value = result.data.toUiState()
                    loadBusinessProfile()
                    _snackBarMessages.emit("Configuración de señas actualizada.")
                }
                is ApiResult.Error -> _mercadoPagoUiState.update { it.copy(isLoading = false, error = result.message) }
                is ApiResult.NetworkError -> _mercadoPagoUiState.update { it.copy(isLoading = false, error = "Sin conexión para guardar las señas.") }
            }
        }
    }

    fun disconnectMercadoPago() {
        viewModelScope.launch {
            _mercadoPagoUiState.update { it.copy(isLoading = true, error = null) }
            when (val result = agendaRepository.disconnectMercadoPago()) {
                is ApiResult.Success -> {
                    _mercadoPagoUiState.value = result.data.toUiState()
                    loadBusinessProfile()
                    _snackBarMessages.emit("Mercado Pago fue desvinculado.")
                }
                is ApiResult.Error -> _mercadoPagoUiState.update { it.copy(isLoading = false, error = result.message) }
                is ApiResult.NetworkError -> _mercadoPagoUiState.update { it.copy(isLoading = false, error = "Sin conexión para desvincular Mercado Pago.") }
            }
        }
    }

    private fun MercadoPagoConnectionStatus.toUiState() = MercadoPagoUiState(
        configured = configured, connected = connected, depositsEnabled = depositsEnabled,
        canConfigureDeposits = canConfigureDeposits, requireDeposit = requireDeposit,
        depositType = depositType, depositValue = depositValue
    )

    fun uploadImage(uri: android.net.Uri, category: ImageCategory, onUploaded: (String) -> Unit) {
        if (_uiState.value.isSubmittingAction) return
        val images = imageRepository ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, dialogError = null) }
            images.upload(uri, category).fold(
                onSuccess = { url -> _uiState.update { it.copy(isSubmittingAction = false) }; onUploaded(url) },
                onFailure = { error -> _uiState.update { it.copy(isSubmittingAction = false, dialogError = error.message ?: "No se pudo subir la imagen.") } }
            )
        }
    }

    private fun observePushState() {
        val pushRepo = pushRepository ?: return
        viewModelScope.launch {
            pushRepo.currentToken.collect { token ->
                _uiState.update { it.copy(fcmToken = token) }
            }
        }
        viewModelScope.launch {
            pushRepo.recentPushEvents.collect { events ->
                _uiState.update { it.copy(pushEvents = events) }
            }
        }
    }

    fun refreshAllWorkspaceData(
        dateKey: String = _uiState.value.dateKey,
        businessId: String = _uiState.value.activeBusinessId
    ) {
        loadBusinessProfile(businessId)
        loadServices(businessId)
        loadClients(businessId)
        loadAgenda(dateKey, businessId)
        loadDashboard()
    }

    /**
     * Firebase authentication alone does not create a business.  Bootstrap is
     * deliberately sequential: only a confirmed 404 can create the initial
     * server-owned Servicios profile, never a transient/auth failure.
     */
    private fun bootstrapWorkspace(dateKey: String, businessId: String) {
        viewModelScope.launch {
            when (val existing = agendaRepository.getBusinessProfile(businessId)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(businessProfile = existing.data) }
                    loadServices(businessId)
                    loadClients(businessId)
                    // A cold-start link may have selected another day while the
                    // profile request was in flight. Preserve that latest choice.
                    loadAgenda(_uiState.value.dateKey.ifBlank { dateKey }, businessId)
                    loadDashboard()
                }
                is ApiResult.Error if existing.code == 404 && existing.reason == "BUSINESS_PROFILE_REQUIRED" -> {
                    val session = authRepository?.session?.value
                    val preferredName = session?.displayName?.trim().orEmpty().ifBlank {
                        session?.email?.substringBefore('@')?.takeIf { it.length >= 3 } ?: "Mi negocio"
                    }
                    when (val created = agendaRepository.createBusinessProfile(preferredName)) {
                        is ApiResult.Success -> bootstrapWorkspace(dateKey, businessId)
                        is ApiResult.Error -> failBootstrap(created.message, created.code)
                        is ApiResult.NetworkError -> failBootstrap("Sin conexión. No se pudo crear el negocio todavía.", 503)
                    }
                }
                is ApiResult.Error -> failBootstrap(existing.message, existing.code)
                is ApiResult.NetworkError -> {
                    // An authenticated UID can restore only its own date-scoped, fresh cache.
                    // Auth/profile rejections above never enter the offline fallback.
                    if (businessId.isNotBlank()) loadAgenda(_uiState.value.dateKey.ifBlank { dateKey }, businessId)
                    else failBootstrap("Sin conexión. No se pudo cargar tu negocio.", 503)
                }
            }
        }
    }

    fun resendVerificationEmail() {
        viewModelScope.launch {
            val result = authRepository?.resendVerification() ?: return@launch
            _snackBarMessages.emit(if (result.isSuccess) "Revisá tu correo: enviamos el enlace de verificación." else result.exceptionOrNull()?.message ?: "No se pudo enviar el correo. Reintentá.")
        }
    }

    fun retryVerifiedBootstrap() {
        viewModelScope.launch {
            val result = authRepository?.reloadVerifiedSession() ?: return@launch
            if (result.isSuccess) bootstrapWorkspace(_uiState.value.dateKey, _uiState.value.activeBusinessId)
            else _snackBarMessages.emit(result.exceptionOrNull()?.message ?: "No se pudo comprobar la cuenta. Reintentá.")
        }
    }

    private fun failBootstrap(message: String, code: Int) {
        val actionable = if (code == 403 && message.contains("correo", ignoreCase = true)) {
            "Verificá tu correo y volvé a iniciar sesión para activar tu negocio."
        } else message
        _uiState.update { it.copy(loadState = AgendaLoadState.Error(actionable, code), dialogError = actionable) }
        showMessage(actionable)
    }

    fun selectTab(tab: WorkspaceTab) {
        _uiState.update { it.copy(activeTab = tab) }
        // A failed or raced bootstrap must not leave a catalog permanently empty.
        // Opening its tab is an explicit user-initiated refresh with a visible
        // loading/error state and retry control.
        when (tab) {
            WorkspaceTab.SERVICIOS -> loadServices()
            WorkspaceTab.CLIENTES -> loadClients()
            else -> Unit
        }
    }

    fun toggleMonthView() {
        _uiState.update { it.copy(isMonthViewOpen = !it.isMonthViewOpen) }
    }

    fun closeMonthView() {
        _uiState.update { state ->
            if (state.isMonthViewOpen) state.copy(isMonthViewOpen = false) else state
        }
    }

    fun setStatusFilter(status: AppointmentStatus?) {
        _uiState.update { it.copy(statusFilter = status) }
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    fun showMessage(msg: String) {
        viewModelScope.launch {
            _snackBarMessages.emit(msg)
        }
    }

    fun handleDeepLink(appointmentId: String?, dateKey: String?) {
        val targetDate = dateKey?.takeIf { candidate ->
            runCatching { timeZoneManager.parseDateKey(candidate) }.isSuccess
        } ?: _uiState.value.dateKey
        _uiState.update {
            it.copy(
                activeTab = WorkspaceTab.AGENDA,
                dateKey = targetDate,
                displayDate = timeZoneManager.formatDisplayDate(targetDate),
                highlightedAppointmentId = appointmentId,
                statusFilter = null
            )
        }
        loadAgenda(targetDate)
    }

    fun openAppointmentDetail(appointment: Appointment) {
        _uiState.update {
            it.copy(
                selectedAppointmentDetail = appointment,
                highlightedAppointmentId = appointment.id
            )
        }
    }

    fun closeAppointmentDetail() {
        _uiState.update { it.copy(selectedAppointmentDetail = null) }
    }

    private fun loadBusinessProfile(businessId: String = _uiState.value.activeBusinessId) {
        viewModelScope.launch {
            when (val res = agendaRepository.getBusinessProfile(businessId)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(businessProfile = res.data) }
                }
                else -> {}
            }
        }
    }

    fun loadServices(businessId: String = _uiState.value.activeBusinessId) {
        viewModelScope.launch {
            _uiState.update { it.copy(isServicesLoading = true, servicesError = null) }
            when (val res = agendaRepository.getServices(businessId)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(services = res.data, isServicesLoading = false) }
                }
                is ApiResult.Error -> _uiState.update {
                    it.copy(isServicesLoading = false, servicesError = res.message)
                }
                is ApiResult.NetworkError -> _uiState.update {
                    it.copy(isServicesLoading = false, servicesError = "Sin conexión para cargar el catálogo.")
                }
            }
        }
    }

    fun loadClients(businessId: String = _uiState.value.activeBusinessId) {
        viewModelScope.launch {
            _uiState.update { it.copy(isClientsLoading = true, clientsError = null) }
            when (val res = agendaRepository.getClients(businessId)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(clients = res.data, isClientsLoading = false) }
                }
                is ApiResult.Error -> _uiState.update {
                    it.copy(isClientsLoading = false, clientsError = res.message)
                }
                is ApiResult.NetworkError -> _uiState.update {
                    it.copy(isClientsLoading = false, clientsError = "Sin conexión para cargar los clientes.")
                }
            }
        }
    }

    fun retryServices() = loadServices()

    fun retryClients() = loadClients()

    fun loadDashboard(monthKey: String = timeZoneManager.todayDateKey().take(7)) {
        viewModelScope.launch { refreshDashboard(monthKey) }
    }

    /** Completes only after the latest server-backed dashboard state has been applied. */
    private suspend fun refreshDashboard(monthKey: String = timeZoneManager.todayDateKey().take(7)) {
        val generation = dashboardRequestGeneration.incrementAndGet()
        _dashboardUiState.update { it.copy(monthKey = monthKey, isLoading = true, error = null) }
        when (val result = agendaRepository.getDashboard(monthKey)) {
            is ApiResult.Success -> if (generation == dashboardRequestGeneration.get()) {
                _dashboardUiState.value = DashboardUiState(
                    monthKey = result.data.monthKey, timeZone = result.data.timeZone,
                    upcomingAppointmentsCount = result.data.upcomingAppointmentsCount,
                    totalClients = result.data.totalClients, monthlyRevenue = result.data.monthlyRevenue,
                    upcomingAppointments = result.data.upcomingAppointments,
                    hasLoadedData = true
                )
            }
            is ApiResult.Error -> if (generation == dashboardRequestGeneration.get()) {
                _dashboardUiState.update { it.copy(isLoading = false, error = result.message) }
            }
            is ApiResult.NetworkError -> if (generation == dashboardRequestGeneration.get()) {
                _dashboardUiState.update { it.copy(isLoading = false, error = "Sin conexión para cargar el resumen.") }
            }
        }
    }

    fun loadClientHistory(clientId: String) {
        viewModelScope.launch {
            val generation = clientHistoryRequestGeneration.incrementAndGet()
            _clientHistoryUiState.value = ClientHistoryUiState(clientId = clientId, isLoading = true)
            when (val result = agendaRepository.getClientHistory(clientId)) {
                is ApiResult.Success -> if (generation == clientHistoryRequestGeneration.get()) {
                    _clientHistoryUiState.value = ClientHistoryUiState(clientId = clientId, appointments = result.data)
                }
                is ApiResult.Error -> if (generation == clientHistoryRequestGeneration.get()) {
                    _clientHistoryUiState.value = ClientHistoryUiState(clientId = clientId, error = result.message)
                }
                is ApiResult.NetworkError -> if (generation == clientHistoryRequestGeneration.get()) {
                    _clientHistoryUiState.value = ClientHistoryUiState(clientId = clientId, error = "Sin conexión para consultar el historial.")
                }
            }
        }
    }

    fun sendAppointmentNotification(appointmentId: String, kind: AppointmentNotificationKind) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true) }
            when (val result = agendaRepository.sendAppointmentNotification(appointmentId, kind)) {
                is ApiResult.Success -> _snackBarMessages.emit("Notificación enviada a la cola.")
                is ApiResult.Error -> _snackBarMessages.emit(result.message)
                is ApiResult.NetworkError -> _snackBarMessages.emit("Sin conexión: no se pudo enviar la notificación.")
            }
            _uiState.update { it.copy(isSubmittingAction = false) }
        }
    }

    fun loadAgenda(
        dateKey: String = _uiState.value.dateKey,
        businessId: String = _uiState.value.activeBusinessId
    ) {
        viewModelScope.launch { refreshAgendaInUi(dateKey, businessId) }
    }

    /**
     * Applies the server refresh before returning so mutation flows cannot expose
     * actions for an appointment from the previous day while a new day is loading.
     */
    private suspend fun refreshAgendaInUi(
        dateKey: String,
        businessId: String
    ) {
        val generation = agendaRequestGeneration.incrementAndGet()
        _uiState.update {
            // A same-day refresh (for example immediately after creating a
            // booking) must retain the rendered list until the replacement
            // arrives. Replacing it with Loading tears down LazyColumn items
            // and makes user actions disappear mid-interaction.
            val keepVisibleAgenda = it.dateKey == dateKey && it.loadState is AgendaLoadState.Loaded
            it.copy(
                dateKey = dateKey,
                displayDate = timeZoneManager.formatDisplayDate(dateKey),
                loadState = if (keepVisibleAgenda) it.loadState else AgendaLoadState.Loading
            )
        }
        val state = agendaRepository.refreshAgenda(dateKey, businessId)
        if (generation != agendaRequestGeneration.get() || dateKey != _uiState.value.dateKey || businessId != _uiState.value.activeBusinessId) return
        _uiState.update { current ->
            val detailUpdated = if (current.selectedAppointmentDetail != null && state is AgendaLoadState.Loaded) {
                state.appointments.firstOrNull { it.id == current.selectedAppointmentDetail.id }
            } else {
                current.selectedAppointmentDetail
            }
            current.copy(
                loadState = state,
                selectedAppointmentDetail = detailUpdated
            )
        }
    }

    fun nextDay() {
        val current = timeZoneManager.parseDateKey(_uiState.value.dateKey)
        val nextKey = timeZoneManager.formatDateKey(current.plusDays(1))
        loadAgenda(nextKey)
    }

    fun previousDay() {
        val current = timeZoneManager.parseDateKey(_uiState.value.dateKey)
        val prevKey = timeZoneManager.formatDateKey(current.minusDays(1))
        loadAgenda(prevKey)
    }

    fun selectDate(dateKey: String) {
        loadAgenda(dateKey)
    }

    fun openCreateDialog(
        clientName: String = "",
        clientPhone: String = "",
        clientEmail: String = ""
    ) {
        _uiState.update {
            it.copy(
                activeTab = WorkspaceTab.AGENDA,
                isCreateDialogOpen = true,
                prefillClientName = clientName,
                prefillClientPhone = clientPhone,
                prefillClientEmail = clientEmail,
                dialogError = null
            )
        }
        _uiState.value.services.firstOrNull { it.isActive }?.let { loadAvailability(it.id) }
    }

    fun loadAvailability(serviceId: String, dateKey: String = _uiState.value.dateKey, excludeAppointmentId: String? = null) {
        val generation = availabilityRequestGeneration.incrementAndGet()
        viewModelScope.launch {
            _availabilityUiState.value = AvailabilityUiState(serviceId, dateKey, isLoading = true)
            when (val result = agendaRepository.getAvailability(serviceId, dateKey, excludeAppointmentId)) {
                // Rescheduling can query a date selected inside the dialog. That
                // local date intentionally differs from the agenda day, so only
                // the request generation establishes whether this result is stale.
                is ApiResult.Success -> if (generation == availabilityRequestGeneration.get()) {
                    _availabilityUiState.value = AvailabilityUiState(serviceId, dateKey, result.data)
                }
                is ApiResult.Error -> if (generation == availabilityRequestGeneration.get()) _availabilityUiState.value = AvailabilityUiState(serviceId, dateKey, error = result.message)
                is ApiResult.NetworkError -> if (generation == availabilityRequestGeneration.get()) _availabilityUiState.value = AvailabilityUiState(serviceId, dateKey, error = "Sin conexión para consultar horarios.")
            }
        }
    }

    fun closeCreateDialog() {
        _uiState.update {
            it.copy(
                isCreateDialogOpen = false,
                prefillClientName = "",
                prefillClientPhone = "",
                prefillClientEmail = "",
                dialogError = null
            )
        }
    }

    fun openGuidedTour() {
        _uiState.update { it.copy(isGuidedTourOpen = true, tourStep = 0) }
    }

    fun closeGuidedTour() {
        _uiState.update { it.copy(isGuidedTourOpen = false) }
    }

    fun setTourStep(step: Int) {
        _uiState.update { it.copy(tourStep = step) }
    }

    fun openRescheduleDialog(appointment: Appointment) {
        _uiState.update {
            it.copy(
                isRescheduleDialogOpen = true,
                appointmentToReschedule = appointment,
                dialogError = null
            )
        }
    }

    fun closeRescheduleDialog() {
        _uiState.update {
            it.copy(
                isRescheduleDialogOpen = false,
                appointmentToReschedule = null,
                dialogError = null
            )
        }
    }

    fun createAppointment(
        client: String,
        phone: String,
        email: String,
        serviceId: String,
        time: String
    ) {
        val bizId = _uiState.value.activeBusinessId
        val dateKey = _uiState.value.dateKey
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, dialogError = null) }
            val result = createAppointmentUseCase(
                client = client,
                clientPhone = phone,
                clientEmail = email,
                serviceId = serviceId,
                dateKey = dateKey,
                time = time,
                businessId = bizId
            )
            when (result) {
                is ApiResult.Success -> {
                    refreshAgendaInUi(dateKey, bizId)
                    refreshDashboard()
                    loadBusinessProfile(bizId)
                    _uiState.update {
                        it.copy(
                            isSubmittingAction = false,
                            isCreateDialogOpen = false,
                            highlightedAppointmentId = result.data
                        )
                    }
                    _snackBarMessages.emit("Turno agendado correctamente.")
                }
                is ApiResult.Error -> {
                    val msg = result.message
                    _uiState.update {
                        it.copy(isSubmittingAction = false, dialogError = msg)
                    }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update {
                        it.copy(
                            isSubmittingAction = false,
                            dialogError = "Fallo de conexión. No se confirmó el turno."
                        )
                    }
                }
            }
        }
    }

    fun rescheduleAppointment(appointmentId: String, newDateKey: String, newTime: String) {
        val bizId = _uiState.value.activeBusinessId
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, dialogError = null) }
            val result = rescheduleAppointmentUseCase(appointmentId, newDateKey, newTime, bizId)
            when (result) {
                is ApiResult.Success -> {
                    refreshAgendaInUi(newDateKey, bizId)
                    refreshDashboard()
                    loadBusinessProfile(bizId)
                    _uiState.update {
                        it.copy(
                            isSubmittingAction = false,
                            isRescheduleDialogOpen = false,
                            highlightedAppointmentId = appointmentId
                        )
                    }
                    _snackBarMessages.emit("Turno reprogramado a las $newTime ($newDateKey).")
                }
                is ApiResult.Error -> {
                    val msg = result.message
                    _uiState.update {
                        it.copy(isSubmittingAction = false, dialogError = msg)
                    }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update {
                        it.copy(
                            isSubmittingAction = false,
                            dialogError = "Fallo de conexión. No se completó la reprogramación."
                        )
                    }
                }
            }
        }
    }

    fun updateStatus(appointment: Appointment, newStatus: AppointmentStatus) {
        val bizId = _uiState.value.activeBusinessId
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true) }
            val result = updateAppointmentStatusUseCase(
                appointmentId = appointment.id,
                dateKey = appointment.dateKey,
                newStatus = newStatus,
                businessId = bizId
            )
            when (result) {
                is ApiResult.Success -> {
                    refreshAgendaInUi(_uiState.value.dateKey, bizId)
                    refreshDashboard()
                    loadBusinessProfile(bizId)
                    _uiState.update { it.copy(isSubmittingAction = false) }
                    _snackBarMessages.emit("Turno marcado como ${newStatus.label}.")
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isSubmittingAction = false) }
                    _snackBarMessages.emit("No permitido: ${result.message}")
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isSubmittingAction = false) }
                    _snackBarMessages.emit("Sin conexión para actualizar estado.")
                }
            }
        }
    }

    // Gestión de Servicios Pro
    fun openServiceDialog(service: ServiceItem? = null) {
        _uiState.update {
            it.copy(
                isServiceDialogOpen = true,
                serviceToEdit = service,
                dialogError = null
            )
        }
    }

    fun closeServiceDialog() {
        _uiState.update {
            it.copy(
                isServiceDialogOpen = false,
                serviceToEdit = null,
                dialogError = null
            )
        }
    }

    fun openServiceAvailabilityDialog(service: ServiceItem) {
        _uiState.update {
            it.copy(
                isServiceAvailabilityDialogOpen = true,
                serviceForAvailability = service
            )
        }
    }

    fun closeServiceAvailabilityDialog() {
        _uiState.update {
            it.copy(
                isServiceAvailabilityDialogOpen = false,
                serviceForAvailability = null,
                isSubmittingAction = false,
                dialogError = null
            )
        }
    }

    fun saveServiceAvailability(
        serviceId: String,
        workingHours: Map<Int, DaySchedule>,
        unavailableDates: List<String>
    ) {
        if (_uiState.value.isSubmittingAction) return
        val currentService = _uiState.value.services.firstOrNull { it.id == serviceId } ?: return
        val bizId = _uiState.value.activeBusinessId
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, dialogError = null) }
            when (val res = agendaRepository.saveService(
                name = currentService.name,
                durationMinutes = currentService.durationMinutes,
                price = currentService.price,
                status = currentService.status,
                serviceId = currentService.id,
                category = currentService.category,
                photoUrl = currentService.photoUrl,
                bookingBufferMinutes = currentService.bookingBufferMinutes,
                workingHours = workingHours,
                unavailableDates = unavailableDates,
                businessId = bizId
            )) {
                is ApiResult.Success -> {
                    if (_uiState.value.activeBusinessId == bizId) {
                        closeServiceAvailabilityDialog()
                        loadServices(bizId)
                        _snackBarMessages.emit("Disponibilidad de '${res.data.name}' actualizada.")
                    }
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isSubmittingAction = false, dialogError = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, dialogError = "Sin conexión al guardar disponibilidad.") }
                }
            }
        }
    }

    fun saveService(
        name: String,
        durationMinutes: Int,
        price: Double,
        status: String,
        category: String = "General",
        photoUrl: String? = null,
        bookingBufferMinutes: Int? = null,
        workingHours: Map<Int, DaySchedule> = emptyMap(),
        unavailableDates: List<String> = emptyList()
    ) {
        if (_uiState.value.isSubmittingAction) return
        val bizId = _uiState.value.activeBusinessId
        val editingService = _uiState.value.serviceToEdit
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, dialogError = null) }
            val finalWorkingHours = if (workingHours.isNotEmpty()) workingHours else (editingService?.workingHours ?: emptyMap())
            val finalUnavailable = if (unavailableDates.isNotEmpty()) unavailableDates else (editingService?.unavailableDates ?: emptyList())

            when (val res = agendaRepository.saveService(
                name = name,
                durationMinutes = durationMinutes,
                price = price,
                status = status,
                serviceId = editingService?.id,
                category = category,
                photoUrl = photoUrl ?: editingService?.photoUrl,
                bookingBufferMinutes = bookingBufferMinutes,
                workingHours = finalWorkingHours,
                unavailableDates = finalUnavailable,
                businessId = bizId
            )) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(isSubmittingAction = false, isServiceDialogOpen = false, serviceToEdit = null) }
                    loadServices(bizId)
                    _snackBarMessages.emit("Servicio '${res.data.name}' guardado.")
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isSubmittingAction = false, dialogError = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, dialogError = "Sin conexión al guardar servicio.") }
                }
            }
        }
    }

    fun toggleServiceStatus(service: ServiceItem) {
        val nextStatus = if (service.isActive) "Pausado" else "Activo"
        val bizId = _uiState.value.activeBusinessId
        viewModelScope.launch {
            when (agendaRepository.saveService(
                name = service.name,
                durationMinutes = service.durationMinutes,
                price = service.price,
                status = nextStatus,
                serviceId = service.id,
                category = service.category,
                photoUrl = service.photoUrl,
                bookingBufferMinutes = service.bookingBufferMinutes,
                workingHours = service.workingHours,
                unavailableDates = service.unavailableDates,
                businessId = bizId
            )) {
                is ApiResult.Success -> {
                    loadServices(bizId)
                    _snackBarMessages.emit("${service.name}: $nextStatus")
                }
                else -> {
                    _snackBarMessages.emit("No se pudo cambiar el estado del servicio.")
                }
            }
        }
    }

    fun deleteService(service: ServiceItem) {
        val bizId = _uiState.value.activeBusinessId
        viewModelScope.launch {
            when (val result = agendaRepository.deleteService(service.id, bizId)) {
                is ApiResult.Success -> {
                    loadServices(bizId)
                    _snackBarMessages.emit("Servicio eliminado.")
                }
                is ApiResult.Error -> {
                    _snackBarMessages.emit(
                        result.message.ifBlank { "No se pudo eliminar el servicio." }
                    )
                }
                is ApiResult.NetworkError -> {
                    _snackBarMessages.emit("Sin conexión: el servicio no fue eliminado.")
                }
            }
        }
    }

    // Gestión de Clientes CRM
    fun openClientDialog() {
        _uiState.update { it.copy(isClientDialogOpen = true, dialogError = null) }
    }

    fun closeClientDialog() {
        _uiState.update { it.copy(isClientDialogOpen = false, dialogError = null) }
    }

    fun openClientDetail(client: ClientItem) {
        _uiState.update { it.copy(isClientDetailDialogOpen = true, selectedClient = client, dialogError = null, isSubmittingAction = false) }
    }

    fun closeClientDetail() {
        _uiState.update { it.copy(isClientDetailDialogOpen = false, selectedClient = null, dialogError = null, isSubmittingAction = false) }
    }

    fun createClient(name: String, phone: String, email: String, notes: String, avatarUrl: String? = null) {
        if (_uiState.value.isSubmittingAction) return
        val bizId = _uiState.value.activeBusinessId
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, dialogError = null) }
            when (val res = agendaRepository.createClient(name, phone, email, notes, avatarUrl, bizId)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(isSubmittingAction = false, isClientDialogOpen = false) }
                    loadClients(bizId)
                    _snackBarMessages.emit("Cliente '${res.data.name}' registrado.")
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isSubmittingAction = false, dialogError = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, dialogError = "Sin conexión al registrar cliente.") }
                }
            }
        }
    }

    fun updateClient(client: ClientItem) {
        if (_uiState.value.isSubmittingAction) return
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, dialogError = null) }
            when (val res = agendaRepository.updateClient(client)) {
                is ApiResult.Success -> {
                    closeClientDetail()
                    loadClients()
                    _snackBarMessages.emit("Cliente '${res.data.name}' actualizado.")
                }
                is ApiResult.Error -> {
                    _uiState.update { it.copy(isSubmittingAction = false, dialogError = res.message) }
                }
                is ApiResult.NetworkError -> {
                    _uiState.update { it.copy(isSubmittingAction = false, dialogError = "Sin conexión al actualizar el cliente.") }
                }
            }
        }
    }

    fun deleteClient(client: ClientItem) {
        viewModelScope.launch {
            when (agendaRepository.deleteClient(client.id)) {
                is ApiResult.Success -> {
                    closeClientDetail()
                    loadClients()
                    _snackBarMessages.emit("Cliente eliminado.")
                }
                is ApiResult.Error -> _snackBarMessages.emit("No se pudo eliminar el cliente.")
                is ApiResult.NetworkError -> _snackBarMessages.emit("Sin conexión: el cliente no fue eliminado.")
            }
        }
    }

    // Mi Negocio y Editor de Página Pública
    fun openSubscriptionDialog() {
        _uiState.update { it.copy(isSubscriptionDialogOpen = true) }
        refreshBilling()
    }

    fun closeSubscriptionDialog() {
        _uiState.update { it.copy(isSubscriptionDialogOpen = false) }
    }

    fun openEditBusinessProfile() {
        _uiState.update { it.copy(isEditBusinessProfileOpen = true, dialogError = null) }
    }

    fun closeEditBusinessProfile() {
        _uiState.update { it.copy(isEditBusinessProfileOpen = false, dialogError = null) }
    }

    fun checkSlug(slug: String) {
        if (slug.trim().length < 3) {
            _uiState.update { it.copy(isSlugAvailable = null, isCheckingSlug = false) }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isCheckingSlug = true) }
            when (val res = agendaRepository.checkSlugAvailability(slug, _uiState.value.activeBusinessId)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(isSlugAvailable = res.data, isCheckingSlug = false) }
                }
                else -> {
                    _uiState.update { it.copy(isCheckingSlug = false) }
                }
            }
        }
    }

    fun saveFullBusinessProfile(profile: BusinessProfile, logoUri: android.net.Uri? = null) {
        if (_uiState.value.isSubmittingAction) return
        val ownerId = _uiState.value.activeBusinessId
        if (ownerId.isBlank() || profile.id != ownerId) return
        _uiState.update { it.copy(isSubmittingAction = true, dialogError = null) }
        viewModelScope.launch {
            val updatedProfile = if (logoUri != null) {
                val uploaded = imageRepository?.upload(logoUri, ImageCategory.LOGO)
                val url = uploaded?.getOrNull()
                if (url == null) {
                    if (_uiState.value.activeBusinessId == ownerId) _uiState.update {
                        it.copy(isSubmittingAction = false, dialogError = "No se pudo subir el logo. Revisá la conexión y volvé a guardar.")
                    }
                    return@launch
                }
                profile.copy(logoUrl = url)
            } else profile
            if (_uiState.value.activeBusinessId != ownerId) return@launch
            when (val res = agendaRepository.updateFullBusinessProfile(updatedProfile)) {
                is ApiResult.Success -> {
                    _uiState.update {
                        it.copy(
                            businessProfile = res.data,
                            isSubmittingAction = false,
                            dialogError = null,
                            isEditBusinessProfileOpen = false
                        )
                    }
                    _snackBarMessages.emit("Perfil del negocio actualizado.")
                }
                is ApiResult.Error -> _uiState.update { it.copy(isSubmittingAction = false, dialogError = res.message) }
                is ApiResult.NetworkError -> _uiState.update { it.copy(isSubmittingAction = false, dialogError = "Sin conexión. No se pudo guardar el perfil; volvé a intentar.") }
            }
        }
    }

    fun updateBusinessSettings(
        leadTimeMinutes: Int,
        horizonDays: Int,
        bufferMinutes: Int,
        autoConfirm: Boolean
    ) {
        val bizId = _uiState.value.activeBusinessId
        viewModelScope.launch {
            when (val res = agendaRepository.updateBusinessSettings(leadTimeMinutes, horizonDays, bufferMinutes, autoConfirm, bizId)) {
                is ApiResult.Success -> {
                    _uiState.update { it.copy(businessProfile = res.data) }
                    _snackBarMessages.emit("Reglas operativas actualizadas.")
                }
                else -> {
                    _snackBarMessages.emit("No se pudieron actualizar las reglas.")
                }
            }
        }
    }

    fun saveOwnerSettings(rules: BookingRules) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true, dialogError = null) }
            when (val result = agendaRepository.updateOwnerSettings(rules)) {
                is ApiResult.Success -> {
                    _uiState.update { state -> state.copy(businessProfile = state.businessProfile.copy(bookingRules = result.data), isSubmittingAction = false) }
                    _snackBarMessages.emit("Ajustes operativos actualizados.")
                }
                is ApiResult.Error -> _uiState.update { it.copy(isSubmittingAction = false, dialogError = result.message) }
                is ApiResult.NetworkError -> _uiState.update { it.copy(isSubmittingAction = false, dialogError = "Sin conexión para actualizar los ajustes.") }
            }
        }
    }

    /** Refresh server-owned data on return, preserving the selected day and open drafts. */
    fun onWorkspaceResumed() {
        refreshMercadoPagoStatus()
        refreshBilling()
        // An already bootstrapped workspace may have been retained across a month
        // boundary or web changes. Billing/dashboard refreshes do not update its
        // profile quota or agenda. Initial bootstrap still owns first loading.
        if (_uiState.value.businessProfile.id.isNotBlank()) {
            loadBusinessProfile()
            loadAgenda()
        }
        loadDashboard()
    }

    /** Called when this owner's composition leaves. No collector or in-flight request may update another account. */
    fun clearForSessionChange() {
        agendaExport.clear()
        clientsExport.clear()
        agendaRequestGeneration.incrementAndGet()
        availabilityRequestGeneration.incrementAndGet()
        dashboardRequestGeneration.incrementAndGet()
        clientHistoryRequestGeneration.incrementAndGet()
        _clientHistoryUiState.value = ClientHistoryUiState()
        claimedPurchaseTokens.clear()
        viewModelScope.coroutineContext.cancelChildren()
    }

    fun rotateFcmToken() {
        val pushRepo = pushRepository ?: return
        viewModelScope.launch {
            when (val res = pushRepo.ensureRegistered()) {
                is ApiResult.Success -> {
                    _snackBarMessages.emit("Registro de notificaciones actualizado.")
                }
                else -> {
                    _snackBarMessages.emit("No se pudo registrar este dispositivo para notificaciones.")
                }
            }
        }
    }

    fun openDeleteAccountDialog() {
        // A freshly initiated deletion request may perform one new reauth flow.
        // The retry guard applies only to the request already in progress.
        pendingDeletionReason = null
        deletionRetryUsed = false
        _uiState.update { it.copy(isDeleteAccountDialogOpen = true, dialogError = null) }
    }

    fun closeDeleteAccountDialog() {
        _uiState.update { it.copy(isDeleteAccountDialogOpen = false, dialogError = null) }
    }

    fun requestAccountDeletion(reason: String) {
        submitDeletionRequest(reason, mayRequestReauthentication = true)
    }

    private fun submitDeletionRequest(reason: String, mayRequestReauthentication: Boolean) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingAction = true) }
            when (val res = agendaRepository.requestAccountDeletion(reason)) {
                is ApiResult.Success -> {
                    pendingDeletionReason = null
                    deletionRetryUsed = false
                    _uiState.value = AgendaUiState(lastDeletionTicket = res.data)
                    _billingUiState.value = BillingUiState()
                    _availabilityUiState.value = AvailabilityUiState()
                    _mercadoPagoUiState.value = MercadoPagoUiState()
                    _dashboardUiState.value = DashboardUiState()
                    _reauthUiState.value = ReauthenticationUiState()
                    // Also cancels this completed request. No suspended work follows:
                    // old collectors must not refill the erased workspace.
                    clearForSessionChange()
                }
                else -> {
                    _uiState.update { it.copy(isSubmittingAction = false) }
                    val error = res as? ApiResult.Error
                    if (mayRequestReauthentication && !deletionRetryUsed && error?.isReauthenticationRequired() == true) {
                        pendingDeletionReason = reason
                        openDeletionReauthentication()
                    } else {
                        _snackBarMessages.emit(error?.message ?: "No se pudo procesar la solicitud.")
                    }
                }
            }
        }
    }

    private fun ApiResult.Error.isReauthenticationRequired(): Boolean =
        code == 403 && (message.contains("Recent sign-in", ignoreCase = true) || message.contains("REAUTH_REQUIRED", ignoreCase = true))

    private fun openDeletionReauthentication() {
        val capabilities = authRepository?.reauthenticationCapabilities()
        if (capabilities == null || (!capabilities.supportsPassword && !capabilities.supportsGoogle)) {
            _snackBarMessages.tryEmit("No hay un método disponible para confirmar tu identidad en esta cuenta.")
            return
        }
        _uiState.update { it.copy(isDeleteAccountDialogOpen = false) }
        _reauthUiState.value = ReauthenticationUiState(
            isOpen = true,
            email = capabilities.email,
            allowPassword = capabilities.supportsPassword,
            allowGoogle = capabilities.supportsGoogle
        )
    }

    fun submitDeletionReauthPassword(password: String) {
        val auth = authRepository ?: return
        performDeletionReauthentication { auth.reauthenticateWithPassword(password) }
    }

    fun submitDeletionReauthGoogle(idToken: String) {
        val auth = authRepository ?: return
        performDeletionReauthentication { auth.reauthenticateWithGoogleIdToken(idToken) }
    }

    private fun performDeletionReauthentication(action: suspend () -> Result<Unit>) {
        val reason = pendingDeletionReason ?: return
        viewModelScope.launch {
            _reauthUiState.update { it.copy(isLoading = true, error = null) }
            action().fold(
                onSuccess = {
                    deletionRetryUsed = true
                    _reauthUiState.value = ReauthenticationUiState()
                    submitDeletionRequest(reason, mayRequestReauthentication = false)
                },
                onFailure = { error ->
                    _reauthUiState.update {
                        it.copy(isLoading = false, error = error.message ?: "No se pudo confirmar tu identidad.")
                    }
                }
            )
        }
    }

    fun dismissDeletionReauth() {
        if (_reauthUiState.value.isLoading) return
        pendingDeletionReason = null
        deletionRetryUsed = false
        _reauthUiState.value = ReauthenticationUiState()
    }

    /** Keeps credential-provider failures inside the reauthentication surface.
     *  The password remains owned by the composable and is never added to state. */
    fun showDeletionReauthError(message: String) {
        if (_reauthUiState.value.isOpen && !_reauthUiState.value.isLoading) {
            _reauthUiState.update { it.copy(error = message) }
        }
    }
}
