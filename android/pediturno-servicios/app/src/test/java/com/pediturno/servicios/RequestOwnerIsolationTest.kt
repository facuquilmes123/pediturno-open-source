package com.pediturno.servicios
import com.pediturno.servicios.core.network.AuthInterceptor
import com.pediturno.servicios.core.network.RequestOwner
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import java.io.IOException
import org.junit.Test
import org.junit.Assert.*
class RequestOwnerIsolationTest {
    private fun response(request: Request) = Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(200).message("OK").body("{}".toResponseBody()).build()
    @Test fun `queued request cannot acquire another account token`() {
        var sent = false
        val client = OkHttpClient.Builder().addInterceptor(AuthInterceptor({ "token-b" }, ownerProvider = { "b" })).addInterceptor { sent = true; response(it.request()) }.build()
        val request = Request.Builder().url("https://pediturno.test/api").tag(RequestOwner::class.java, RequestOwner("a")).build()
        try { client.newCall(request).execute().close(); fail("Expected identity rejection") } catch (_: IOException) { }
        assertFalse(sent)
    }
    @Test fun `account change while obtaining the token also aborts the request`() {
        var owner = "a"
        var sent = false
        val client = OkHttpClient.Builder().addInterceptor(AuthInterceptor({ owner = "b"; "token-b" }, ownerProvider = { owner })).addInterceptor { sent = true; response(it.request()) }.build()
        val request = Request.Builder().url("https://pediturno.test/api").tag(RequestOwner::class.java, RequestOwner("a")).build()
        try { client.newCall(request).execute().close(); fail("Expected identity rejection") } catch (_: IOException) { }
        assertFalse(sent)
    }
    @Test fun `token rotation for the same owner is allowed`() {
        val client = OkHttpClient.Builder().addInterceptor(AuthInterceptor({ "fresh-token" }, ownerProvider = { "a" })).addInterceptor { assertEquals("Bearer fresh-token", it.request().header("Authorization")); response(it.request()) }.build()
        client.newCall(Request.Builder().url("https://pediturno.test/api").tag(RequestOwner::class.java, RequestOwner("a")).build()).execute().use { assertEquals(200, it.code) }
    }
}
