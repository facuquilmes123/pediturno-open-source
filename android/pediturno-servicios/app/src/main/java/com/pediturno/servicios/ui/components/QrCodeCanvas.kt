package com.pediturno.servicios.ui.components

import android.graphics.Bitmap
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.graphics.createBitmap
import androidx.core.graphics.set
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.pediturno.servicios.core.theme.BorderHairline

/** Standards-compliant QR image. It deliberately contains no logo overlay because that can reduce decoding reliability. */
@Composable
fun QrCodeCanvas(content: String, modifier: Modifier = Modifier, size: Dp = 156.dp) {
    val bitmap = remember(content) { content.takeIf { it.isNotBlank() }?.let(::createQrBitmap) }
    Box(
        modifier = modifier
            .size(size)
            .clip(RoundedCornerShape(18.dp))
            .background(Color.White)
            .border(1.dp, BorderHairline, RoundedCornerShape(18.dp))
            .padding(12.dp),
        contentAlignment = Alignment.Center
    ) {
        bitmap?.let {
            Image(
                bitmap = it.asImageBitmap(),
                contentDescription = "Código QR del enlace público",
                modifier = Modifier.size(size - 24.dp)
            )
        }
    }
}

internal fun createQrBitmap(content: String): Bitmap {
    val matrix = QRCodeWriter().encode(
        content,
        BarcodeFormat.QR_CODE,
        512,
        512,
        mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M)
    )
    return createBitmap(matrix.width, matrix.height, Bitmap.Config.ARGB_8888).also { bitmap ->
        for (y in 0 until matrix.height) {
            for (x in 0 until matrix.width) {
                bitmap[x, y] = if (matrix[x, y]) android.graphics.Color.BLACK else android.graphics.Color.WHITE
            }
        }
    }
}
