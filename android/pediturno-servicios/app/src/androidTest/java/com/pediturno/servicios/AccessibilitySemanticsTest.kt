package com.pediturno.servicios

import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import com.pediturno.servicios.core.theme.PediturnoTheme
import com.pediturno.servicios.data.model.ServiceItem
import com.pediturno.servicios.ui.agenda.SaveServiceDialog
import com.pediturno.servicios.ui.components.BusinessDashboardOverview
import org.junit.Rule
import org.junit.Test

class AccessibilitySemanticsTest {
    @get:Rule val compose = createComposeRule()

    @Test fun metricLabelAndValueBelongToOneAccessibleNode() {
        compose.setContent { PediturnoTheme {
            BusinessDashboardOverview("2026-11", 12, 34, 567.0, emptyList(), false, true, null, {})
        } }
        compose.onNodeWithText("Reservas próximas").assertTextContains("12")
        compose.onNodeWithText("Clientes totales").assertTextContains("34")
        compose.onNodeWithText("Valor completado").assertTextContains("Turnos completados del mes")
    }

    @Test fun serviceStatusHasRadioSemanticsAndMinimumTouchHeight() {
        compose.setContent { PediturnoTheme {
            SaveServiceDialog(ServiceItem("qa", "QA service", 30, 900.0, status="Pausado", businessId="qa"), false, null,
                onDismiss = {}, onUploadImage = { _, _ -> }, onConfirm = { _, _, _, _, _ -> })
        } }
        compose.onNodeWithText("Pausado").performScrollTo().assertIsSelected().assertHeightIsAtLeast(48.dp)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.RadioButton))
        compose.onNodeWithText("Activo").assertIsNotEnabled()
    }
}
