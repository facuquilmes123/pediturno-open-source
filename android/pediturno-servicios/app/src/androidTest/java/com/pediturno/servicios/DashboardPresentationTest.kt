package com.pediturno.servicios

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performSemanticsAction
import com.pediturno.servicios.core.theme.PediturnoTheme
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.ui.components.BusinessDashboardOverview
import com.pediturno.servicios.ui.components.BusinessDashboardTestTags
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class DashboardPresentationTest {
    @get:Rule val compose=createComposeRule()
    private fun render(width:Int,fontScale:Float,upcoming:List<Appointment> = emptyList()) {
        compose.setContent {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,fontScale)) {
                PediturnoTheme {
                    Box(Modifier.width(width.dp)) {
                        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState())) {
                            BusinessDashboardOverview("2026-11",123456,987654,1234567.89,upcoming,false,true,null,{})
                        }
                    }
                }
            }
        }
    }
    private fun assertReadout(tag:String) {
        val node=compose.onNodeWithTag(tag, useUnmergedTree = true)
        node.performScrollTo().assertIsDisplayed()
        val layouts=mutableListOf<TextLayoutResult>()
        node.performSemanticsAction(SemanticsActions.GetTextLayoutResult){it(layouts)}
        compose.runOnIdle {
            layouts.forEach { layout ->
                // Paragraph widths are fractional at Samsung's density. The
                // rounded paragraph flag reports overflow even when all glyphs
                // fit (e.g. 248.31px of ink in a250px box). Check actual bounds.
                assertFalse("Metric $tag must not clip vertically",layout.didOverflowHeight)
                val text=layout.layoutInput.text.text
                assertEquals(text.length,layout.getLineEnd(layout.lineCount-1,visibleEnd=false))
                text.indices.forEach { index ->
                    val bounds=layout.getBoundingBox(index)
                    assertTrue("Metric $tag glyph $index outside ${layout.size}: $bounds",
                        bounds.left>=-1f && bounds.right<=layout.size.width+1f && bounds.top>=-1f && bounds.bottom<=layout.size.height+1f)
                }
            }
        }
    }
    @Test fun narrowTwoHundredPercentKeepsLargeCountsAndAmountReadable() {
        render(300,2f)
        compose.onNodeWithText("noviembre 2026").assertIsDisplayed()
        compose.onNodeWithTag(BusinessDashboardTestTags.UPCOMING_COUNT, useUnmergedTree = true).assertTextEquals("123456")
        compose.onNodeWithTag(BusinessDashboardTestTags.CLIENT_COUNT, useUnmergedTree = true).assertTextEquals("987654")
        assertReadout(BusinessDashboardTestTags.UPCOMING_COUNT)
        assertReadout(BusinessDashboardTestTags.CLIENT_COUNT)
        assertReadout(BusinessDashboardTestTags.COMPLETED_VALUE)
    }
    @Test fun regularPhoneKeepsBothCountsAndFullCurrencyReadable() {
        render(360,1.1f)
        assertReadout(BusinessDashboardTestTags.UPCOMING_COUNT)
        assertReadout(BusinessDashboardTestTags.CLIENT_COUNT)
        assertReadout(BusinessDashboardTestTags.COMPLETED_VALUE)
    }
    @Test fun longUpcomingDetailsRemainReachableAtTwoHundredPercent() {
        val client="QA Cliente de ejemplo con nombre compuesto y apellido extendido"
        val service="Servicio de ejemplo con descripción extensa y atención personalizada"
        render(300,2f,listOf(Appointment(id="qa",client=client,clientPhone="",serviceId="qa",service=service,
            dateKey="2026-11-03",time="18:30",durationMinutes=30,priceAtBooking=900.0,
            status=AppointmentStatus.Confirmado,businessId="qa")))
        compose.onNodeWithText(client).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText(service).performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("3 nov 2026 · 18:30").performScrollTo().assertIsDisplayed()
    }
}
