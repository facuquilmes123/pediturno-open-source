package com.pediturno.servicios.data.repository

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.EmailAuthProvider
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.UserProfileChangeRequest
import com.pediturno.servicios.BuildConfig
import com.pediturno.servicios.data.model.UserSession
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.tasks.await
import java.util.concurrent.atomic.AtomicLong

/** Firebase Auth is the source of truth. No credentials or demo session are stored locally. */
class AuthRepository(
    context: Context,
    useFirebaseEmulator: Boolean = false,
    firebaseEmulatorHost: String = BuildConfig.FIREBASE_EMULATOR_HOST
) {
    private val validatedEmulatorHost = validatedFirebaseEmulatorHost(useFirebaseEmulator, firebaseEmulatorHost)
    private val firebaseReady = FirebaseApp.initializeApp(context.applicationContext) != null
    private val auth: FirebaseAuth? = if (firebaseReady) FirebaseAuth.getInstance().also { auth ->
        if (useFirebaseEmulator) {
            val host = requireNotNull(validatedEmulatorHost) {
                "Firebase emulator host is not allowed for this debug build."
            }
            auth.useEmulator(host, 9099)
        }
    } else null
    private val sessionEpoch = AtomicLong(0)
    private val sessionLock = Any()
    private val _session = MutableStateFlow(UserSession())
    val session: StateFlow<UserSession> = _session.asStateFlow()

    init {
        auth?.addAuthStateListener { firebaseAuth ->
            firebaseAuth.currentUser?.let(::updateSession) ?: run { _session.value = UserSession() }
        }
        auth?.addIdTokenListener(FirebaseAuth.IdTokenListener { firebaseAuth ->
            firebaseAuth.currentUser?.let(::updateSession)
        })
        auth?.currentUser?.let(::updateSession)
    }

    val isConfigured: Boolean get() = auth != null

    data class ReauthenticationCapabilities(
        val email: String,
        val supportsPassword: Boolean,
        val supportsGoogle: Boolean
    )

    private fun updateSession(user: FirebaseUser) {
        val epoch = sessionEpoch.get()
        if (auth?.currentUser?.uid != user.uid) return
        // Do not expose an authenticated workspace until its bearer token is
        // ready.  Otherwise MainActivity can bootstrap owner data in the small
        // auth-listener/token-listener gap, send a request without Authorization
        // and permanently retain the resulting 401 state.
        if (_session.value.uid != user.uid || !_session.value.isAuthenticated) {
            _session.value = UserSession()
        }
        user.getIdToken(false)
            .addOnSuccessListener { result ->
                synchronized(sessionLock) {
                val token = result.token.orEmpty()
                if (auth?.currentUser?.uid == user.uid && token.isNotBlank() && epoch == sessionEpoch.get()) {
                    _session.value = UserSession(
                        uid = user.uid,
                        email = user.email.orEmpty(),
                        displayName = user.displayName.orEmpty(),
                        token = token,
                        activeBusinessId = user.uid,
                        isAuthenticated = true
                    )
                }
                }
            }
            .addOnFailureListener {
                synchronized(sessionLock) { if (auth?.currentUser?.uid == user.uid && epoch == sessionEpoch.get()) _session.value = UserSession() }
            }
    }

    suspend fun login(email: String, pass: String): Result<UserSession> = firebaseResult {
        require(email.trim().contains('@')) { "Ingresá un correo válido." }
        require(pass.isNotBlank()) { "Ingresá tu contraseña." }
        val user = configuredAuth().signInWithEmailAndPassword(email.trim(), pass).await().user ?: error("No se pudo iniciar sesión.")
        refreshSession(user)
    }

    suspend fun register(businessName: String, email: String, pass: String): Result<UserSession> = firebaseResult {
        require(businessName.trim().length >= 3) { "El nombre del negocio debe tener al menos 3 caracteres." }
        require(email.trim().contains('@')) { "Ingresá un correo válido." }
        require(pass.length >= 6) { "La contraseña debe tener al menos 6 caracteres." }
        val user = configuredAuth().createUserWithEmailAndPassword(email.trim(), pass).await().user ?: error("No se pudo crear la cuenta.")
        user.updateProfile(UserProfileChangeRequest.Builder().setDisplayName(businessName.trim()).build()).await()
        // The API creates the business only for a verified identity.  Sending this
        // here avoids a Firebase-only account silently reaching a blank owner UI.
        user.sendEmailVerification().await()
        refreshSession(user)
    }

    suspend fun signInWithGoogleIdToken(idToken: String): Result<UserSession> = firebaseResult {
        require(idToken.isNotBlank()) { "Google no devolvió una credencial válida." }
        val user = configuredAuth().signInWithCredential(GoogleAuthProvider.getCredential(idToken, null)).await().user
            ?: error("No se pudo iniciar sesión con Google.")
        refreshSession(user)
    }

    suspend fun sendPasswordReset(email: String): Result<Unit> = firebaseResult {
        require(email.trim().contains('@')) { "Ingresá un correo válido." }
        configuredAuth().sendPasswordResetEmail(email.trim()).await()
    }

    suspend fun refreshIdToken(forceRefresh: Boolean = false): String? {
        val user = auth?.currentUser ?: return null
        val epoch = sessionEpoch.get()
        return try {
            val token = user.getIdToken(forceRefresh).await().token?.takeIf { it.isNotBlank() }
            synchronized(sessionLock) {
                if (epoch != sessionEpoch.get() || auth?.currentUser?.uid != user.uid || _session.value.uid != user.uid) null
                else token?.also { _session.value = _session.value.copy(token = it) }
            }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (error: com.google.firebase.auth.FirebaseAuthInvalidUserException) {
            synchronized(sessionLock) { if (epoch == sessionEpoch.get() && auth?.currentUser?.uid == user.uid) logout() }
            null
        } catch (_: Exception) { null }
    }

    suspend fun resendVerification(): Result<Unit> = firebaseResult {
        val user = configuredAuth().currentUser ?: error("Volvé a iniciar sesión.")
        if (!user.isEmailVerified) user.sendEmailVerification().await()
    }

    suspend fun reloadVerifiedSession(): Result<UserSession> = firebaseResult {
        val user = configuredAuth().currentUser ?: error("Volvé a iniciar sesión.")
        val epoch = sessionEpoch.get()
        user.reload().await()
        check(epoch == sessionEpoch.get() && configuredAuth().currentUser?.uid == user.uid) { "La sesión cambió. Volvé a iniciar sesión." }
        refreshSession(user)
    }

    fun getToken(): String? = _session.value.token.takeIf { _session.value.isAuthenticated && it.isNotBlank() }

    fun logout() = synchronized(sessionLock) {
        sessionEpoch.incrementAndGet()
        auth?.signOut()
        _session.value = UserSession()
    }

    fun reauthenticationCapabilities(): ReauthenticationCapabilities? {
        val user = auth?.currentUser ?: return null
        val providers = user.providerData.map { it.providerId }.toSet()
        return ReauthenticationCapabilities(
            email = user.email.orEmpty(),
            supportsPassword = EmailAuthProvider.PROVIDER_ID in providers && !user.email.isNullOrBlank(),
            supportsGoogle = GoogleAuthProvider.PROVIDER_ID in providers
        )
    }

    suspend fun reauthenticateWithPassword(password: String): Result<Unit> = firebaseResult {
        require(password.isNotBlank()) { "Ingresá tu contraseña." }
        val user = configuredAuth().currentUser ?: error("Tu sesión ya no está disponible.")
        val email = user.email?.takeIf(String::isNotBlank) ?: error("Esta cuenta no permite reautenticación con contraseña.")
        user.reauthenticate(EmailAuthProvider.getCredential(email, password)).await()
        refreshSession(user)
        Unit
    }

    suspend fun reauthenticateWithGoogleIdToken(idToken: String): Result<Unit> = firebaseResult {
        require(idToken.isNotBlank()) { "Google no devolvió una credencial válida." }
        val user = configuredAuth().currentUser ?: error("Tu sesión ya no está disponible.")
        val expectedUid = user.uid
        user.reauthenticate(GoogleAuthProvider.getCredential(idToken, null)).await()
        check(configuredAuth().currentUser?.uid == expectedUid) {
            "La cuenta de Google elegida no coincide con esta sesión."
        }
        refreshSession(user)
        Unit
    }

    private suspend fun refreshSession(user: FirebaseUser): UserSession {
        val epoch = sessionEpoch.get()
        val session = UserSession(uid = user.uid, email = user.email.orEmpty(), displayName = user.displayName.orEmpty(), token = user.getIdToken(true).await().token.orEmpty(), activeBusinessId = user.uid, isAuthenticated = true)
        synchronized(sessionLock) {
            check(epoch == sessionEpoch.get() && configuredAuth().currentUser?.uid == user.uid && session.token.isNotBlank()) { "La sesión cambió. Volvé a iniciar sesión." }
            _session.value = session
        }
        return session
    }

    private suspend fun <T> firebaseResult(block: suspend () -> T): Result<T> = try {
        Result.success(block())
    } catch (cancelled: CancellationException) {
        throw cancelled
    } catch (failure: Throwable) {
        val message = when (failure) {
            is com.google.firebase.FirebaseNetworkException -> "No se pudo conectar. Revisá tu conexión y volvé a intentar."
            is com.google.firebase.FirebaseTooManyRequestsException -> "Hubo demasiados intentos. Esperá unos minutos y volvé a intentar."
            is com.google.firebase.auth.FirebaseAuthWeakPasswordException -> "Elegí una contraseña más segura, de al menos 6 caracteres."
            is com.google.firebase.auth.FirebaseAuthUserCollisionException -> "Este correo ya tiene una cuenta. Iniciá sesión o recuperá tu contraseña."
            is com.google.firebase.auth.FirebaseAuthInvalidCredentialsException,
            is com.google.firebase.auth.FirebaseAuthInvalidUserException -> "No se pudo verificar tu acceso. Revisá el correo y la contraseña."
            is IllegalArgumentException -> failure.message ?: "Revisá los datos ingresados."
            else -> "No se pudo completar la operación. Volvé a intentar."
        }
        Result.failure(IllegalStateException(message, failure))
    }

    private fun configuredAuth(): FirebaseAuth = auth
        ?: throw IllegalStateException("No se pudo iniciar sesión. Actualizá la app y volvé a intentar.")
}
