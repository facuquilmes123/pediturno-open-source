package com.pediturno.servicios.core.network

import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

data class RequestOwner(val uid: String?)

class AuthInterceptor(
    private val tokenProvider: () -> String?,
    private val appCheckTokenProvider: () -> String? = { null },
    private val ownerProvider: (() -> String?)? = null
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val original = chain.request()
        val expectedOwner = original.tag(RequestOwner::class.java)
        if (expectedOwner != null && (expectedOwner.uid.isNullOrBlank() || expectedOwner.uid != ownerProvider?.invoke())) throw IOException("La sesión cambió. Reintentá desde la cuenta actual.")
        val token = tokenProvider()
        if (expectedOwner != null && expectedOwner.uid != ownerProvider?.invoke()) throw IOException("La sesión cambió. Reintentá desde la cuenta actual.")

        val builder = original.newBuilder()
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")

        if (!token.isNullOrBlank()) {
            builder.header("Authorization", "Bearer $token")
        }
        // Explicit limited-use attestations belong to this mutation only; a
        // cached token must not replace them before the server consumes them.
        appCheckTokenProvider()?.takeIf { it.isNotBlank() && original.header("X-Firebase-AppCheck") == null }?.let {
            builder.header("X-Firebase-AppCheck", it)
        }

        return chain.proceed(builder.build())
    }
}
