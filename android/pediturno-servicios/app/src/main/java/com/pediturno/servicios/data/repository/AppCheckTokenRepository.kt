package com.pediturno.servicios.data.repository

import com.google.firebase.appcheck.FirebaseAppCheck
import kotlinx.coroutines.tasks.await
import java.util.concurrent.atomic.AtomicReference

/**
 * Keeps the short-lived App Check token outside persistence.  The API client can
 * add the last attestation without blocking an OkHttp interceptor; sensitive
 * bootstrap operations explicitly refresh it before sending a request.
 */
class AppCheckTokenRepository {
    private val token = AtomicReference<String?>(null)

    fun currentToken(): String? = token.get()

    suspend fun refresh(): String? = runCatching {
        FirebaseAppCheck.getInstance().getAppCheckToken(false).await().token
    }.getOrNull()?.also(token::set)

    /** One-time token for endpoints that validate with consume=true. Never cache it. */
    suspend fun limitedUseToken(): String? = runCatching {
        FirebaseAppCheck.getInstance().getLimitedUseAppCheckToken().await().token
    }.getOrNull()
}
