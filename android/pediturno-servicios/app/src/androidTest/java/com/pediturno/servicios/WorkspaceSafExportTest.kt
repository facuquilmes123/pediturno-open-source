package com.pediturno.servicios

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.graphics.pdf.PdfRenderer
import android.os.ParcelFileDescriptor
import androidx.activity.compose.LocalActivityResultRegistryOwner
import androidx.activity.result.ActivityResultRegistry
import androidx.activity.result.ActivityResultRegistryOwner
import androidx.activity.result.contract.ActivityResultContract
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.core.app.ActivityOptionsCompat
import androidx.test.platform.app.InstrumentationRegistry
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.AppointmentStatus
import com.pediturno.servicios.data.model.ClientItem
import com.pediturno.servicios.ui.components.AgendaPdfExportAction
import com.pediturno.servicios.ui.components.ClientsCsvExportAction
import com.pediturno.servicios.ui.components.rememberAgendaPdfExportLauncher
import com.pediturno.servicios.ui.components.rememberClientsCsvExportLauncher
import com.pediturno.servicios.data.export.AgendaExportSnapshot
import com.pediturno.servicios.data.export.PendingWorkspaceExport
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import org.junit.After
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import java.io.File

class WorkspaceSafExportTest {
 @get:Rule val compose = createComposeRule()
 private val exportScope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
 private val csvRequest = PendingWorkspaceExport<List<ClientItem>>(exportScope)
 private val pdfRequest = PendingWorkspaceExport<AgendaExportSnapshot>(exportScope)
 @After fun stopExports() { exportScope.cancel() }
 private class Destination : ActivityResultRegistry(), ActivityResultRegistryOwner {
  override val activityResultRegistry: ActivityResultRegistry get() = this
  var pending: Int? = null
  override fun <I,O> onLaunch(requestCode: Int, contract: ActivityResultContract<I,O>, input: I, options: ActivityOptionsCompat?) { pending=requestCode }
  fun finish(uri: Uri?) { val code=requireNotNull(pending);pending=null;dispatchResult(code,if(uri==null) Activity.RESULT_CANCELED else Activity.RESULT_OK,uri?.let {Intent().setData(it)}) }
 }
 private fun target(name: String) = File(InstrumentationRegistry.getInstrumentation().targetContext.cacheDir,name).also { it.delete() }
 private fun client(name: String) = ClientItem(id=name,name=name,phone="+540000333333",email="qa@example.invalid",businessId="qa")
 private fun appointments(count: Int) = (1..count).map { Appointment(id="$it",client="QA Original $it",clientPhone="540000333333",serviceId="qa",service="QA servicio",dateKey="2026-10-29",time="10:00",durationMinutes=30,priceAtBooking=100.0,status=AppointmentStatus.Confirmado,businessId="qa") }

 @Test fun csvUsesOriginalCompleteSelectionAndEscapesFormulas() {
  val registry=Destination();val messages=mutableListOf<String>();val clients=mutableStateOf(listOf(client("=1+1"),client("QA, \"dos\"")));val file=target("qa-selection.csv")
  try {
   compose.setContent { CompositionLocalProvider(LocalActivityResultRegistryOwner provides registry) { ClientsCsvExportAction(csvRequest, clients.value,{messages+=it}) } }
   compose.onNodeWithText("Exportar CSV").performClick();compose.waitUntil(10000) {registry.pending != null}
   compose.runOnIdle { clients.value=listOf(client("QA Posterior"));registry.finish(Uri.fromFile(file)) }
   compose.waitUntil(10000) { messages.isNotEmpty() }
   val text=file.readText();assertTrue(text.contains("'=1+1"));assertTrue(text.contains("QA, \"\"dos\"\""));assertFalse(text.contains("QA Posterior"));assertTrue(messages.single().contains("exportados"))
  } finally { file.delete() }
 }
 @Test fun pdfKeepsOriginalPaginatedSelection() {
  val registry=Destination();val messages=mutableListOf<String>();val rows=mutableStateOf(appointments(54));val file=target("qa-selection.pdf")
  try {
   compose.setContent { CompositionLocalProvider(LocalActivityResultRegistryOwner provides registry) { AgendaPdfExportAction(pdfRequest, "QA Original","2026-10-29",rows.value,{messages+=it}) } }
   compose.onNodeWithText("Exportar PDF").performClick();compose.waitUntil(10000) {registry.pending != null};compose.runOnIdle {rows.value=appointments(1);registry.finish(Uri.fromFile(file))}
   compose.waitUntil(10000) {messages.isNotEmpty()}
   ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY).use {fd->PdfRenderer(fd).use {pdf->assertEquals(2,pdf.pageCount)}}
   assertEquals("Agenda exportada en PDF.",messages.single())
  } finally {file.delete()}
 }
 @Test fun cancelPdfDoesNotReportSuccess() {
  val registry=Destination();val messages=mutableListOf<String>()
  compose.setContent {CompositionLocalProvider(LocalActivityResultRegistryOwner provides registry) {AgendaPdfExportAction(pdfRequest, "QA","2026-10-29",appointments(1),{messages+=it})}}
  compose.onNodeWithText("Exportar PDF").performClick();compose.waitUntil(10000) {registry.pending != null};compose.runOnIdle {registry.finish(null)}
  compose.waitUntil(10000) {messages.isNotEmpty()};assertEquals("Exportación cancelada.",messages.single())
 }
 @Test fun unwritableCsvDestinationReportsFailure() {
  val registry=Destination();val messages=mutableListOf<String>()
  compose.setContent {CompositionLocalProvider(LocalActivityResultRegistryOwner provides registry) {ClientsCsvExportAction(csvRequest, listOf(client("QA")),{messages+=it})}}
  compose.onNodeWithText("Exportar CSV").performClick();compose.waitUntil(10000) {registry.pending != null};compose.runOnIdle {registry.finish(Uri.parse("content://com.pediturno.qa.unwritable/export.csv"))}
  compose.waitUntil(10000) {messages.isNotEmpty()};assertTrue(messages.single().startsWith("No se pudo exportar"))
 }
 private fun recreateExport(pdf: Boolean) {
  val registry=Destination();val messages=mutableListOf<String>();val restoration=StateRestorationTester(compose);val file=target(if(pdf) "qa-recreate.pdf" else "qa-recreate.csv")
  try {
   restoration.setContent {CompositionLocalProvider(LocalActivityResultRegistryOwner provides registry) {if(pdf) AgendaPdfExportAction(pdfRequest, "QA","2026-10-29",appointments(1),{messages+=it}) else ClientsCsvExportAction(csvRequest, listOf(client("QA")),{messages+=it})}}
   compose.onNodeWithText(if(pdf) "Exportar PDF" else "Exportar CSV").performClick();compose.waitUntil(10000) {registry.pending != null};restoration.emulateSavedInstanceStateRestore();compose.runOnIdle {registry.finish(Uri.fromFile(file))}
   compose.waitUntil(10000) {messages.isNotEmpty()}
   assertEquals(if(pdf) "Agenda exportada en PDF." else "Clientes exportados en CSV.", messages.single())
   assertTrue(file.length() > 0)
   if(pdf) ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY).use {fd->PdfRenderer(fd).use {renderer->assertEquals(1,renderer.pageCount)}}
   else assertTrue(file.readText().contains("QA"))
  } finally {file.delete()}
 }
 @Test fun recreatedPdfPreservesOriginalSelection() = recreateExport(true)
 @Test fun recreatedCsvPreservesOriginalSelection() = recreateExport(false)

 private fun resultWhileButtonAbsent(pdf: Boolean) {
  val registry=Destination();val messages=mutableListOf<String>();val visible=mutableStateOf(true)
  val restoration=StateRestorationTester(compose);val file=target(if(pdf) "qa-hidden-recreate.pdf" else "qa-hidden-recreate.csv")
  try {
   restoration.setContent {
    CompositionLocalProvider(LocalActivityResultRegistryOwner provides registry) {
     // Production registers here, outside lazy items/loading branches.
     if(pdf) {
      val launcher=rememberAgendaPdfExportLauncher(pdfRequest) {messages+=it}
      if(visible.value) AgendaPdfExportAction(pdfRequest,"QA Original","2026-10-29",appointments(1),{messages+=it},launcher=launcher)
     } else {
      val launcher=rememberClientsCsvExportLauncher(csvRequest) {messages+=it}
      if(visible.value) ClientsCsvExportAction(csvRequest,listOf(client("QA Original")),{messages+=it},launcher=launcher)
     }
    }
   }
   compose.onNodeWithText(if(pdf) "Exportar PDF" else "Exportar CSV").performClick();compose.waitUntil(10000) {registry.pending != null}
   compose.runOnIdle {visible.value=false}
   restoration.emulateSavedInstanceStateRestore()
   compose.runOnIdle {registry.finish(Uri.fromFile(file))}
   compose.waitUntil(10000) {messages.isNotEmpty()}
   assertEquals(if(pdf) "Agenda exportada en PDF." else "Clientes exportados en CSV.",messages.single())
   assertTrue(file.length()>0)
   if(pdf) ParcelFileDescriptor.open(file,ParcelFileDescriptor.MODE_READ_ONLY).use {fd->PdfRenderer(fd).use {renderer->assertEquals(1,renderer.pageCount)}}
   else assertTrue(file.readText().contains("QA Original"))
  } finally {file.delete()}
 }
 @Test fun hiddenRecreatedPdfStillReceivesItsDestination() = resultWhileButtonAbsent(true)
 @Test fun hiddenRecreatedCsvStillReceivesItsDestination() = resultWhileButtonAbsent(false)
}
