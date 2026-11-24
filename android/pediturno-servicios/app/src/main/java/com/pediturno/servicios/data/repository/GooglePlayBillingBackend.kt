package com.pediturno.servicios.data.repository

import com.pediturno.servicios.core.network.ApiResult
import java.io.IOException
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody

/** Server contract for the Play purchase gate and token verification. Client data never grants access by itself. */
class GooglePlayBillingBackend(private val baseUrl: String, private val tokenProvider: () -> String?, private val client: OkHttpClient = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(15, TimeUnit.SECONDS).callTimeout(20, TimeUnit.SECONDS).build()) {
    private val json = Json { ignoreUnknownKeys = true }
    @Serializable private data class AccountResponse(val purchaseAllowed: Boolean, val obfuscatedAccountId: String? = null, val reason: String? = null, val eligibleAt: String? = null, val basePlanId: String? = null)
    @Serializable private data class VerifyRequest(val productId: String, val purchaseToken: String, val packageName: String)
    @Serializable data class Entitlement(val plan: String = "none", val status: String = "none", val expiresAt: String? = null, val autoRenewing: Boolean = false, val source: String = "none", val acknowledgement: String = "not_applicable")
    @Serializable data class VerifyResponse(val verified: Boolean, val entitlement: Entitlement? = null, val message: String? = null)
    private fun request(url: String, method: String = "GET", body: String? = null): Request.Builder = Request.Builder().url(url).header("Accept", "application/json").header("Authorization", "Bearer ${tokenProvider().orEmpty()}").let { builder -> when (method) { "POST" -> builder.post((body ?: "{}").toRequestBody("application/json".toMediaType())); else -> builder.get() } }
    suspend fun account(): ApiResult<GooglePlayBillingRepository.PurchaseAuthorization> = withContext(Dispatchers.IO) { execute("google-play/account", "POST") { body -> val dto = json.decodeFromString<AccountResponse>(body); GooglePlayBillingRepository.PurchaseAuthorization(dto.purchaseAllowed, dto.obfuscatedAccountId, dto.reason, dto.eligibleAt, dto.basePlanId) } }
    suspend fun status(): ApiResult<Entitlement> = withContext(Dispatchers.IO) { execute("google-play/status") { body -> json.decodeFromString<StatusResponse>(body).entitlement ?: Entitlement() } }
    suspend fun verify(purchaseToken: String, packageName: String): ApiResult<VerifyResponse> = withContext(Dispatchers.IO) { val body = json.encodeToString(VerifyRequest(GooglePlayBillingRepository.PRODUCT_ID, purchaseToken, packageName)); execute("google-play/verify", "POST", body) { json.decodeFromString<VerifyResponse>(it) } }
    @Serializable private data class StatusResponse(val entitlement: Entitlement? = null)
    private fun <T> execute(path: String, method: String = "GET", body: String? = null, decode: (String) -> T): ApiResult<T> = try {
        client.newCall(request("${baseUrl.trimEnd('/')}/$path", method, body).build()).execute().use { response ->
            val text = response.body?.string().orEmpty()
            if (response.isSuccessful) ApiResult.Success(decode(text)) else {
                // Provider text is not a UI contract: keep account errors localized and private.
                val message = when (response.code) {
                    401 -> "Tu sesión venció. Volvé a ingresar a Pediturno."
                    403, 409 -> "No pudimos verificar esta compra con la cuenta actual. Usá la cuenta de Pediturno con la que la realizaste."
                    429 -> "Esperá unos minutos y volvé a verificar tu compra."
                    else -> "No pudimos verificar tu membresía. Volvé a intentar."
                }
                ApiResult.Error(response.code, message)
            }
        }
    } catch (error: CancellationException) { throw error }
      catch (error: IOException) { ApiResult.NetworkError(error) }
      catch (_: Exception) { ApiResult.Error(502, "No se pudo verificar tu membresía. Volvé a intentar.") }
}
