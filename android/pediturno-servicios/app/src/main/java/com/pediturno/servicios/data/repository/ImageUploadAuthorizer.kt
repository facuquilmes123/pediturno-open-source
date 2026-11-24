package com.pediturno.servicios.data.repository

import com.pediturno.servicios.core.network.RequestOwner
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.time.Instant
import java.util.UUID

data class ImageUploadPermit(val permitId: String, val storagePath: String)

/** A denied or ambiguous POST never falls back to an unrestricted Storage path. */
class ImageUploadAuthorizer(
    private val baseUrl: String,
    client: OkHttpClient,
    private val ownerProvider: () -> String?,
    private val attestationProvider: suspend () -> String? = { null },
    private val requireAttestation: Boolean = true,
    private val now: () -> Instant = Instant::now
) {
    private val http = client.newBuilder().retryOnConnectionFailure(false)
        .followRedirects(false).followSslRedirects(false).build()

    suspend fun authorize(owner: String, category: ImageCategory, byteSize: Int): ImageUploadPermit = withContext(Dispatchers.IO) {
        fun checkOwner() {
            if (owner.isBlank() || owner != ownerProvider()) throw IOException("Tu sesión cambió. Volvé a seleccionar la imagen.")
        }
        checkOwner()
        require(byteSize in 1..2 * 1024 * 1024) { "La imagen supera el tamaño permitido." }
        val attestation = attestationProvider()
        if (requireAttestation && attestation.isNullOrBlank()) throw IOException("No pudimos verificar la aplicación. Intentá nuevamente.")
        ensureActive()
        checkOwner()
        val payload = buildJsonObject {
            put("category", category.directory); put("contentType", "image/jpeg"); put("byteSize", byteSize)
        }
        val request = Request.Builder().url(baseUrl.trimEnd('/') + "/owner/images/authorize")
            .tag(RequestOwner::class.java, RequestOwner(owner))
            .header("X-Idempotency-Key", UUID.randomUUID().toString())
            .apply { attestation?.let { header("X-Firebase-AppCheck", it) } }
            .post(payload.toString().toRequestBody("application/json; charset=utf-8".toMediaType())).build()
        http.newCall(request).execute().use { response ->
            ensureActive()
            checkOwner()
            if (!response.isSuccessful) throw IOException(if (response.code == 429)
                "Alcanzaste el límite temporal de imágenes. Esperá unos minutos antes de intentar otra vez."
                else "No se pudo autorizar la imagen. Volvé a seleccionarla.")
            val body = response.body ?: throw IOException("No se recibió el permiso de imagen.")
            // The small acknowledgement must not allocate an unbounded response.
            val source = body.source()
            if (source.request(16 * 1024 + 1L)) throw IOException("Permiso de imagen inválido.")
            val data = try { Json.parseToJsonElement(source.readUtf8()).jsonObject } catch (_: Exception) {
                throw IOException("Permiso de imagen inválido.")
            }
            val id = data["permitId"]?.jsonPrimitive?.content.orEmpty()
            val path = data["storagePath"]?.jsonPrimitive?.content.orEmpty()
            val expires = try { Instant.parse(data["expiresAt"]?.jsonPrimitive?.content) } catch (_: Exception) { null }
            if (!id.matches(Regex("[a-f0-9]{64}")) || path != "businesses/$owner/${category.directory}/g_$id.jpg" ||
                expires == null || !expires.isAfter(now())) throw IOException("El permiso de imagen no es válido o venció. Volvé a seleccionarla.")
            checkOwner()
            ImageUploadPermit(id, path)
        }
    }
}
