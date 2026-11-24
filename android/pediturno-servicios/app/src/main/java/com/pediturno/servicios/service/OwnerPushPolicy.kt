package com.pediturno.servicios.service

/** A queued event from a previous account must never become an Android notification. */
object OwnerPushPolicy {
    fun accepts(data: Map<String, String>, currentOwnerId: String?): Boolean =
        !currentOwnerId.isNullOrBlank() && data["ownerId"] == currentOwnerId &&
            data["destination"] == "agenda"
}
