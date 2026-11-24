package com.pediturno.servicios

import com.pediturno.servicios.data.export.WorkspaceExporter
import com.pediturno.servicios.data.model.ClientItem
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class WorkspaceExporterTest {
    @Test
    fun `CSV escapes commas quotes and multiline values`() {
        val actual = WorkspaceExporter.encodeCsv(
            listOf(listOf("Ana, Pérez", "Dijo \"hola\"", "Primera línea\nSegunda línea"))
        )

        assertEquals("\"Ana, Pérez\",\"Dijo \"\"hola\"\"\",\"Primera línea\nSegunda línea\"", actual)
    }

    @Test
    fun `CSV formula prefixes are kept as text without truncating phone`() {
        assertEquals("'=SUM(A1:A2)", WorkspaceExporter.escapeCsvCell("=SUM(A1:A2)"))
        assertEquals("'+5491122334455", WorkspaceExporter.escapeCsvCell("+5491122334455"))
        assertEquals("'-5", WorkspaceExporter.escapeCsvCell("-5"))
        assertEquals("'@handle", WorkspaceExporter.escapeCsvCell("@handle"))
    }

    @Test
    fun `pagination preserves row order and never splits a row`() {
        val rows = (1..5).map { WorkspaceExporter.AgendaRow("$it:00", "C$it", "S$it", "Confirmado", "$it") }

        val pages = WorkspaceExporter.paginateAgendaRows(rows, rowsPerPage = 2)

        assertEquals(listOf(2, 2, 1), pages.map { it.size })
        assertEquals(rows, pages.flatten())
        assertTrue(pages.all { it.size <= 2 })
    }

    @Test
    fun `client CSV exports only server-authoritative client fields`() {
        val csv = WorkspaceExporter.clientsCsv(
            listOf(
                ClientItem(
                    id = "client-1",
                    name = "Ana Pérez",
                    phone = "+54 11 1234-5678",
                    email = "ana@example.com",
                    notes = "No exportar",
                    totalBookings = 99,
                    lastVisitDateKey = "2026-10-01",
                    businessId = "business-1"
                )
            )
        )

        assertEquals("\uFEFFNombre,Teléfono,Email\r\nAna Pérez,'+54 11 1234-5678,ana@example.com", csv)
        assertTrue(!csv.contains("No exportar") && !csv.contains("99") && !csv.contains("2026-10-01"))
    }
}
