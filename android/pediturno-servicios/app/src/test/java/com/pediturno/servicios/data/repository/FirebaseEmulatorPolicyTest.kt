package com.pediturno.servicios.data.repository

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Test

class FirebaseEmulatorPolicyTest {
    @Test fun disabledDoesNotSelectAnyDestination() {
        assertNull(validatedFirebaseEmulatorHost(false, "10.0.2.2"))
        assertNull(validatedFirebaseEmulatorHost(false, "remote.example"))
    }

    @Test fun debugAllowsOnlyTheTwoLocalBridges() {
        assertEquals("10.0.2.2", validatedFirebaseEmulatorHost(true, "10.0.2.2"))
        assertEquals("127.0.0.1", validatedFirebaseEmulatorHost(true, "127.0.0.1"))
        for (host in listOf("remote.example", "localhost", "", "10.0.2.2.example", "127.0.0.1:9099")) {
            assertThrows(IllegalArgumentException::class.java) { validatedFirebaseEmulatorHost(true, host) }
        }
    }
}
