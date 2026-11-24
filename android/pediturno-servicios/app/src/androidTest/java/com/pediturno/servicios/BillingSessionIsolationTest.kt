package com.pediturno.servicios

import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStoreOwner
import com.pediturno.servicios.data.model.MembershipInfo
import com.pediturno.servicios.ui.WorkspaceSessionStoreViewModel
import com.pediturno.servicios.ui.agenda.BillingUiState
import com.pediturno.servicios.ui.agenda.SubscriptionPlanDialog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Controlled session identities; no Firebase sign-in or production entitlement writes. */
class BillingSessionIsolationTest {
    @get:Rule val compose = createComposeRule()

    private class BillingWorkspace(val membership: MembershipInfo) : ViewModel() {
        var cleared = false
        override fun onCleared() { cleared = true }
    }

    private fun workspace(owner: ViewModelStoreOwner, uid: String, response: MembershipInfo): BillingWorkspace {
        val factory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = BillingWorkspace(response) as T
        }
        return ViewModelProvider(owner, factory).get("agenda:$uid", BillingWorkspace::class.java)
    }

    @Test fun anotherSessionDoesNotInheritThePreviousSessionsProDisplay() {
        val store = WorkspaceSessionStoreViewModel()
        val uid = mutableStateOf("qa-owner-a")
        var first: BillingWorkspace? = null
        var cleanups = 0
        compose.setContent {
            val response = if (uid.value == "qa-owner-a") MembershipInfo(plan = "pro", status = "active") else MembershipInfo()
            val model = workspace(store.forAccount(uid.value), uid.value, response)
            if (uid.value == "qa-owner-a") first = model
            store.attachCleanup { cleanups++ }
            SubscriptionPlanDialog(model.membership, BillingUiState(), {}, {}, {}, {})
        }
        compose.onNodeWithText("Plan Pro Activo").assertIsDisplayed()
        compose.runOnIdle { uid.value = "qa-owner-b" }
        compose.onNodeWithText("Plan Gratis Permanente").assertIsDisplayed()
        compose.onNodeWithText("Plan Pro Activo").assertDoesNotExist()
        compose.runOnIdle {
            assertTrue(first!!.cleared)
            assertEquals(1, cleanups)
            store.clearAccount()
        }
    }

    @Test fun signingOutRemovesTheProCacheEvenWhenTheSameUidReturns() {
        val store = WorkspaceSessionStoreViewModel()
        val loginGeneration = mutableStateOf(0)
        var first: BillingWorkspace? = null
        compose.setContent {
            val response = if (loginGeneration.value == 0) MembershipInfo(plan = "pro", status = "active") else MembershipInfo()
            val model = workspace(store.forAccount("qa-owner-a"), "qa-owner-a", response)
            if (loginGeneration.value == 0) first = model
            SubscriptionPlanDialog(model.membership, BillingUiState(), {}, {}, {}, {})
        }
        compose.onNodeWithText("Plan Pro Activo").assertIsDisplayed()
        compose.runOnIdle {
            store.clearAccount()
            loginGeneration.value++
        }
        compose.onNodeWithText("Plan Gratis Permanente").assertIsDisplayed()
        compose.onNodeWithText("Plan Pro Activo").assertDoesNotExist()
        compose.runOnIdle {
            assertTrue(first!!.cleared)
            store.clearAccount()
        }
    }
}
