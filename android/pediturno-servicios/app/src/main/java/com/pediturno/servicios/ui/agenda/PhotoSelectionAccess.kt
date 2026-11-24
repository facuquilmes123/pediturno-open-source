package com.pediturno.servicios.ui.agenda

import android.content.Context
import android.content.Intent
import android.net.Uri

/** Photo Picker grants must survive OS process reclamation while a draft is open. */
internal fun Context.retainDraftPhoto(uri: Uri) {
    try { contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
    catch (_: SecurityException) { /* Providers may offer only a temporary grant. */ }
    catch (_: IllegalArgumentException) { /* Non-persistable providers, including test URIs. */ }
}

internal fun Context.releaseDraftPhotos() {
    contentResolver.persistedUriPermissions.filter { it.isReadPermission }.forEach { grant ->
        try { contentResolver.releasePersistableUriPermission(grant.uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) }
        catch (_: SecurityException) { }
    }
}
