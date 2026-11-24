package com.pediturno.servicios

import com.pediturno.servicios.service.OwnerPushPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OwnerPushPolicyTest {
    private val event = mapOf("ownerId" to "qa-a", "destination" to "agenda")

    @Test fun `current account receives its own generic booking event`() {
        assertTrue(OwnerPushPolicy.accepts(event, "qa-a"))
    }
    @Test fun `queued event is discarded after offline logout or account switch`() {
        assertFalse(OwnerPushPolicy.accepts(event, null))
        assertFalse(OwnerPushPolicy.accepts(event, ""))
        assertFalse(OwnerPushPolicy.accepts(event, "qa-b"))
    }
    @Test fun `unscoped and unsupported events cannot display notifications`() {
        assertFalse(OwnerPushPolicy.accepts(mapOf("destination" to "agenda"), "qa-a"))
        assertFalse(OwnerPushPolicy.accepts(event + ("ownerId" to ""), "qa-a"))
        assertFalse(OwnerPushPolicy.accepts(event + ("destination" to "billing"), "qa-a"))
    }
}
