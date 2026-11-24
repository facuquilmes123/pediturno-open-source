package com.pediturno.servicios

import com.pediturno.servicios.ui.agenda.BillingUiState
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BillingRecoveryPresentationTest {
    @Test fun recoverableSubscriptionsNeverPresentAnotherPurchaseEvenIfAnOlderResponseAllowedIt() {
        listOf("on_hold", "paused", "pending").forEach { status ->
            val state = BillingUiState(canPurchase = true, formattedPrice = "ARS 10.800", entitlementStatus = status)
            assertTrue(state.requiresExistingSubscriptionManagement)
            assertNotNull(state.recoveryMessage)
            assertFalse(state.canStartNewPurchase)
        }
    }

    @Test fun expirationStillRequiresTheServerToAuthorizeANewPurchase() {
        assertFalse(BillingUiState(entitlementStatus = "expired", canPurchase = false).canStartNewPurchase)
        assertTrue(BillingUiState(entitlementStatus = "expired", canPurchase = true).canStartNewPurchase)
    }
}
