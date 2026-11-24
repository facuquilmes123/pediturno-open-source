package com.pediturno.servicios

import android.app.Activity
import android.content.Intent
import android.net.Uri
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextReplacement
import androidx.compose.ui.test.assertIsDisplayed
import androidx.core.app.ActivityOptionsCompat
import com.pediturno.servicios.data.model.ServiceItem
import com.pediturno.servicios.data.model.ClientItem
import com.pediturno.servicios.ui.agenda.CreateClientDialog
import com.pediturno.servicios.ui.agenda.ClientDetailDialog
import com.pediturno.servicios.ui.agenda.ClientHistoryUiState
import com.pediturno.servicios.ui.agenda.ClientDetailTestTags
import com.pediturno.servicios.ui.agenda.WorkspaceTestTags
import com.pediturno.servicios.ui.agenda.SaveServiceDialog
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Rule
import org.junit.Test

class DeferredPhotoSelectionTest {
    @get:Rule val compose = createComposeRule()
    private val selected = Uri.parse("content://qa.invalid/local-photo")
    private val owner = object : ActivityResultRegistryOwner {
        override val activityResultRegistry = object : ActivityResultRegistry() {
            override fun <I,O> onLaunch(requestCode: Int, contract: ActivityResultContract<I,O>, input: I, options: ActivityOptionsCompat?) {
                dispatchResult(requestCode, Activity.RESULT_OK, Intent().setData(selected))
            }
        }
    }

    @Test fun servicePhotoWaitsForSaveAndSurvivesRecreation() {
        var uploads = 0
        var completion: ((String) -> Unit)? = null
        val saved = mutableListOf<String?>()
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            CompositionLocalProvider(LocalActivityResultRegistryOwner provides owner) {
                SaveServiceDialog(ServiceItem("service", "QA service", 30, 900.0, businessId="qa"), false, null,
                    onDismiss={}, onUploadImage={ uri, callback ->
                        assertEquals(selected,uri); uploads++;completion=callback
                    },onConfirm={ _,_,_,_,photo -> saved += photo })
            }
        }
        compose.onNodeWithText("Agregar foto").performScrollTo().performClick()
        compose.runOnIdle { assertEquals("Selection is local until Save",0,uploads) }
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithContentDescription("Foto del servicio").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Guardar").performClick()
        restoration.emulateSavedInstanceStateRestore() // completion after another recreation
        compose.runOnIdle {
            assertEquals(1,uploads); assertEquals(0,saved.size); assertNotNull(completion)
            completion!!.invoke("https://qa.invalid/uploaded.png")
            assertEquals(listOf("https://qa.invalid/uploaded.png"),saved)
        }
    }

    @Test fun cancelledServicePhotoDoesNotUploadOrSave() {
        var uploads=0;var saves=0;var dismissals=0
        compose.setContent {
            CompositionLocalProvider(LocalActivityResultRegistryOwner provides owner) {
                SaveServiceDialog(ServiceItem("service","QA service",30,900.0,businessId="qa"),false,null,
                    onDismiss={dismissals++},onUploadImage={_,_->uploads++},onConfirm={_,_,_,_,_->saves++})
            }
        }
        compose.onNodeWithText("Agregar foto").performScrollTo().performClick()
        compose.onNodeWithText("Cancelar").performClick()
        compose.runOnIdle { assertEquals(0,uploads);assertEquals(0,saves);assertEquals(1,dismissals) }
    }

    @Test fun newClientPhotoAndFieldsSurviveRecreationBeforeOneSave() {
        var uploads=0;var completion:((String)->Unit)?=null
        val saved=mutableListOf<List<String?>>()
        val restoration=StateRestorationTester(compose)
        restoration.setContent {
            CompositionLocalProvider(LocalActivityResultRegistryOwner provides owner) {
                CreateClientDialog(false,null,onDismiss={},onUploadAvatar={uri,callback->
                    assertEquals(selected,uri);uploads++;completion=callback
                },onConfirm={name,phone,email,_,photo->saved+=listOf(name,phone,email,photo)})
            }
        }
        compose.onNodeWithTag(WorkspaceTestTags.CLIENT_NAME).performTextReplacement("QA client")
        compose.onNodeWithTag(WorkspaceTestTags.CLIENT_PHONE).performTextReplacement("123456")
        compose.onNodeWithText("Agregar foto del cliente").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(0,uploads) }
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithContentDescription("Foto del cliente").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Registrar").performClick()
        restoration.emulateSavedInstanceStateRestore()
        compose.runOnIdle {
            assertEquals(1,uploads);assertEquals(0,saved.size)
            completion!!.invoke("https://qa.invalid/client.png")
            assertEquals(listOf(listOf("QA client","123456","","https://qa.invalid/client.png")),saved)
        }
    }

    @Test fun editedClientPhotoSurvivesRecreationAndUploadsOnlyOnSave() {
        var uploads=0;var completion:((String)->Unit)?=null
        val saved=mutableListOf<ClientItem>()
        val restoration=StateRestorationTester(compose)
        restoration.setContent {
            CompositionLocalProvider(LocalActivityResultRegistryOwner provides owner) {
                ClientDetailDialog(ClientItem("client","QA client","123456",businessId="qa"),
                    ClientHistoryUiState(clientId="client"),onLoadHistory={},onUpdateClient={saved+=it},
                    onUploadAvatar={uri,callback->assertEquals(selected,uri);uploads++;completion=callback},
                    onDeleteClient={},onBookAppointmentForClient={},onDismiss={})
            }
        }
        compose.onNodeWithTag(ClientDetailTestTags.EDIT).performClick()
        compose.onNodeWithText("Agregar foto").performScrollTo().performClick()
        compose.runOnIdle { assertEquals(0,uploads) }
        restoration.emulateSavedInstanceStateRestore()
        compose.onNodeWithContentDescription("Foto seleccionada del cliente").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(ClientDetailTestTags.SAVE).performClick()
        restoration.emulateSavedInstanceStateRestore()
        compose.runOnIdle {
            assertEquals(1,uploads);assertEquals(0,saved.size)
            completion!!.invoke("https://qa.invalid/client.png")
            assertEquals("https://qa.invalid/client.png",saved.single().avatarUrl)
            assertEquals("client",saved.single().id)
        }
    }

    @Test fun cancellingNewClientPhotoDoesNotUpload() {
        var uploads=0;var saves=0
        compose.setContent {
            CompositionLocalProvider(LocalActivityResultRegistryOwner provides owner) {
                CreateClientDialog(false,null,onDismiss={},onUploadAvatar={_,_->uploads++},onConfirm={_,_,_,_,_->saves++})
            }
        }
        compose.onNodeWithText("Agregar foto del cliente").performScrollTo().performClick()
        compose.onNodeWithText("Cancelar").performClick()
        compose.runOnIdle { assertEquals(0,uploads);assertEquals(0,saves) }
    }
}
