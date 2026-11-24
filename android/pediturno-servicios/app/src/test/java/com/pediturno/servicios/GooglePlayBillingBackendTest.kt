package com.pediturno.servicios

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.data.repository.GooglePlayBillingBackend
import kotlinx.coroutines.runBlocking
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Assert.*
import org.junit.Test

class GooglePlayBillingBackendTest {
    private fun backend(body: String, code: Int = 200) = GooglePlayBillingBackend(
        "https://pediturno.test/api", { "test-session" }, OkHttpClient.Builder().addInterceptor { chain ->
            Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(code).message("Test")
                .body(body.toResponseBody("application/json".toMediaType())).build()
        }.build()
    )

    @Test fun `null entitlement means no verified Play subscription rather than serialization failure`() = runBlocking {
        val result = backend("""{"entitlement":null}""").status()
        assertTrue(result is ApiResult.Success)
        assertEquals("none", (result as ApiResult.Success).data.status)
        assertFalse(result.data.autoRenewing)
    }

    @Test fun `account transports exact authorized base plan and purchase gate`() = runBlocking {
        val result = backend("""{"purchaseAllowed":false,"reason":"existing_membership","basePlanId":"monthly"}""").account()
        assertEquals("monthly", (result as ApiResult.Success).data.basePlanId)
        assertFalse(result.data.purchaseAllowed)
    }

    @Test fun `malformed or html success becomes a recoverable error`() = runBlocking {
        assertEquals(502, (backend("<html>proxy response</html>").status() as ApiResult.Error).code)
    }

    @Test fun `error does not expose arbitrary server html to the user`() = runBlocking {
        val result = backend("<html>internal host information</html>", 503).status() as ApiResult.Error
        assertEquals(503, result.code)
        assertFalse(result.message.contains("internal host"))
    }

    @Test fun `restore with another account shows a private Spanish recovery message`() = runBlocking {
        for (code in listOf(403, 409)) {
            val result = backend("""{"message":"Purchase could not be verified","error":"private provider detail"}""", code)
                .verify("test-purchase-token", "com.pediturno.servicios") as ApiResult.Error
            assertEquals(code, result.code)
            assertEquals("No pudimos verificar esta compra con la cuenta actual. Usá la cuenta de Pediturno con la que la realizaste.", result.message)
            assertFalse(result.message.contains("Purchase"))
            assertFalse(result.message.contains("private provider"))
        }
    }

    @Test fun `session throttling and server failures never display upstream JSON details`() = runBlocking {
        for (code in listOf(401, 429, 500, 503)) {
            val result = backend("""{"message":"private provider detail"}""", code).status() as ApiResult.Error
            assertEquals(code, result.code)
            assertFalse(result.message.contains("private provider"))
            assertTrue(result.message.contains("Volvé") || result.message.contains("volvé"))
        }
    }
}
