package com.pediturno.servicios

import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.Text
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.junit4.createComposeRule
import com.pediturno.servicios.core.theme.*
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test

class ThemeContentContrastTest {
    @get:Rule val compose=createComposeRule()
    @Test fun floatingActionTextUsesTheDarkContentColorOnMint() {
        var layout:TextLayoutResult?=null
        compose.setContent {
            PediturnoTheme {
                ExtendedFloatingActionButton(onClick={},containerColor=MintPrimary,contentColor=OnMintPrimary) {
                    Text("Turno",onTextLayout={layout=it})
                }
            }
        }
        compose.runOnIdle {
            assertNotNull(layout)
            assertEquals("Actual resolved text must inherit the FAB foreground",OnMintPrimary,layout!!.layoutInput.style.color)
        }
    }
    @Test fun errorButtonTextInheritsItsReadableForeground() {
        var layout:TextLayoutResult?=null
        compose.setContent {
            PediturnoTheme {
                Button(onClick={},colors=ButtonDefaults.buttonColors(containerColor=MaterialTheme.colorScheme.error,contentColor=MaterialTheme.colorScheme.onError)) {
                    Text("Cancelar turno",onTextLayout={layout=it})
                }
            }
        }
        compose.runOnIdle { assertEquals(Color.Black,layout!!.layoutInput.style.color) }
    }
    @Test fun tertiaryButtonTextInheritsItsReadableForeground() {
        var layout:TextLayoutResult?=null
        compose.setContent {
            PediturnoTheme {
                Button(onClick={},colors=ButtonDefaults.buttonColors(containerColor=MaterialTheme.colorScheme.tertiary,contentColor=MaterialTheme.colorScheme.onTertiary)) {
                    Text("Continuar",onTextLayout={layout=it})
                }
            }
        }
        compose.runOnIdle { assertEquals(Color.Black,layout!!.layoutInput.style.color) }
    }
}
