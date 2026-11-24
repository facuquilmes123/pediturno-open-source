package com.pediturno.servicios.data.repository

import com.pediturno.servicios.BuildConfig

/** Release rejects emulator opt-in before inspecting any debug destination. */
internal fun validatedFirebaseEmulatorHost(enabled: Boolean, host: String): String? {
    if (!enabled) return null
    check(BuildConfig.DEBUG) { "Firebase emulators are disabled in release builds." }
    require(host == "10.0.2.2" || host == "127.0.0.1") {
        "Firebase emulator host is not allowed for this debug build."
    }
    return host
}
