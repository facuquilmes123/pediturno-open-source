package com.pediturno.servicios.ui.components

import android.content.ContentResolver
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.ManagedActivityResultLauncher
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.FileDownload
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.LaunchedEffect
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import com.pediturno.servicios.data.export.WorkspaceExporter
import com.pediturno.servicios.data.export.AgendaExportSnapshot
import com.pediturno.servicios.data.export.ExportOutcome
import com.pediturno.servicios.data.export.PendingWorkspaceExport
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.ClientItem
import com.pediturno.servicios.data.review.InAppReviewManager
import com.pediturno.servicios.data.review.findActivity
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException

/**
 * Compact, tab-ready export actions. SAF lets the person choose a destination and needs no storage
 * permission. The supplied callback must be the workspace's snackbar/message dispatcher.
 */
/** Register outside lazy/conditional content so recreation cannot lose a pending result. */
@Composable
fun rememberAgendaPdfExportLauncher(
    request: PendingWorkspaceExport<AgendaExportSnapshot>,
    onMessage: (String) -> Unit
): ManagedActivityResultLauncher<String, Uri?> {
    val context = LocalContext.current
    val resolver = context.applicationContext.contentResolver
    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument(WorkspaceExporter.PDF_MIME_TYPE)
    ) { uri ->
        request.finish(uri != null, write = { selected ->
            withContext(Dispatchers.IO) {
                resolver.writeAgendaPdf(requireNotNull(uri), selected.businessName, selected.dateLabel, selected.appointments)
            }
        }) { outcome ->
            onMessage(when (outcome) {
                ExportOutcome.COMPLETED -> "Agenda exportada en PDF."
                ExportOutcome.CANCELLED -> "Exportación cancelada."
                ExportOutcome.SELECTION_LOST -> "La selección cambió. Volvé a iniciar la exportación."
                ExportOutcome.FAILED -> "No se pudo exportar la agenda. Probá elegir otra ubicación."
            })
            if (outcome == ExportOutcome.COMPLETED) {
                InAppReviewManager.getInstance(context).recordPositiveEventAndMaybePrompt(context.findActivity())
            }
        }
    }
    return launcher

}

@Composable
fun AgendaPdfExportAction(
    request: PendingWorkspaceExport<AgendaExportSnapshot>,
    businessName: String,
    dateLabel: String,
    appointments: List<Appointment>,
    onMessage: (String) -> Unit,
    modifier: Modifier = Modifier,
    launcher: ManagedActivityResultLauncher<String, Uri?> = rememberAgendaPdfExportLauncher(request, onMessage)
) {
    val pending by request.pending.collectAsStateWithLifecycle()
    val ready by request.readyFileName.collectAsStateWithLifecycle()
    LaunchedEffect(ready) {
        request.claimPickerLaunch()?.let { name ->
            try { launcher.launch(name) }
            catch (_: Exception) { request.clear(); onMessage("No se pudo abrir el selector de archivos.") }
        }
    }
    OutlinedButton(
        onClick = {
            request.beginPersisted(AgendaExportSnapshot(businessName, dateLabel, appointments.toList()), "agenda-${safeFilePart(dateLabel)}.pdf") {
                onMessage("La exportación no pudo prepararse. Si se interrumpió una anterior, revisá ese archivo antes de repetir.")
            }
        },
        enabled = !pending,
        modifier = modifier
    ) {
        androidx.compose.material3.Icon(Icons.Outlined.FileDownload, contentDescription = null)
        Text(if (pending) "Preparando…" else "Exportar PDF")
    }
}

@Composable
fun rememberClientsCsvExportLauncher(
    request: PendingWorkspaceExport<List<ClientItem>>,
    onMessage: (String) -> Unit
): ManagedActivityResultLauncher<String, Uri?> {
    val context = LocalContext.current
    val resolver = context.applicationContext.contentResolver
    val launcher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.CreateDocument(WorkspaceExporter.CSV_MIME_TYPE)
    ) { uri ->
        request.finish(uri != null, write = { selected ->
            withContext(Dispatchers.IO) { resolver.writeClientsCsv(requireNotNull(uri), selected) }
        }) { outcome ->
            onMessage(when (outcome) {
                ExportOutcome.COMPLETED -> "Clientes exportados en CSV."
                ExportOutcome.CANCELLED -> "Exportación cancelada."
                ExportOutcome.SELECTION_LOST -> "La selección cambió. Volvé a iniciar la exportación."
                ExportOutcome.FAILED -> "No se pudo exportar clientes. Probá elegir otra ubicación."
            })
            if (outcome == ExportOutcome.COMPLETED) {
                InAppReviewManager.getInstance(context).recordPositiveEventAndMaybePrompt(context.findActivity())
            }
        }
    }
    return launcher

}

@Composable
fun ClientsCsvExportAction(
    request: PendingWorkspaceExport<List<ClientItem>>,
    clients: List<ClientItem>,
    onMessage: (String) -> Unit,
    modifier: Modifier = Modifier,
    exportAllowed: Boolean = true,
    launcher: ManagedActivityResultLauncher<String, Uri?> = rememberClientsCsvExportLauncher(request, onMessage)
) {
    val pending by request.pending.collectAsStateWithLifecycle()
    val ready by request.readyFileName.collectAsStateWithLifecycle()
    LaunchedEffect(ready) {
        request.claimPickerLaunch()?.let { name ->
            try { launcher.launch(name) }
            catch (_: Exception) { request.clear(); onMessage("No se pudo abrir el selector de archivos.") }
        }
    }
    OutlinedButton(
        onClick = {
            request.beginPersisted(clients.toList(), "clientes-pediturno.csv") {
                onMessage("La exportación no pudo prepararse. Si se interrumpió una anterior, revisá ese archivo antes de repetir.")
            }
        },
        enabled = !pending && exportAllowed,
        modifier = modifier
    ) {
        androidx.compose.material3.Icon(Icons.Outlined.FileDownload, contentDescription = null)
        Text(if (pending) "Preparando…" else "Exportar CSV")
    }
}

private fun ContentResolver.writeAgendaPdf(
    uri: Uri,
    businessName: String,
    dateLabel: String,
    appointments: List<Appointment>
) {
    openOutputStream(uri)?.use { output ->
        WorkspaceExporter.writeAgendaPdf(output, businessName, dateLabel, appointments)
    } ?: throw IOException("No writable destination")
}

private fun ContentResolver.writeClientsCsv(uri: Uri, clients: List<ClientItem>) {
    openOutputStream(uri)?.use { output ->
        WorkspaceExporter.writeClientsCsv(output, clients)
    } ?: throw IOException("No writable destination")
}

private fun safeFilePart(value: String): String = value
    .lowercase()
    .replace(Regex("[^a-z0-9]+"), "-")
    .trim('-')
    .ifBlank { "agenda" }
