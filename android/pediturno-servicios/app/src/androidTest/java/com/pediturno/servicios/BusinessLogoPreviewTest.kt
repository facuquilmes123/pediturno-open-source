package com.pediturno.servicios

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.net.Uri
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.core.app.ActivityOptionsCompat
import androidx.test.platform.app.InstrumentationRegistry
import com.pediturno.servicios.data.model.BusinessProfile
import com.pediturno.servicios.ui.agenda.EditBusinessProfileDialog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.io.File

class BusinessLogoPreviewTest {
    @get:Rule val compose = createComposeRule()

    @Test fun selectedLogoIsPreviewedAndSurvivesRecreationBeforeOneSave() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val image = File(context.cacheDir, "qa-logo-preview.png")
        val bitmap = Bitmap.createBitmap(32, 32, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.MAGENTA)
        image.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
        bitmap.recycle()
        val uri = Uri.fromFile(image)
        val registry = object : ActivityResultRegistry() {
            override fun <I, O> onLaunch(requestCode: Int, contract: ActivityResultContract<I, O>, input: I, options: ActivityOptionsCompat?) {
                dispatchResult(requestCode, Activity.RESULT_OK, Intent().setData(uri))
            }
        }
        val owner = object : ActivityResultRegistryOwner {
            override val activityResultRegistry = registry
        }
        val saved = mutableListOf<Pair<BusinessProfile, Uri?>>()
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            CompositionLocalProvider(LocalActivityResultRegistryOwner provides owner) {
                EditBusinessProfileDialog(
                    profile = BusinessProfile(id = "qa-business", name = "QA negocio", slug = "qa-negocio", email = "qa@example.invalid"),
                    isSubmitting = false,
                    onSaveProfile = { profile, selected -> saved += profile to selected },
                    onDismiss = {}
                )
            }
        }
        compose.onNodeWithText("Agregar logo del negocio").performScrollTo().performClick()
        compose.waitUntil(15000) {
            compose.onAllNodesWithText("El logo seleccionado se subirá al guardar.").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithContentDescription("Vista previa del logo del negocio").assertIsDisplayed()
        assertTrue(saved.isEmpty())
        restoration.emulateSavedInstanceStateRestore()
        compose.waitUntil(15000) {
            compose.onAllNodesWithText("El logo seleccionado se subirá al guardar.").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithContentDescription("Vista previa del logo del negocio").assertIsDisplayed()
        compose.onNodeWithText("Guardar Cambios").performClick()
        compose.runOnIdle {
            assertEquals(1, saved.size)
            assertEquals(uri, saved.single().second)
            assertEquals("QA negocio", saved.single().first.name)
        }
        image.delete()
    }
}
