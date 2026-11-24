package com.pediturno.servicios
import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.data.remote.HttpPediturnoRemoteDataSource
import kotlinx.coroutines.runBlocking
import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import org.junit.Test
import org.junit.Assert.*
class BootstrapErrorIdentityTest {
    private fun remote(body: String) = HttpPediturnoRemoteDataSource("https://pediturno.test/api", { "synthetic" }, customClient = OkHttpClient.Builder().addInterceptor { Response.Builder().request(it.request()).protocol(Protocol.HTTP_1_1).code(404).message("Not Found").body(body.toResponseBody()).build() }.build())
    @Test fun `an absent API is not an absent business profile`() = runBlocking {
        val result = remote("<html>Not found</html>").getBusinessProfile("owner") as ApiResult.Error
        assertEquals(404, result.code)
        assertNull(result.reason)
    }
    @Test fun `only the explicit server contract identifies a missing profile`() = runBlocking {
        val result = remote("""{"error":"Business profile required","code":"BUSINESS_PROFILE_REQUIRED"}""").getBusinessProfile("owner") as ApiResult.Error
        assertEquals("BUSINESS_PROFILE_REQUIRED", result.reason)
    }
}
