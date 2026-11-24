package com.pediturno.servicios

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import com.pediturno.servicios.ui.components.SyncStatusPill
import com.pediturno.servicios.ui.components.ClientsCsvExportAction
import com.pediturno.servicios.data.export.PendingWorkspaceExport
import com.pediturno.servicios.data.model.ClientItem
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Rule
import org.junit.Test

class SyncAndExportStateTest {
    @get:Rule val compose = createComposeRule()
    private val exportScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val csvRequest = PendingWorkspaceExport<List<ClientItem>>(exportScope)
    @After fun stopExports() { exportScope.cancel() }

    @Test fun failedLoadDoesNotClaimSuccessfulSynchronization() {
        compose.setContent { SyncStatusPill(isOfflineCache = false, hasVerifiedData = false) }
        compose.onNodeWithText("Sin sincronización confirmada").assertIsDisplayed()
        compose.onNodeWithText("Agenda actualizada").assertDoesNotExist()
    }

    @Test fun cachedAgendaIsClearlyIdentifiedAsLocal() {
        compose.setContent { SyncStatusPill(isOfflineCache = true, hasVerifiedData = true) }
        compose.onNodeWithText("Modo sin conexión • Datos locales").assertIsDisplayed()
        compose.onNodeWithText("Agenda actualizada").assertDoesNotExist()
    }

    @Test fun invalidClientLoadCannotExportAnEmptySuccess() {
        compose.setContent { ClientsCsvExportAction(request = csvRequest, clients = emptyList(), onMessage = {}, exportAllowed = false) }
        compose.onNodeWithText("Exportar CSV").assertIsNotEnabled()
    }
}
