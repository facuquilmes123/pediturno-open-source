package com.pediturno.servicios

import androidx.test.platform.app.InstrumentationRegistry
import com.pediturno.servicios.data.export.EncryptedExportPayloadStore
import kotlinx.serialization.builtins.serializer
import org.junit.Assert.*
import org.junit.Test
import java.io.File

class EncryptedExportStoreTest {
    private val context = InstrumentationRegistry.getInstrumentation().targetContext

    @Test fun encryptedSnapshotSurvivesNewInstanceButRejectsDifferentAccount() {
        var owner: String? = "qa-export-owner"
        fun store() = EncryptedExportPayloadStore(context, "qa-export-owner", "instrumented", String.serializer(), { owner })
        val first = store()
        try {
            first.save("QA private original selection")
            assertTrue(first.exists())
            val disk = File(context.noBackupFilesDir, "pending-exports").listFiles()!!.filter { it.extension == "enc" }
            assertTrue(disk.isNotEmpty())
            assertFalse(disk.any { it.readBytes().toString(Charsets.ISO_8859_1).contains("QA private original selection") })
            assertEquals("QA private original selection", store().load())
            owner = "another-owner"
            assertNull(store().load())
            try { store().save("must reject"); fail("Account switch accepted") } catch (_: IllegalStateException) { }
            owner = "qa-export-owner"
            assertEquals("QA private original selection", store().load())
        } finally { first.clear() }
    }

    @Test fun expiredOrTamperedCiphertextIsRejectedAndRemoved() {
        var time = 1_000_000L
        val store = EncryptedExportPayloadStore(context, "qa-expiry", "instrumented", String.serializer(), { "qa-expiry" }, { time })
        try {
            store.save("QA expiry")
            time += 3_600_001
            assertNull(store.load())
            assertFalse(store.exists())
            store.save("QA corruption")
            val file = File(context.noBackupFilesDir, "pending-exports").listFiles()!!.single { it.extension == "enc" }
            val bytes = file.readBytes(); bytes[bytes.lastIndex] = (bytes.last().toInt() xor 1).toByte(); file.writeBytes(bytes)
            assertNull(store.load())
            assertFalse(store.exists())
        } finally { store.clear() }
    }
}
