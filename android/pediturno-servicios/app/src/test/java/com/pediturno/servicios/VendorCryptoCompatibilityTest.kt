package com.pediturno.servicios

import com.google.crypto.tink.BinaryKeysetReader
import com.google.crypto.tink.BinaryKeysetWriter
import com.google.crypto.tink.CleartextKeysetHandle
import com.google.crypto.tink.KeysetHandle
import com.google.crypto.tink.Mac
import com.google.crypto.tink.mac.MacConfig
import com.google.crypto.tink.mac.MacKeyTemplates
import com.google.protobuf.Any as LiteAny
import com.google.protobuf.CodedOutputStream
import com.google.protobuf.InvalidProtocolBufferException
import com.google.protobuf.WireFormat
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.GeneralSecurityException
import java.security.MessageDigest
import org.junit.Assert.assertThrows
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class VendorCryptoCompatibilityTest {
    @Test
    fun legacyTinkKeysetStillWorksBesidePatchedLiteRuntime() {
        // Tink 1.5 uses shaded protobuf: this verifies coexistence, not its parser's CVE status.
        MacConfig.register()
        val original = KeysetHandle.generateNew(MacKeyTemplates.HMAC_SHA256_128BITTAG)
        // Ephemeral test keys stay in memory and are never logged or persisted.
        val encoded = ByteArrayOutputStream().use { output ->
            CleartextKeysetHandle.write(original, BinaryKeysetWriter.withOutputStream(output))
            output.toByteArray()
        }
        val restored = CleartextKeysetHandle.read(BinaryKeysetReader.withBytes(encoded))
        val payload = "PediTurno vendor compatibility fixture".toByteArray(Charsets.UTF_8)
        val originalMac = original.getPrimitive(Mac::class.java)
        val restoredMac = restored.getPrimitive(Mac::class.java)
        val tag = originalMac.computeMac(payload)
        assertTrue("Keyset round-trip changed MAC", MessageDigest.isEqual(tag, restoredMac.computeMac(payload)))
        restoredMac.verifyMac(tag, payload)
        val invalidTag = tag.copyOf().also { it[0] = (it[0].toInt() xor 1).toByte() }
        assertThrows(GeneralSecurityException::class.java) { restoredMac.verifyMac(invalidTag, payload) }
        encoded.fill(0)
    }

    @Test
    fun deeplyNestedUnknownGroupsRespectParserRecursionLimit() {
        // Upstream's CVE regression uses start-only groups in the unshaded Lite runtime.
        // Both inputs stay below 101 bytes; 99 levels must fail as malformed, not as too deep.
        val readers: List<(ByteArray) -> LiteAny> = listOf(
            { LiteAny.parseFrom(it) },
            { LiteAny.parseFrom(ByteArrayInputStream(it)) },
        )
        val nestingError = "too many levels of nesting"
        readers.forEach { read ->
            val atLimit = assertThrows(InvalidProtocolBufferException::class.java) { read(nestedGroups(100)) }
            assertTrue(atLimit.message.orEmpty().contains(nestingError))
            val belowLimit = assertThrows(InvalidProtocolBufferException::class.java) { read(nestedGroups(99)) }
            assertFalse(belowLimit.message.orEmpty().contains(nestingError))
        }
    }

    private fun nestedGroups(levels: Int): ByteArray = ByteArrayOutputStream().use { output ->
        val coded = CodedOutputStream.newInstance(output)
        repeat(levels) { coded.writeTag(3, WireFormat.WIRETYPE_START_GROUP) }
        coded.flush()
        output.toByteArray()
    }
}
