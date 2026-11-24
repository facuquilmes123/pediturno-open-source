package com.pediturno.servicios.data.repository

import android.app.Activity
import android.content.Context
import android.util.Log
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.PurchasesUpdatedListener
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import com.pediturno.servicios.core.network.ApiResult
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.launch

sealed interface BillingEvent {
    data class Pending(val count: Int) : BillingEvent
    data object Cancelled : BillingEvent
    data object NoPurchases : BillingEvent
    data class Error(val code: Int, val message: String) : BillingEvent
}

/** Google supplies purchase UI and regional prices; only the backend grants membership. */
class GooglePlayBillingRepository(context: Context) : PurchasesUpdatedListener {
    companion object { const val PRODUCT_ID = "pediturno_servicios_pro_monthly" }
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val client = BillingClient.newBuilder(context.applicationContext)
        .setListener(this)
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()
    // Replay protects a purchase arriving before the recreated UI subscribes.
    // queryPurchases on resume is the durable source of purchases missed during process death.
    private val _purchases = MutableSharedFlow<Purchase>(replay = 16, extraBufferCapacity = 64)
    val purchases: SharedFlow<Purchase> = _purchases
    private val _events = MutableSharedFlow<BillingEvent>(extraBufferCapacity = 16)
    val events: SharedFlow<BillingEvent> = _events
    private var connecting = false
    private val connectionCallbacks = mutableListOf<(BillingResult) -> Unit>()

    private fun friendlyError(code: Int): String = when (code) {
        BillingClient.BillingResponseCode.SERVICE_DISCONNECTED,
        BillingClient.BillingResponseCode.SERVICE_UNAVAILABLE,
        BillingClient.BillingResponseCode.NETWORK_ERROR -> "No se pudo conectar con Google Play. Reintentá cuando tengas conexión."
        BillingClient.BillingResponseCode.BILLING_UNAVAILABLE -> "Las compras de Google Play no están disponibles en este dispositivo o cuenta."
        BillingClient.BillingResponseCode.ITEM_ALREADY_OWNED -> "Ya tenés una compra en Google Play. Usá Restaurar compras."
        BillingClient.BillingResponseCode.ITEM_UNAVAILABLE -> "La membresía no está disponible para esta cuenta de Google Play."
        else -> "Google Play no pudo completar la operación. Podés reintentar."
    }

    fun connect(onResult: (BillingResult) -> Unit) {
        scope.launch {
            if (client.isReady) {
                onResult(BillingResult.newBuilder().setResponseCode(BillingClient.BillingResponseCode.OK).build())
                return@launch
            }
            connectionCallbacks.add(onResult)
            if (connecting) return@launch
            connecting = true
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    scope.launch {
                        connecting = false
                        val callbacks = connectionCallbacks.toList()
                        connectionCallbacks.clear()
                        callbacks.forEach { it(result) }
                    }
                }
                // AutoServiceReconnection handles subsequent calls.
                override fun onBillingServiceDisconnected() {
                    scope.launch { _events.emit(BillingEvent.Error(BillingClient.BillingResponseCode.SERVICE_DISCONNECTED, friendlyError(BillingClient.BillingResponseCode.SERVICE_DISCONNECTED))) }
                }
            })
        }
    }

    fun queryProduct(onResult: (ApiResult<ProductDetails>) -> Unit) {
        connect { connection ->
            if (connection.responseCode != BillingClient.BillingResponseCode.OK) {
                onResult(ApiResult.Error(connection.responseCode, friendlyError(connection.responseCode)))
                return@connect
            }
            val product = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(PRODUCT_ID).setProductType(BillingClient.ProductType.SUBS).build()
            client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(listOf(product)).build()) { result, queryResult ->
                val details = queryResult.productDetailsList.singleOrNull { it.productId == PRODUCT_ID }
                when {
                    result.responseCode != BillingClient.BillingResponseCode.OK -> onResult(ApiResult.Error(result.responseCode, friendlyError(result.responseCode)))
                    details == null -> {
                        // Numeric availability diagnostics only. Never log purchase data or offer tokens.
                        val unfetched = queryResult.unfetchedProductList.singleOrNull { it.productId == PRODUCT_ID }?.statusCode
                        Log.w("PediturnoBilling", "product_details_missing response=${result.responseCode} unfetched=${unfetched ?: -1}")
                        onResult(ApiResult.Error(404, "La membresía no está disponible para esta cuenta de Play."))
                    }
                    else -> onResult(ApiResult.Success(details))
                }
            }
        }
    }

    data class PurchaseAuthorization(
        val purchaseAllowed: Boolean,
        val obfuscatedAccountId: String?,
        val reason: String? = null,
        val eligibleAt: String? = null,
        val basePlanId: String? = null
    )

    fun offerPresentation(details: ProductDetails, basePlanId: String? = null): MonthlySubscriptionOffer? =
        selectMonthlySubscriptionOffer(details.subscriptionOfferDetails.orEmpty().map { offer ->
            SubscriptionOfferCandidate(offer.basePlanId, offer.offerId, offer.offerToken,
                offer.pricingPhases.pricingPhaseList.map { phase ->
                    SubscriptionPricePhase(phase.formattedPrice, phase.billingPeriod, phase.recurrenceMode, phase.priceAmountMicros)
                })
        }, basePlanId)

    fun launchSubscription(activity: Activity, details: ProductDetails, authorization: PurchaseAuthorization): ApiResult<Unit> {
        if (!authorization.purchaseAllowed) return ApiResult.Error(403, authorization.reason ?: "Tu cuenta ya tiene acceso vigente o todavía no puede iniciar otra compra.")
        val obfuscatedAccountId = authorization.obfuscatedAccountId.orEmpty()
        val basePlanId = authorization.basePlanId?.takeIf { it.isNotBlank() }
            ?: return ApiResult.Error(503, "El plan mensual todavía no está disponible. No se inició ningún cobro.")
        val offer = offerPresentation(details, basePlanId)
            ?: return ApiResult.Error(422, "No hay un plan mensual elegible de Google Play para esta cuenta.")
        if (obfuscatedAccountId.isBlank()) return ApiResult.Error(400, "No se pudo vincular la compra a tu cuenta.")
        if (!client.isReady) return ApiResult.Error(BillingClient.BillingResponseCode.SERVICE_DISCONNECTED, friendlyError(BillingClient.BillingResponseCode.SERVICE_DISCONNECTED))
        val product = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details).setOfferToken(offer.offerToken).build()
        val params = BillingFlowParams.newBuilder().setProductDetailsParamsList(listOf(product)).setObfuscatedAccountId(obfuscatedAccountId).build()
        val result = client.launchBillingFlow(activity, params)
        return if (result.responseCode == BillingClient.BillingResponseCode.OK) ApiResult.Success(Unit)
        else ApiResult.Error(result.responseCode, friendlyError(result.responseCode))
    }

    private fun publishPurchases(purchases: List<Purchase>, restored: Boolean = false) {
        scope.launch {
            val pending = purchases.count { it.purchaseState == Purchase.PurchaseState.PENDING }
            if (pending > 0) _events.emit(BillingEvent.Pending(pending))
            purchases.filter { it.purchaseState == Purchase.PurchaseState.PURCHASED && PRODUCT_ID in it.products }
                .forEach { _purchases.emit(it) }
            if (restored && purchases.isEmpty()) _events.emit(BillingEvent.NoPurchases)
        }
    }

    override fun onPurchasesUpdated(result: BillingResult, purchases: MutableList<Purchase>?) {
        when (result.responseCode) {
            BillingClient.BillingResponseCode.OK -> publishPurchases(purchases.orEmpty())
            BillingClient.BillingResponseCode.USER_CANCELED -> scope.launch { _events.emit(BillingEvent.Cancelled) }
            else -> scope.launch { _events.emit(BillingEvent.Error(result.responseCode, friendlyError(result.responseCode))) }
        }
    }

    /** Restoring is independent of eligibility for a new purchase. */
    fun restorePurchases(onResult: (ApiResult<Int>) -> Unit = {}) {
        connect { connection ->
            if (connection.responseCode != BillingClient.BillingResponseCode.OK) {
                onResult(ApiResult.Error(connection.responseCode, friendlyError(connection.responseCode)))
                return@connect
            }
            client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.SUBS).build()) { result, purchases ->
                if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                    val relevant = purchases.filter { PRODUCT_ID in it.products }
                    publishPurchases(relevant, restored = true)
                    onResult(ApiResult.Success(relevant.size))
                } else onResult(ApiResult.Error(result.responseCode, friendlyError(result.responseCode)))
            }
        }
    }

    fun close() = client.endConnection()
}
