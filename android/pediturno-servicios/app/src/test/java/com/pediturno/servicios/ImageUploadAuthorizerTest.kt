package com.pediturno.servicios

import com.pediturno.servicios.core.network.AuthInterceptor
import com.pediturno.servicios.data.repository.ImageUploadAuthorizer
import com.pediturno.servicios.data.repository.ImageCategory
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException
import java.time.Instant
import okio.Buffer

class ImageUploadAuthorizerTest {
    private val id = "a".repeat(64)
    private val clock = Instant.parse("2026-11-03T00:00:00Z")
    private fun payload(path: String = "businesses/owner/logos/g_$id.jpg", expires: String = "2026-11-03T00:10:00Z") =
        """{"permitId":"$id","storagePath":"$path","expiresAt":"$expires"}"""
    private fun response(request: Request, body: String, code: Int = 201) = Response.Builder()
        .request(request).protocol(Protocol.HTTP_1_1).code(code).message("QA").body(body.toResponseBody()).build()

    @Test fun `sends only scope size and type with a unique key and limited use token`() = runBlocking {
        var calls = 0
        val client = OkHttpClient.Builder().addInterceptor(AuthInterceptor({ "synthetic" }, { "cached" }, { "owner" }))
            .addInterceptor { chain ->
                calls++
                val request = chain.request()
                assertEquals("/api/owner/images/authorize", request.url.encodedPath)
                assertEquals("single-use", request.header("X-Firebase-AppCheck"))
                assertEquals("Bearer synthetic", request.header("Authorization"))
                assertTrue(request.header("X-Idempotency-Key")!!.matches(Regex("[a-f0-9-]{36}")))
                val body = Buffer().also { request.body!!.writeTo(it) }.readUtf8()
                assertEquals("""{"category":"logos","contentType":"image/jpeg","byteSize":100}""", body)
                response(request, payload())
            }.build()
        val api = ImageUploadAuthorizer("https://qa.invalid/api", client, { "owner" }, { "single-use" }, now = { clock })
        assertEquals("businesses/owner/logos/g_$id.jpg", api.authorize("owner", ImageCategory.LOGO, 100).storagePath)
        assertEquals(1, calls)
    }
    @Test fun `server rejection is safe and is never retried as an upload mutation`() = runBlocking {
        for (code in listOf(403, 429, 503, 302)) {
            var calls = 0
            val client = OkHttpClient.Builder().addInterceptor { chain -> calls++; response(chain.request(), "private detail", code) }.build()
            val api = ImageUploadAuthorizer("https://qa.invalid/api", client, { "owner" }, requireAttestation = false, now = { clock })
            try { api.authorize("owner", ImageCategory.LOGO, 100); fail("Expected rejection") } catch (e: IOException) { assertFalse(e.message.orEmpty().contains("private detail")) }
            assertEquals(1, calls)
        }
    }
    @Test fun `invalid owner path expired permit or oversized response never reaches Storage`() = runBlocking {
        for (body in listOf(payload("businesses/other/logos/g_$id.jpg"), payload(expires = "2026-01-01T00:00:00Z"), payload("businesses/owner/logos/free.jpg"), " ".repeat(16385))) {
            val client = OkHttpClient.Builder().addInterceptor { response(it.request(), body) }.build()
            val api = ImageUploadAuthorizer("https://qa.invalid/api", client, { "owner" }, requireAttestation = false, now = { clock })
            try { api.authorize("owner", ImageCategory.LOGO, 100); fail("Expected rejection") } catch (_: IOException) { }
        }
    }
    @Test fun `account switch during grant request discards the grant`() = runBlocking {
        var owner = "owner"
        val client = OkHttpClient.Builder().addInterceptor { owner = "other"; response(it.request(), payload()) }.build()
        val api = ImageUploadAuthorizer("https://qa.invalid/api", client, { owner }, requireAttestation = false, now = { clock })
        try { api.authorize("owner", ImageCategory.LOGO, 100); fail("Expected rejection") } catch (e: IOException) { assertTrue(e.message.orEmpty().contains("sesión cambió")) }
    }
    @Test fun `missing attestation or owner change while obtaining it prevents the POST`() = runBlocking {
        var calls = 0; var owner = "owner"
        val client = OkHttpClient.Builder().addInterceptor { calls++; response(it.request(), payload()) }.build()
        for (token in listOf<suspend () -> String?>({ null }, { owner = "other"; "single-use" })) {
            owner = "owner"
            val api = ImageUploadAuthorizer("https://qa.invalid/api", client, { owner }, token, now = { clock })
            try { api.authorize("owner", ImageCategory.LOGO, 100); fail("Expected rejection") } catch (_: IOException) { }
        }
        assertEquals(0, calls)
    }
}
