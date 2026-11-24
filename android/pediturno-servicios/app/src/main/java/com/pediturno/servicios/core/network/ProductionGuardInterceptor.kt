package com.pediturno.servicios.core.network

import okhttp3.Interceptor
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Protocol
import okhttp3.Response
import okhttp3.ResponseBody.Companion.toResponseBody

/**
 * Guardarraíl de seguridad: bloquea cualquier petición mutante (POST, PUT, DELETE, PATCH)
 * dirigida a dominios de producción (ej. pediturno.com) durante desarrollo/debug salvo
 * autorización explícita para evitar contaminar la base productiva.
 */
class ProductionGuardInterceptor(
    private val allowProductionMutations: Boolean
) : Interceptor {

    override fun intercept(chain: Interceptor.Chain): Response {
        val request = chain.request()
        val host = request.url.host.lowercase()
        val method = request.method.uppercase()

        val isProductionHost = host == "pediturno.com" || host.endsWith(".pediturno.com")
        val isMutatingMethod = method in setOf("POST", "PUT", "DELETE", "PATCH")

        if (isProductionHost && isMutatingMethod && !allowProductionMutations) {
            val jsonError = """{"error": "Production mutation blocked by Android guardrail in debug mode"}"""
            return Response.Builder()
                .request(request)
                .protocol(Protocol.HTTP_1_1)
                .code(403)
                .message("Production Mutation Blocked")
                .body(jsonError.toResponseBody("application/json".toMediaType()))
                .build()
        }

        return chain.proceed(request)
    }
}
