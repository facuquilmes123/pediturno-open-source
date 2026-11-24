package com.pediturno.servicios

import com.pediturno.servicios.core.network.executeOwnerRead
import java.io.IOException
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test

class OwnerReadRetryTest {
    private fun client(reply: (Int) -> Pair<Int, String?>): Pair<OkHttpClient, () -> Int> {
        var calls = 0
        return OkHttpClient.Builder().addInterceptor { chain ->
            val (code, retry) = reply(++calls)
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(code).message("QA")
                .body("{}".toResponseBody()).apply { retry?.let { header("Retry-After", it) } }.build()
        }.build() to { calls }
    }
    private fun request(path: String = "/api/v1/owner/clients") = Request.Builder().url("https://qa.invalid$path").build()

    @Test fun `retries throttled GET and respects the server delay`() = runBlocking {
        val waits = mutableListOf<Long>(); val (client, calls) = client { if (it == 1) 429 to "5" else 200 to null }
        executeOwnerRead(client, request(), { true }, { waits.add(it) }).use { assertEquals(200, it.code) }
        assertEquals(2, calls()); assertEquals(listOf(5000L), waits)
    }
    @Test fun `does not replay writes or provider reads`() = runBlocking {
        for (req in listOf(request().newBuilder().post("{}".toRequestBody()).build(), request("/api/v1/owner/mercadopago"))) {
            val (client, calls) = client { 429 to "1" }
            executeOwnerRead(client, req, { true }, { fail("Unexpected retry") }).close()
            assertEquals(1, calls())
        }
    }
    @Test fun `untrusted retry headers and non throttle errors are returned unchanged`() = runBlocking {
        for ((status, header) in listOf(429 to null, 429 to "-1", 429 to "61", 429 to "99999999999999999999", 503 to "1", 401 to "1")) {
            val (client, calls) = client { status to header }
            executeOwnerRead(client, request(), { true }, { fail("Unexpected delay") }).use { assertEquals(status, it.code) }
            assertEquals(1, calls())
        }
    }
    @Test fun `caps attempts and total waiting`() = runBlocking {
        val waits = mutableListOf<Long>(); val (client, calls) = client { 429 to "30" }
        executeOwnerRead(client, request(), { true }, { waits.add(it) }).close()
        assertEquals(3, calls()); assertEquals(listOf(30000L, 30000L), waits)
    }
    @Test fun `owner switch while waiting prevents another request`() = runBlocking {
        var current = true; val (client, calls) = client { 429 to "1" }
        try { executeOwnerRead(client, request(), { current }, { current = false }); fail("Owner switch accepted") }
        catch (_: IOException) { assertEquals(1, calls()) }
    }
    @Test fun `cancellation during waiting propagates without retry`() = runBlocking {
        val (client, calls) = client { 429 to "1" }
        try { executeOwnerRead(client, request(), { true }, { throw CancellationException("QA") }); fail("Cancellation swallowed") }
        catch (_: CancellationException) { assertEquals(1, calls()) }
    }
}
