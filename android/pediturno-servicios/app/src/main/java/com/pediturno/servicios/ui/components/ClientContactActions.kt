package com.pediturno.servicios.ui.components

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Call
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.pediturno.servicios.R
import com.pediturno.servicios.core.theme.*

/** Each complete action wraps to another row instead of squeezing the last label vertically. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun ClientContactActions(onWhatsApp: () -> Unit, onCall: () -> Unit, onSchedule: () -> Unit, modifier: Modifier = Modifier) {
    FlowRow(modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = onWhatsApp, shape = RoundedCornerShape(8.dp),
            modifier = Modifier.heightIn(min = 48.dp), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)) {
            Image(painterResource(R.drawable.ic_whatsapp), contentDescription = null, modifier = Modifier.size(16.dp))
            Spacer(Modifier.width(4.dp))
            Text("WhatsApp", color = EmeraldConfirmed, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, softWrap = false)
        }
        OutlinedButton(onClick = onCall, shape = RoundedCornerShape(8.dp),
            modifier = Modifier.heightIn(min = 48.dp), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 4.dp)) {
            Icon(Icons.Outlined.Call, contentDescription = null, tint = TextMediumEmphasis, modifier = Modifier.size(13.dp))
            Spacer(Modifier.width(4.dp))
            Text("Llamar", color = TextMediumEmphasis, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, softWrap = false)
        }
        Button(onClick = onSchedule, colors = ButtonDefaults.buttonColors(containerColor = MintPrimary, contentColor = OnMintPrimary),
            shape = RoundedCornerShape(8.dp), modifier = Modifier.heightIn(min = 48.dp),
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp)) {
            Text("Agendar Turno", fontSize = 11.sp, fontWeight = FontWeight.Bold, color = OnMintPrimary, maxLines = 1, softWrap = false)
        }
    }
}
