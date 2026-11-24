package com.pediturno.servicios

import android.app.Application
import kotlinx.coroutines.runBlocking
import com.pediturno.servicios.core.timezone.BusinessTimeZoneManager
import com.pediturno.servicios.data.remote.HttpPediturnoRemoteDataSource
import com.pediturno.servicios.data.remote.PediturnoRemoteDataSource
import com.pediturno.servicios.data.repository.AgendaRepository
import com.pediturno.servicios.data.repository.AuthRepository
import com.pediturno.servicios.data.repository.PushRepository
import com.pediturno.servicios.data.repository.GooglePlayBillingBackend
import com.pediturno.servicios.data.repository.GooglePlayBillingRepository
import com.pediturno.servicios.data.repository.ImageUploadAuthorizer
import com.pediturno.servicios.data.repository.BusinessImageRepository
import com.pediturno.servicios.data.repository.AppCheckTokenRepository
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.appcheck.FirebaseAppCheck
import com.google.firebase.appcheck.playintegrity.PlayIntegrityAppCheckProviderFactory
import com.pediturno.servicios.domain.usecase.CreateAppointmentUseCase
import com.pediturno.servicios.domain.usecase.RescheduleAppointmentUseCase
import com.pediturno.servicios.domain.usecase.UpdateAppointmentStatusUseCase

class PediturnoApp : Application() {

    lateinit var timeZoneManager: BusinessTimeZoneManager
    lateinit var remoteDataSource: PediturnoRemoteDataSource
    lateinit var authRepository: AuthRepository
    lateinit var agendaRepository: AgendaRepository
    lateinit var pushRepository: PushRepository
    lateinit var googlePlayBillingRepository: GooglePlayBillingRepository
    lateinit var googlePlayBillingBackend: GooglePlayBillingBackend
    lateinit var businessImageRepository: BusinessImageRepository
    lateinit var appCheckTokenRepository: AppCheckTokenRepository

    lateinit var createAppointmentUseCase: CreateAppointmentUseCase
    lateinit var rescheduleAppointmentUseCase: RescheduleAppointmentUseCase
    lateinit var updateAppointmentStatusUseCase: UpdateAppointmentStatusUseCase

    override fun onCreate() {
        super.onCreate()

        if (BuildConfig.USE_FIREBASE_EMULATORS) {
            FirebaseApp.initializeApp(this, FirebaseOptions.Builder()
                // Non-secret placeholder: Auth/Storage targets are explicitly emulator hosts.
                .setApiKey("AIzaSyDUMMY_LOCAL_EMULATOR_ONLY_000000000")
                .setApplicationId("1:000000000000:android:demo-pediturno-audit")
                .setProjectId("demo-pediturno-audit")
                .setStorageBucket("demo-pediturno-audit.appspot.com")
                .build())
        } else {
            FirebaseApp.initializeApp(this)
            FirebaseAppCheck.getInstance().installAppCheckProviderFactory(
                PlayIntegrityAppCheckProviderFactory.getInstance()
            )
        }
        appCheckTokenRepository = AppCheckTokenRepository()
        timeZoneManager = BusinessTimeZoneManager()
        authRepository = AuthRepository(this, useFirebaseEmulator = BuildConfig.USE_FIREBASE_EMULATORS)
        remoteDataSource = HttpPediturnoRemoteDataSource(
            baseUrl = BuildConfig.API_BASE_URL,
            tokenProvider = { runBlocking { authRepository.refreshIdToken() } },
            appCheckTokens = appCheckTokenRepository,
            requireAppCheck = !BuildConfig.USE_FIREBASE_EMULATORS,
            allowProductionMutations = BuildConfig.ALLOW_PRODUCTION_MUTATIONS,
            ownerProvider = { authRepository.session.value.uid.takeIf { it.isNotBlank() } }
        )
        agendaRepository = AgendaRepository(
            remoteDataSource = remoteDataSource,
            cacheDirectory = filesDir
        )
        pushRepository = PushRepository(remoteDataSource).apply {
            setupNotificationChannels(this@PediturnoApp)
        }
        googlePlayBillingRepository = GooglePlayBillingRepository(this)
        googlePlayBillingBackend = GooglePlayBillingBackend(BuildConfig.API_BASE_URL, { runBlocking { authRepository.refreshIdToken() } })
        val imageAuthorizer = ImageUploadAuthorizer(
            baseUrl = BuildConfig.API_BASE_URL,
            client = (remoteDataSource as HttpPediturnoRemoteDataSource).okHttpClient,
            ownerProvider = { authRepository.session.value.uid.takeIf { it.isNotBlank() } },
            attestationProvider = { appCheckTokenRepository.limitedUseToken() },
            requireAttestation = !BuildConfig.USE_FIREBASE_EMULATORS
        )
        businessImageRepository = BusinessImageRepository(this,
            useFirebaseEmulator = BuildConfig.USE_FIREBASE_EMULATORS,
            authorizeUpload = imageAuthorizer::authorize
        )

        createAppointmentUseCase = CreateAppointmentUseCase(agendaRepository)
        rescheduleAppointmentUseCase = RescheduleAppointmentUseCase(agendaRepository)
        updateAppointmentStatusUseCase = UpdateAppointmentStatusUseCase(agendaRepository)
    }
}
