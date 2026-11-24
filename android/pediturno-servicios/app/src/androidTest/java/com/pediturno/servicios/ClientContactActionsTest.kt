package com.pediturno.servicios

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.pediturno.servicios.core.theme.PediturnoTheme
import com.pediturno.servicios.ui.components.ClientContactActions
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

class ClientContactActionsTest {
    @get:Rule val compose = createComposeRule()
    private fun verify(width: Int, font: Float) {
        val calls=IntArray(3)
        compose.setContent {
            val density=LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density,font)) {
                PediturnoTheme { Box(Modifier.width(width.dp)) {
                    ClientContactActions({calls[0]++},{calls[1]++},{calls[2]++})
                } }
            }
        }
        for (label in listOf("WhatsApp","Llamar","Agendar Turno")) {
            val layouts=mutableListOf<TextLayoutResult>()
            compose.onNodeWithText(label,useUnmergedTree=true).performSemanticsAction(SemanticsActions.GetTextLayoutResult) {it(layouts)}
            compose.runOnIdle {
                assertEquals(1,layouts.size)
                val layout=layouts.single()
                assertEquals("Action must not become a vertical stack",1,layout.lineCount)
                // Samsung's fractional density can flag paragraph overflow even when all ink fits.
                assertFalse("Label must fit vertically",layout.didOverflowHeight)
                assertEquals(label.length,layout.getLineEnd(0,visibleEnd=false))
                label.indices.forEach { index ->
                    val bounds=layout.getBoundingBox(index)
                    assertTrue("Action glyph $index must fit: $bounds in ${layout.size}",
                        bounds.left>=-1f && bounds.right<=layout.size.width+1f && bounds.top>=-1f && bounds.bottom<=layout.size.height+1f)
                }
            }
            compose.onNodeWithText(label).assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
        }
        compose.runOnIdle { assertArrayEquals(intArrayOf(1,1,1),calls) }
    }
    @Test fun compactAtTwoHundredPercentKeepsEveryActionReadableAndClickable() = verify(300,2f)
    @Test fun regularPhoneKeepsEveryActionReadableAndClickable() = verify(360,1.1f)
}
