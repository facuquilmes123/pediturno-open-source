package com.pediturno.servicios

import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.data.remote.HttpPediturnoRemoteDataSource
import kotlinx.coroutines.runBlocking
import okhttp3.OkHttpClient
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody
import okhttp3.MediaType.Companion.toMediaType
import okio.Buffer
import okio.ForwardingSource
import okio.buffer
import org.junit.Assert.*
import org.junit.Test

class PaginatedReadOwnerTest {
    @Test fun `account switch after consuming page discards data and prevents next account request`() = runBlocking {
        for (hasNext in listOf(true, false)) {
            var owner = "owner-a"; var calls = 0
            val body = """{"clients":[{"id":"a","name":"Cliente A","phone":"111111"}],"nextCursor":${if (hasNext) "\"cursor\"" else "null"}}"""
            val client = OkHttpClient.Builder().addInterceptor { chain ->
                calls++
                val source = object : ForwardingSource(Buffer().writeUtf8(body)) {
                    override fun close() { super.close(); owner = "owner-b" }
                }.buffer()
                val responseBody = object : ResponseBody() {
                    override fun contentType() = "application/json".toMediaType()
                    override fun contentLength() = body.toByteArray().size.toLong()
                    override fun source() = source
                }
                Response.Builder().request(chain.request()).protocol(Protocol.HTTP_1_1).code(200).message("QA").body(responseBody).build()
            }.build()
            val remote = HttpPediturnoRemoteDataSource("https://qa.invalid/api", { null }, requireAppCheck = false,
                customClient = client, ownerProvider = { owner })
            assertTrue(remote.getClients("owner-a") is ApiResult.NetworkError)
            assertEquals(1, calls)
        }
    }
}
