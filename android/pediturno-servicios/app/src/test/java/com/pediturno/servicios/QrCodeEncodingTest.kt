package com.pediturno.servicios

import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.MultiFormatReader
import com.google.zxing.Result
import com.google.zxing.common.BitMatrix
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.LuminanceSource
import com.google.zxing.qrcode.QRCodeWriter
import org.junit.Assert.assertEquals
import org.junit.Test

class QrCodeEncodingTest {
    @Test fun `public booking URL is encoded as a decodable QR`() {
        val expected = "https://pediturno.com/barberia-prueba"
        val matrix = QRCodeWriter().encode(expected, BarcodeFormat.QR_CODE, 256, 256)
        val decoded: Result = MultiFormatReader().decode(BinaryBitmap(HybridBinarizer(MatrixLuminanceSource(matrix))))
        assertEquals(expected, decoded.text)
    }
}

private class MatrixLuminanceSource(private val matrix: BitMatrix) : LuminanceSource(matrix.width, matrix.height) {
    override fun getRow(y: Int, row: ByteArray?): ByteArray = ByteArray(width) { x -> if (matrix[x, y]) 0 else 0xFF.toByte() }
    override fun getMatrix(): ByteArray = ByteArray(width * height) { i -> if (matrix[i % width, i / width]) 0 else 0xFF.toByte() }
}
