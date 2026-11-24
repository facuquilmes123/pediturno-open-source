package com.pediturno.servicios.data.export

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import java.io.File
import java.security.KeyStore
import java.security.MessageDigest
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
import kotlinx.serialization.KSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long
import kotlinx.serialization.json.put

/** Short-lived encrypted snapshot, scoped to an authenticated account. Never backed up/logged. */
class EncryptedExportPayloadStore<T : Any>(
    context: Context,
    private val owner: String,
    kind: String,
    private val serializer: KSerializer<T>,
    private val currentOwner: () -> String?,
    private val now: () -> Long = System::currentTimeMillis
) : ExportPayloadStore<T> {
    private val json = Json { ignoreUnknownKeys = false }
    private val aad = "pediturno-pending-export-v1:$owner:$kind".toByteArray()
    private val folder = File(context.applicationContext.noBackupFilesDir, "pending-exports").apply { mkdirs() }
    private val name = MessageDigest.getInstance("SHA-256").digest(aad).joinToString("") { "%02x".format(it) }
    private val file = AtomicFile(File(folder, "$name.enc"))
    private val marker = File(folder, "$name.writing")

    @Synchronized override fun save(value: T) {
        check(owner.isNotBlank() && currentOwner() == owner)
        val plain = buildJsonObject {
            put("owner", owner)
            put("createdAt", now())
            put("value", json.encodeToJsonElement(serializer, value))
        }.toString().toByteArray()
        try {
            check(plain.size <= 4 * 1024 * 1024)
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            cipher.updateAAD(aad)
            val bytes = cipher.iv + cipher.doFinal(plain)
            check(currentOwner() == owner)
            val output = file.startWrite()
            try { output.write(bytes); file.finishWrite(output) }
            catch (error: Exception) { file.failWrite(output); throw error }
            marker.delete()
        } finally { plain.fill(0) }
    }

    @Synchronized override fun load(): T? = try {
        if (currentOwner() != owner) null else {
            val bytes = file.openRead().use { it.readBytes() }
            check(bytes.size in 29..(5 * 1024 * 1024))
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
            cipher.updateAAD(aad)
            val plain = cipher.doFinal(bytes.copyOfRange(12, bytes.size))
            try {
                val payload = json.parseToJsonElement(plain.decodeToString()).jsonObject
                val age = now() - payload.getValue("createdAt").jsonPrimitive.long
                check(age in 0..3_600_000 && payload.getValue("owner").jsonPrimitive.content == owner)
                json.decodeFromJsonElement(serializer, payload.getValue("value"))
            } finally { plain.fill(0) }
        }
    } catch (_: Exception) { clear(); null }

    @Synchronized override fun exists() = file.baseFile.exists()
    @Synchronized override fun markWriting() {
        check(currentOwner() == owner)
        marker.writeText("1")
    }
    @Synchronized override fun interruptedWrite() = marker.exists()
    @Synchronized override fun clear() { file.delete(); marker.delete() }

    private fun key(): SecretKey = synchronized(KEY_LOCK) {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(KEY_ALIAS, null) as? SecretKey) ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").apply {
            init(KeyGenParameterSpec.Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
        }.generateKey()
    }

    private companion object {
        const val KEY_ALIAS = "pediturno.pending-export.v1"
        val KEY_LOCK = Any()
    }
}
