plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.compose.compiler)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.google.services) apply false
}

// google-services.json contains public identifiers but belongs to the provisioned
// Firebase Android app. Keeping it out of source lets local tests compile without
// accidentally binding this package to a production Firebase project.
if (file("google-services.json").isFile) {
    apply(plugin = "com.google.gms.google-services")
}

val uploadStorePath = providers.environmentVariable("PEDITURNO_UPLOAD_STORE_FILE").orNull
val uploadStorePassword = providers.environmentVariable("PEDITURNO_UPLOAD_STORE_PASSWORD").orNull
val uploadKeyPassword = providers.environmentVariable("PEDITURNO_UPLOAD_KEY_PASSWORD").orNull
val uploadKeyAlias = providers.environmentVariable("PEDITURNO_UPLOAD_KEY_ALIAS").orNull
val uploadSigningReady = !uploadStorePath.isNullOrBlank() && !uploadStorePassword.isNullOrBlank() &&
    !uploadKeyPassword.isNullOrBlank() && !uploadKeyAlias.isNullOrBlank()
// The default is the Android Emulator bridge.  A physical, locally-connected
// device can opt into localhost only; arbitrary debug endpoints are never
// accepted through a Gradle property.
val allowedDebugLoopbackHosts = setOf("10.0.2.2", "127.0.0.1")
val debugLoopbackHost = providers.gradleProperty("pediturnoDebugHost")
    .map(String::trim)
    .getOrElse("10.0.2.2")
    .also { host ->
        check(host in allowedDebugLoopbackHosts) {
            "pediturnoDebugHost must be exactly one of: ${allowedDebugLoopbackHosts.joinToString()}"
        }
    }
val nativeE2eRunnerArguments = mapOf(
    "fixtureDate" to "PEDITURNO_E2E_FIXTURE_DATE",
    "ownerAEmail" to "PEDITURNO_E2E_OWNER_A_EMAIL",
    "ownerAPassword" to "PEDITURNO_E2E_OWNER_A_PASSWORD",
    "ownerAServiceId" to "PEDITURNO_E2E_OWNER_A_SERVICE_ID",
    "ownerBEmail" to "PEDITURNO_E2E_OWNER_B_EMAIL",
    "ownerBPassword" to "PEDITURNO_E2E_OWNER_B_PASSWORD",
    "ownerBServiceId" to "PEDITURNO_E2E_OWNER_B_SERVICE_ID"
)

android {
    namespace = "com.pediturno.servicios"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.pediturno.servicios"
        minSdk = 26
        targetSdk = 36
        versionCode = 30
        versionName = "1.0.4"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        // Only the local E2E runner provides these process-scoped values. They
        // are intentionally not Gradle properties or BuildConfig constants, so
        // credentials cannot appear in task command lines or APK sources.
        nativeE2eRunnerArguments.forEach { (argumentName, environmentName) ->
            providers.environmentVariable(environmentName).orNull
                ?.takeIf { it.isNotBlank() }
                ?.let { testInstrumentationRunnerArguments[argumentName] = it }
        }

        buildConfigField("String", "API_BASE_URL", "\"https://pediturno.com/api\"")
        // Release intentionally has no emulator address, even if a debug-only
        // property was supplied to the Gradle invocation.
        buildConfigField("String", "FIREBASE_EMULATOR_HOST", "\"\"")
        buildConfigField("String", "DEFAULT_TIME_ZONE", "\"America/Argentina/Buenos_Aires\"")
        buildConfigField("Boolean", "ALLOW_PRODUCTION_MUTATIONS", "false")

        vectorDrawables {
            useSupportLibrary = true
        }
    }

    signingConfigs {
        if (uploadSigningReady) {
            create("upload") {
                storeFile = file(uploadStorePath!!)
                storePassword = uploadStorePassword
                keyAlias = uploadKeyAlias
                keyPassword = uploadKeyPassword
            }
        }
    }

    buildTypes {
        debug {
            applicationIdSuffix = ".debug"
            isDebuggable = true
            buildConfigField("Boolean", "ALLOW_PRODUCTION_MUTATIONS", "false")
            buildConfigField("String", "API_BASE_URL", "\"http://$debugLoopbackHost:3000/api\"")
            buildConfigField("String", "FIREBASE_EMULATOR_HOST", "\"$debugLoopbackHost\"")
            buildConfigField("Boolean", "USE_FIREBASE_EMULATORS", "true")
        }
        release {
            if (uploadSigningReady) signingConfig = signingConfigs.getByName("upload")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            buildConfigField("Boolean", "ALLOW_PRODUCTION_MUTATIONS", "true")
            buildConfigField("String", "API_BASE_URL", "\"https://pediturno.com/api\"")
            buildConfigField("String", "FIREBASE_EMULATOR_HOST", "\"\"")
            buildConfigField("Boolean", "USE_FIREBASE_EMULATORS", "false")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
}

val validateUploadSigning by tasks.registering {
    doLast {
        check(uploadSigningReady) {
            "Release signing is required. Run scripts/android-release.ps1; never put signing secrets in the repository."
        }
    }
}
tasks.matching { it.name == "assembleRelease" || it.name == "bundleRelease" }.configureEach {
    dependsOn(validateUploadSigning)
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.exifinterface)
    implementation(libs.androidx.activity.compose)
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.ui)
    implementation(libs.androidx.compose.ui.graphics)
    implementation(libs.androidx.compose.ui.tooling.preview)
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.compose.material.icons.extended)

    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.runtime.ktx)

    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.kotlinx.coroutines.play.services)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.okhttp)
    implementation(libs.coil.compose)
    implementation(libs.coil.network.okhttp)
    implementation(libs.okhttp.logging)
    implementation(platform(libs.firebase.bom))
    implementation(libs.firebase.auth)
    constraints {
        implementation(libs.google.recaptcha) {
            because("Upgrade Auth's transitive SDK to a supported release with the AGP 9 package collision fix")
        }
        implementation(libs.protobuf.javalite) {
            because("CVE-2024-7254 affects the transitive Lite parser before the upstream 3.25.5 fix")
        }
    }
    implementation(libs.firebase.messaging)
    implementation(libs.firebase.storage)
    implementation(libs.firebase.appcheck.playintegrity)
    implementation(libs.androidx.credentials)
    implementation(libs.androidx.credentials.play.services.auth)
    implementation(libs.googleid)
    implementation(libs.play.billing)
    implementation(libs.play.review)
    // Apache-2.0 QR encoder; Android has no framework QR generation API.
    implementation(libs.zxing.core)
    implementation(libs.androidx.browser)

    testImplementation(libs.junit)
    testImplementation(libs.protobuf.javalite)
    // Exercise the same legacy Tink keyset types resolved by the production SDK.
    testImplementation(libs.tink.android)
    testImplementation(libs.kotlinx.coroutines.test)
    testImplementation(libs.androidx.test.core)

    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.espresso.core)
    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)

    debugImplementation(libs.androidx.compose.ui.tooling)
    debugImplementation(libs.androidx.compose.ui.test.manifest)
}
