package com.pediturno.servicios

import android.content.ClipboardManager
import android.content.Context
import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertHeightIsAtLeast
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.pediturno.servicios.core.theme.PediturnoTheme
import com.pediturno.servicios.ui.components.DESKTOP_WEB_LOGIN_URL
import com.pediturno.servicios.ui.components.DesktopWebAccessCard
import com.pediturno.servicios.ui.components.copyDesktopWebAddress
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Local UI only: no account, provider or backend requests. Release APK smoke is separate. */
class DesktopWebAccessCompatibilityTest {
    @get:Rule val compose = createComposeRule()

    private fun content(width: Int, fontScale: Float = 1f) {
        compose.setContent { PediturnoTheme {
            val context = LocalContext.current
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                Column(Modifier.width(width.dp).verticalScroll(rememberScrollState())) {
                    DesktopWebAccessCard(onCopyAddress = { copyDesktopWebAddress(context) })
                }
            }
        } }
    }

    private fun copyAndCheck() {
        compose.onNodeWithText("Copiar dirección web").assertIsDisplayed().assertHeightIsAtLeast(48.dp).performClick()
        compose.runOnIdle {
            val context = InstrumentationRegistry.getInstrumentation().targetContext
            val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            assertEquals(DESKTOP_WEB_LOGIN_URL, clipboard.primaryClip!!.getItemAt(0).text.toString())
            assertEquals("https://pediturno.com/?login=1", clipboard.primaryClip!!.getItemAt(0).text.toString())
        }
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "compat29").apply { mkdirs() }
        val bitmap = instrumentation.uiAutomation.takeScreenshot()
        File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
    }

    @Test fun compactWidthKeepsCopyUsable() {
        content(360)
        compose.onNodeWithText("También desde tu PC").assertIsDisplayed()
        copyAndCheck()
        screenshot("compact360")
    }

    @Test fun largeTextKeepsInstructionsAndTouchTargetVisible() {
        content(360, 1.5f)
        compose.onNodeWithText("Usá el mismo método de acceso: Google o correo y contraseña. No necesitás crear otra cuenta.").assertIsDisplayed()
        copyAndCheck()
        screenshot("compact360-font150")
    }

    @Test fun tabletWidthKeepsCopyUsable() {
        content(1200)
        compose.onNodeWithText("También desde tu PC").assertIsDisplayed()
        copyAndCheck()
        screenshot("tablet1200")
    }

    @Test fun copyRemainsAvailableAfterSavedStateRestore() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent { PediturnoTheme {
            val context = LocalContext.current
            DesktopWebAccessCard(onCopyAddress = { copyDesktopWebAddress(context) })
        } }
        copyAndCheck()
        restoration.emulateSavedInstanceStateRestore()
        copyAndCheck()
    }
}
