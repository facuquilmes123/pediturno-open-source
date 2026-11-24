package com.pediturno.servicios

import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.test.platform.app.InstrumentationRegistry
import android.graphics.Bitmap
import android.content.Context
import com.pediturno.servicios.core.theme.PediturnoTheme
import com.pediturno.servicios.ui.agenda.AccountDeletionReceiptScreen
import org.junit.Rule
import org.junit.Test

class AccountDeletionReceiptTest {
    @get:Rule val compose = createComposeRule()

    @Test fun showsOnlyTheReceiptAndReturnsToLoginWithoutTheOldWorkspace() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            var ticket by rememberSaveable { mutableStateOf<String?>("qa-p6-ui-receipt") }
            PediturnoTheme {
                Surface {
                    if (ticket != null) AccountDeletionReceiptScreen(ticket!!, onContinue = { ticket = null })
                    else Text("Ingreso")
                }
            }
        }
        compose.onNodeWithText("Solicitud de baja registrada").assertIsDisplayed()
        compose.onNodeWithText("qa-p6-ui-receipt").assertIsDisplayed()
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithText("qa-p6-ui-receipt").assertIsDisplayed()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        context.openFileOutput("p6-deletion-receipt.png", Context.MODE_PRIVATE).use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
        compose.onNodeWithText("Agenda").assertDoesNotExist()
        compose.onNodeWithText("Mi Negocio").assertDoesNotExist()
        compose.onNodeWithText("Esta solicitud no cancela una suscripción de Google Play.").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Volver al ingreso").performScrollTo().performClick()
        compose.onNodeWithText("Ingreso").assertIsDisplayed()
        compose.onNodeWithText("qa-p6-ui-receipt").assertDoesNotExist()
    }
}
