package com.pediturno.servicios

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import com.pediturno.servicios.data.model.ClientItem
import com.pediturno.servicios.data.model.ServiceItem
import com.pediturno.servicios.data.model.DaySchedule
import com.pediturno.servicios.data.model.DayScheduleSlot
import com.pediturno.servicios.ui.agenda.*
import com.pediturno.servicios.ui.components.BusinessDashboardOverview
import com.pediturno.servicios.ui.components.BusinessDashboardTestTags
import org.junit.Rule
import org.junit.Test

class UxImprovementsTest {
    @get:Rule val compose = createComposeRule()

    @Test fun clientDraftSurvivesSavedStateRestoreAndHidesCloseDuringEditing() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            ClientDetailDialog(
                client = ClientItem("client", "Cliente", "123456", businessId = "business"),
                history = ClientHistoryUiState(clientId = "client"),
                onLoadHistory = {}, onUpdateClient = {}, onUploadAvatar = { _, _ -> },
                onDeleteClient = {}, onBookAppointmentForClient = {}, onDismiss = {}
            )
        }
        compose.onNodeWithTag(ClientDetailTestTags.EDIT).performClick()
        compose.onNodeWithTag(ClientDetailTestTags.NAME).performTextReplacement("Borrador guardado")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag(ClientDetailTestTags.NAME).assertTextContains("Borrador guardado")
        compose.onNodeWithText("Cerrar").assertDoesNotExist()
        compose.onNodeWithTag(ClientDetailTestTags.SAVE).assertIsDisplayed()
    }

    @Test fun invalidScheduleCannotBeSaved() {
        compose.setContent {
            ServiceAvailabilityDialog(
                service = ServiceItem("service", "Corte", 30, 100.0, businessId = "business",
                    workingHours = mapOf(1 to DaySchedule(listOf(DayScheduleSlot("13:00", "09:00"))))),
                onSaveAvailability = { _, _, _ -> }, onDismiss = {}
            )
        }
        compose.onNodeWithTag(WorkspaceActionTestTags.SERVICE_AVAILABILITY_SAVE).assertIsNotEnabled()
        compose.onNodeWithText("El inicio debe ser anterior al fin de cada franja.").assertIsDisplayed()
    }

    @Test fun largeTextSummaryKeepsAllTotalsAccessible() {
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 1.3f)) {
                BusinessDashboardOverview("2026-10", 42, 100, 128450.0, emptyList(), false, true, null, {})
            }
        }
        compose.onNodeWithTag(BusinessDashboardTestTags.UPCOMING_COUNT, useUnmergedTree = true).assertTextEquals("42").assertIsDisplayed()
        compose.onNodeWithTag(BusinessDashboardTestTags.CLIENT_COUNT, useUnmergedTree = true).assertTextEquals("100").assertIsDisplayed()
        compose.onNodeWithTag(BusinessDashboardTestTags.COMPLETED_VALUE, useUnmergedTree = true).assertIsDisplayed()
    }
}
