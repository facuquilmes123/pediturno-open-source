package com.pediturno.servicios.data.repository

import android.content.Context
import android.net.Uri
import androidx.browser.customtabs.CustomTabsIntent

/** Opens the server-issued one-time OAuth URL. No OAuth state, PKCE verifier or token is held in the APK. */
object MercadoPagoHandoff {
    fun open(context: Context, issuedUrl: String): Result<Unit> = runCatching {
        val uri = Uri.parse(issuedUrl)
        require(uri.scheme == "https" && uri.host == "pediturno.com") { "URL de conexión no confiable." }
        CustomTabsIntent.Builder().build().launchUrl(context, uri)
    }
}
