package com.pediturno.servicios.ui.auth

import android.content.Context
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.pediturno.servicios.R
import kotlinx.coroutines.CancellationException

class GoogleCredentialManager(private val context: Context) {
    suspend fun requestIdToken(): Result<String> {
        val serverClientId = context.getString(R.string.google_server_client_id).trim()
        if (serverClientId.isBlank()) return Result.failure(IllegalStateException("Google Sign-In requiere el OAuth Web client ID autorizado."))
        val manager = CredentialManager.create(context)
        return try {
            val option = GetGoogleIdOption.Builder().setServerClientId(serverClientId)
                .setFilterByAuthorizedAccounts(false).setAutoSelectEnabled(false).build()
            val response = manager.getCredential(context, GetCredentialRequest.Builder().addCredentialOption(option).build())
            Result.success(GoogleIdTokenCredential.createFrom(response.credential.data).idToken)
        } catch (_: NoCredentialException) {
            // Explicit button fallback for devices without a credential selected by the generic request.
            try {
                val fallback = GetSignInWithGoogleOption.Builder(serverClientId).build()
                val response = manager.getCredential(context, GetCredentialRequest.Builder().addCredentialOption(fallback).build())
                Result.success(GoogleIdTokenCredential.createFrom(response.credential.data).idToken)
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (error: GetCredentialException) {
                Result.failure(IllegalStateException("No se pudo abrir Google Sign-In. Revisá tu cuenta de Google y reintentá.", error))
            } catch (error: Exception) {
                Result.failure(error)
            }
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: GetCredentialException) {
            Result.failure(IllegalStateException("No se pudo iniciar Google Sign-In. Reintentá.", error))
        } catch (error: Exception) {
            Result.failure(error)
        }
    }
}
