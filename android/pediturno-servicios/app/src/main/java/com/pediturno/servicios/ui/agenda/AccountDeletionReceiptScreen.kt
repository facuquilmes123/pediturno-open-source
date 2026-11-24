package com.pediturno.servicios.ui.agenda

import android.content.Intent
import androidx.core.net.toUri
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

@Composable
fun AccountDeletionReceiptScreen(ticket: String, onContinue: () -> Unit) {
    val context = LocalContext.current
    BackHandler(onBack = onContinue)
    Column(
        modifier = Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(20.dp)
    ) {
        Text("Solicitud de baja registrada", style = MaterialTheme.typography.headlineMedium)
        Text("La solicitud quedó registrada y tu sesión se cerró. Guardá este número para consultar su estado con soporte.")
        SelectionContainer { Text(ticket, style = MaterialTheme.typography.titleMedium) }
        Text("La baja de los datos operativos se procesa en un máximo de 7 días desde la verificación de titularidad. Los registros financieros necesarios pueden conservarse con acceso restringido mientras se resuelven las operaciones pendientes.")
        Text("Esta solicitud no cancela una suscripción de Google Play.")
        OutlinedButton(
            onClick = { context.startActivity(Intent(Intent.ACTION_VIEW, "https://play.google.com/store/account/subscriptions".toUri())) },
            modifier = Modifier.fillMaxWidth()
        ) { Text("Gestionar suscripción en Google Play") }
        Button(onClick = onContinue, modifier = Modifier.fillMaxWidth()) { Text("Volver al ingreso") }
    }
}
