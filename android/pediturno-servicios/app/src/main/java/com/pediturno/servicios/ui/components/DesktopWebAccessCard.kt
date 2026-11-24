package com.pediturno.servicios.ui.components

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Computer
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis

// Public, fixed login address. Never copy a session, token or customer URL.
const val DESKTOP_WEB_LOGIN_URL = "https://pediturno.com/?login=1"

fun copyDesktopWebAddress(context: Context) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText("Acceso web de Pediturno", DESKTOP_WEB_LOGIN_URL))
}

@Composable
fun DesktopWebAccessCard(onCopyAddress: () -> Unit, modifier: Modifier = Modifier) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(SurfaceLevel1, RoundedCornerShape(18.dp))
            .border(1.dp, BorderHairline, RoundedCornerShape(18.dp))
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Icon(Icons.Outlined.Computer, contentDescription = null, tint = MintPrimary, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(10.dp))
            Text("También desde tu PC", color = TextHighEmphasis, fontSize = 16.sp, fontWeight = FontWeight.Bold)
        }
        Text(
            "Entrá a pediturno.com con la misma cuenta para gestionar tu agenda, clientes, servicios y horarios desde el navegador.",
            color = TextMediumEmphasis,
            fontSize = 13.sp
        )
        Text("pediturno.com", color = MintPrimary, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
        Text(
            "Usá el mismo método de acceso: Google o correo y contraseña. No necesitás crear otra cuenta.",
            color = TextMediumEmphasis,
            fontSize = 12.sp
        )
        OutlinedButton(onClick = onCopyAddress, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            Text("Copiar dirección web", color = MintPrimary)
        }
    }
}
