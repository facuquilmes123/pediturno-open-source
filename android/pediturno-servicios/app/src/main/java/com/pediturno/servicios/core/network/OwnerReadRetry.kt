package com.pediturno.servicios.core.network

import java.io.IOException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response

/** Only retry explicit server throttling of reads. Never replay a mutation or an ambiguous IO failure. */
internal suspend fun executeOwnerRead(
    client: OkHttpClient,
    request: Request,
    ownerIsCurrent: () -> Boolean,
    wait: suspend (Long) -> Unit = { delay(it) }
): Response {
    var retries = 0
    var waitedSeconds = 0L
    while (true) {
        currentCoroutineContext().ensureActive()
        if (!ownerIsCurrent()) throw IOException("La sesión cambió. Volvé a cargar desde la cuenta actual.")
        val response = client.newCall(request).execute()
        try {
            currentCoroutineContext().ensureActive()
            if (!ownerIsCurrent()) throw IOException("La sesión cambió. Volvé a cargar desde la cuenta actual.")
        } catch (failure: Throwable) {
            response.close()
            throw failure
        }
        val seconds = response.header("Retry-After")?.trim()?.toLongOrNull()
        if (request.method != "GET" || request.url.encodedPath.contains("/mercadopago") ||
            response.code != 429 || retries >= 2 || seconds == null || seconds !in 1..60 ||
            waitedSeconds + seconds > 60) return response
        response.close()
        retries++
        waitedSeconds += seconds
        wait(seconds * 1000)
    }
}
