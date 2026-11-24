package com.pediturno.servicios

import android.graphics.Bitmap
import android.net.Uri
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.junit4.StateRestorationTester
import com.pediturno.servicios.ui.agenda.EditBusinessProfileDialog
import com.pediturno.servicios.ui.agenda.BusinessProfileTestTags
import com.pediturno.servicios.data.model.CustomThemeColors
import org.junit.Assert.*
import androidx.test.platform.app.InstrumentationRegistry
import com.pediturno.servicios.data.model.BusinessProfile
import com.pediturno.servicios.data.model.ClientItem
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.ui.agenda.ClientDetailDialog
import com.pediturno.servicios.ui.agenda.ClientHistoryUiState
import com.pediturno.servicios.ui.components.LiveStorefrontPreview
import org.junit.Rule
import org.junit.Test
import java.io.File

class Pasada3RegressionTest {
    @get:Rule val compose = createComposeRule()

    @Test fun storefrontIncludesTheSavedLogo() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val image = File(context.cacheDir, "qa-storefront.png")
        try {
            val bitmap = Bitmap.createBitmap(12, 12, Bitmap.Config.ARGB_8888)
            bitmap.eraseColor(android.graphics.Color.GREEN)
            image.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
            bitmap.recycle()
            compose.setContent {
                LiveStorefrontPreview(BusinessProfile(id = "qa", name = "QA logo", slug = "qa", email = "qa@example.invalid", logoUrl = Uri.fromFile(image).toString()))
            }
            compose.onNodeWithContentDescription("Logo de QA logo").assertIsDisplayed()
        } finally { image.delete() }
    }

    @Test fun clientHistoryCanRevealEntriesAfterTheFirstEight() {
        val client = ClientItem(id = "qa-client", name = "QA historial", phone = "5400003333", businessId = "qa")
        val appointments = (1..12).map { index ->
            Appointment(id = "qa-$index", client = client.name, clientPhone = client.phone, serviceId = "qa-service", service = "Servicio $index", dateKey = "2026-11-${index.toString().padStart(2, '0')}", time = "10:00", durationMinutes = 30, priceAtBooking = 100.0, status = AppointmentStatus.Completado, businessId = "qa")
        }
        compose.setContent {
            ClientDetailDialog(client = client, history = ClientHistoryUiState(clientId = client.id, appointments = appointments), onLoadHistory = {}, onUpdateClient = {}, onUploadAvatar = { _, _ -> }, onDeleteClient = {}, onBookAppointmentForClient = {}, onDismiss = {})
        }
        val ninth = "2026-11-09 · 10:00 · Servicio 9 (Completado)"
        compose.onNodeWithText(ninth).assertDoesNotExist()
        compose.onNodeWithText("Ver más turnos (8/12)").performScrollTo().performClick()
        compose.onNodeWithText(ninth).performScrollTo().assertIsDisplayed()
    }
    @Test fun profilePostalAndLocationDraftSurvivesRecreationAndSaves() {
        val restoration = StateRestorationTester(compose)
        var saved: BusinessProfile? = null
        val original = BusinessProfile(id = "qa", name = "QA perfil", slug = "qa-perfil", email = "qa@example.invalid")
        restoration.setContent { EditBusinessProfileDialog(original, false, { profile, _ -> saved = profile }, {}) }
        compose.onNodeWithTag("business_profile_fields").performScrollToNode(hasText("Código postal"))
        compose.onNodeWithText("Código postal").performTextReplacement("1425")
        compose.onNodeWithTag("business_profile_fields").performScrollToNode(hasText("Latitud (-90 a 90)"))
        compose.onNodeWithText("Latitud (-90 a 90)").performTextReplacement("-34.58")
        compose.onNodeWithTag("business_profile_fields").performScrollToNode(hasText("Longitud (-180 a 180)"))
        compose.onNodeWithText("Longitud (-180 a 180)").performTextReplacement("-58.41")
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithTag(BusinessProfileTestTags.SAVE).performClick()
        compose.runOnIdle {
            assertEquals("1425", saved?.address?.postalCode)
            assertEquals(-34.58, saved!!.location!!.lat, 0.0001)
            assertEquals(-58.41, saved!!.location!!.lng, 0.0001)
        }
    }

}
