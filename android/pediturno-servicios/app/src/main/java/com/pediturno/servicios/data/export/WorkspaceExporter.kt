package com.pediturno.servicios.data.export

import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Typeface
import android.graphics.pdf.PdfDocument
import com.pediturno.servicios.data.model.Appointment
import com.pediturno.servicios.data.model.ClientItem
import java.io.IOException
import java.io.OutputStream
import java.text.NumberFormat
import java.util.Locale

/**
 * Local-only workspace exports. Callers own the SAF URI; this class never requests broad storage
 * access and does not log export contents.
 */
object WorkspaceExporter {
    const val PDF_MIME_TYPE = "application/pdf"
    const val CSV_MIME_TYPE = "text/csv"

    data class AgendaRow(
        val time: String,
        val client: String,
        val service: String,
        val status: String,
        val price: String
    )

    /** A pure, testable page layout helper. A row is always assigned whole to exactly one page. */
    fun paginateAgendaRows(rows: List<AgendaRow>, rowsPerPage: Int = 27): List<List<AgendaRow>> {
        require(rowsPerPage > 0) { "rowsPerPage must be positive" }
        return rows.chunked(rowsPerPage).ifEmpty { listOf(emptyList()) }
    }

    fun agendaRows(appointments: List<Appointment>, locale: Locale = Locale("es", "AR")): List<AgendaRow> {
        val currency = NumberFormat.getCurrencyInstance(locale)
        return appointments
            .sortedBy { it.time }
            .map { appointment ->
                AgendaRow(
                    time = appointment.time,
                    client = appointment.client,
                    service = appointment.service,
                    status = appointment.status.label,
                    price = currency.format(appointment.priceAtBooking)
                )
            }
    }

    /**
     * Writes a paginated A4-like agenda PDF. The output stream is owned by the caller and is not
     * closed here, so SAF callers can report success only once their stream's use block completes.
     */
    @Throws(IOException::class)
    fun writeAgendaPdf(
        output: OutputStream,
        businessName: String,
        dateLabel: String,
        appointments: List<Appointment>,
        locale: Locale = Locale("es", "AR")
    ) {
        val rows = agendaRows(appointments, locale)
        val pages = paginateAgendaRows(rows)
        val document = PdfDocument()
        try {
            pages.forEachIndexed { index, pageRows ->
                val page = document.startPage(
                    PdfDocument.PageInfo.Builder(PAGE_WIDTH, PAGE_HEIGHT, index + 1).create()
                )
                drawAgendaPage(
                    canvas = page.canvas,
                    businessName = businessName,
                    dateLabel = dateLabel,
                    pageRows = pageRows,
                    appointmentCount = appointments.size,
                    total = appointments.sumOf { it.priceAtBooking },
                    locale = locale,
                    pageNumber = index + 1,
                    pageCount = pages.size
                )
                document.finishPage(page)
            }
            document.writeTo(output)
        } finally {
            document.close()
        }
    }

    fun writeClientsCsv(output: OutputStream, clients: List<ClientItem>) {
        output.write(clientsCsv(clients).toByteArray(Charsets.UTF_8))
    }

    fun clientsCsv(clients: List<ClientItem>): String {
        val rows = buildList {
            add(listOf("Nombre", "Teléfono", "Email"))
            clients.forEach { client ->
                add(
                    listOf(
                        client.name,
                        client.phone,
                        client.email
                    )
                )
            }
        }
        return UTF8_BOM + encodeCsv(rows)
    }

    /** RFC 4180-compatible escaping plus spreadsheet formula neutralization. */
    fun encodeCsv(rows: List<List<String>>): String = rows.joinToString(separator = "\r\n") { row ->
        row.joinToString(separator = ",") { value -> escapeCsvCell(value) }
    }

    fun escapeCsvCell(value: String): String {
        val protected = if (value.firstOrNull()?.let { it in FORMULA_PREFIXES } == true) "'$value" else value
        val escaped = protected.replace("\"", "\"\"")
        return if (escaped.any { it == ',' || it == '\"' || it == '\n' || it == '\r' }) {
            "\"$escaped\""
        } else {
            escaped
        }
    }

    private fun drawAgendaPage(
        canvas: Canvas,
        businessName: String,
        dateLabel: String,
        pageRows: List<AgendaRow>,
        appointmentCount: Int,
        total: Double,
        locale: Locale,
        pageNumber: Int,
        pageCount: Int
    ) {
        canvas.drawColor(Color.WHITE)
        val title = paint(18f, Color.rgb(24, 45, 54), Typeface.create(Typeface.DEFAULT, Typeface.BOLD))
        val body = paint(9f, Color.rgb(45, 59, 64))
        val detail = paint(8f, Color.rgb(91, 107, 112))
        val tableHeader = paint(8f, Color.WHITE, Typeface.create(Typeface.DEFAULT, Typeface.BOLD))
        val tableCell = paint(8f, Color.rgb(31, 48, 55))

        canvas.drawText(ellipsize(businessName, 52), LEFT, 38f, title)
        canvas.drawText("Agenda · $dateLabel", LEFT, 57f, body)
        val summary = "$appointmentCount turnos · ${NumberFormat.getCurrencyInstance(locale).format(total)}"
        canvas.drawText(summary, LEFT, 73f, detail)

        val headerTop = 92f
        val headerBottom = headerTop + HEADER_HEIGHT
        val headerPaint = Paint().apply { color = Color.rgb(62, 123, 117) }
        canvas.drawRect(LEFT, headerTop, PAGE_WIDTH - RIGHT, headerBottom, headerPaint)
        columns.forEach { (x, heading) -> canvas.drawText(heading, x, 105f, tableHeader) }

        var top = headerBottom
        pageRows.forEachIndexed { index, row ->
            val rowPaint = Paint().apply {
                color = if (index % 2 == 0) Color.rgb(247, 250, 250) else Color.WHITE
            }
            canvas.drawRect(LEFT, top, PAGE_WIDTH - RIGHT, top + ROW_HEIGHT, rowPaint)
            canvas.drawLine(LEFT, top + ROW_HEIGHT, PAGE_WIDTH - RIGHT, top + ROW_HEIGHT, Paint().apply {
                color = Color.rgb(224, 231, 232)
                strokeWidth = 0.7f
            })
            val baseline = top + 14f
            canvas.drawText(ellipsize(row.time, 10), TIME_X, baseline, tableCell)
            canvas.drawText(ellipsize(row.client, 25), CLIENT_X, baseline, tableCell)
            canvas.drawText(ellipsize(row.service, 24), SERVICE_X, baseline, tableCell)
            canvas.drawText(ellipsize(row.status, 14), STATUS_X, baseline, tableCell)
            canvas.drawText(ellipsize(row.price, 14), PRICE_X, baseline, tableCell)
            top += ROW_HEIGHT
        }
        canvas.drawText("Página $pageNumber de $pageCount", LEFT, PAGE_HEIGHT - 22f, detail)
    }

    private fun paint(size: Float, color: Int, typeface: Typeface = Typeface.DEFAULT) = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        textSize = size
        this.color = color
        this.typeface = typeface
    }

    private fun ellipsize(value: String, maxCharacters: Int): String =
        if (value.length <= maxCharacters) value else value.take(maxCharacters - 1) + "…"

    private const val UTF8_BOM = "\uFEFF"
    private val FORMULA_PREFIXES = setOf('=', '+', '-', '@')
    private const val PAGE_WIDTH = 595
    private const val PAGE_HEIGHT = 842
    private const val LEFT = 36f
    private const val RIGHT = 36f
    private const val HEADER_HEIGHT = 22f
    private const val ROW_HEIGHT = 21f
    private const val TIME_X = LEFT + 7f
    private const val CLIENT_X = 104f
    private const val SERVICE_X = 226f
    private const val STATUS_X = 350f
    private const val PRICE_X = 449f
    private val columns = listOf(
        TIME_X to "Hora",
        CLIENT_X to "Cliente",
        SERVICE_X to "Servicio",
        STATUS_X to "Estado",
        PRICE_X to "Precio"
    )
}
