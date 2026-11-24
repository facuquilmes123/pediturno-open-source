package com.pediturno.servicios

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performScrollTo
import androidx.compose.runtime.mutableStateOf
import com.pediturno.servicios.data.model.MembershipInfo
import com.pediturno.servicios.ui.agenda.BillingUiState
import com.pediturno.servicios.ui.agenda.SubscriptionPlanDialog
import com.pediturno.servicios.ui.agenda.SubscriptionTestTags
import org.junit.Rule
import org.junit.Test

class BillingResultVisibilityTest {
    @get:Rule val compose = createComposeRule()

    private fun showResult(message: String) {
        compose.setContent {
            SubscriptionPlanDialog(
                membership = MembershipInfo(),
                billing = BillingUiState(canPurchase = true, formattedPrice = "$ 10.800,00", message = message),
                onDismiss = {}, onPurchase = {}, onRestore = {}, onRefresh = {}
            )
        }
        compose.onNodeWithText(message).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(SubscriptionTestTags.PURCHASE_BUTTON).performScrollTo().assertIsEnabled()
    }

    @Test fun declinedPurchaseMessageRemainsVisibleAlongsideTheLocalizedPrice() {
        showResult("Google Play no pudo completar la operación. Podés reintentar.")
    }

    @Test fun cancellationMessageRemainsVisibleWhileAnotherAttemptIsAvailable() {
        showResult("La compra fue cancelada.")
    }

    @Test fun purchaseResultSurvivesTheCatalogRefreshAfterReturningFromPlay() {
        val outcome = "Google Play no pudo completar la operación. Podés reintentar."
        val state = mutableStateOf(BillingUiState(canPurchase = true, formattedPrice = "$ 10.800,00", purchaseResultMessage = outcome))
        compose.setContent {
            SubscriptionPlanDialog(MembershipInfo(), state.value, {}, {}, {}, {})
        }
        compose.runOnIdle { state.value = state.value.copy(isLoading = true, message = null) }
        compose.runOnIdle { state.value = state.value.copy(isLoading = false, formattedPrice = "$ 10.800,00", message = null) }
        compose.onNodeWithText(outcome).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(SubscriptionTestTags.PURCHASE_BUTTON).performScrollTo().assertIsEnabled()
    }

    @Test fun aCurrentLegacyMembershipCannotShowAnotherPurchaseEvenWithStaleEligibility() {
        compose.setContent {
            SubscriptionPlanDialog(
                MembershipInfo(plan = "pro", status = "active", source = "LEGACY"),
                BillingUiState(canPurchase = true, formattedPrice = "$ 10.800,00"),
                {}, {}, {}, {}
            )
        }
        compose.onNodeWithTag(SubscriptionTestTags.PURCHASE_BUTTON).assertDoesNotExist()
    }

    @Test fun rejectedRestoreRemainsVisibleWithoutReplacingTheLegacyMembership() {
        val outcome = "No pudimos verificar esta compra con la cuenta actual. Usá la cuenta de Pediturno con la que la realizaste."
        val state = mutableStateOf(BillingUiState(purchaseResultMessage = outcome))
        compose.setContent {
            SubscriptionPlanDialog(
                MembershipInfo(plan = "pro", status = "active", source = "LEGACY"),
                state.value, {}, {}, {}, {}
            )
        }
        compose.runOnIdle { state.value = state.value.copy(isLoading = true, message = null) }
        compose.runOnIdle { state.value = state.value.copy(isLoading = false, message = null) }
        compose.onNodeWithText(outcome).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(SubscriptionTestTags.PURCHASE_BUTTON).assertDoesNotExist()
    }
}
