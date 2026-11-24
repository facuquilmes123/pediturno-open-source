package com.pediturno.servicios

import com.pediturno.servicios.data.export.ExportOutcome
import com.pediturno.servicios.data.export.PendingWorkspaceExport
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.flow.first
import com.pediturno.servicios.data.export.ExportPayloadStore
import org.junit.Assert.*
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PendingWorkspaceExportTest {
    private class Disk : ExportPayloadStore<String> {
        var value: String? = null
        var writing = false
        var failSave = false
        override fun save(value: String) { check(!failSave); this.value = value; writing = false }
        override fun load() = value
        override fun exists() = value != null
        override fun markWriting() { writing = true }
        override fun interruptedWrite() = writing
        override fun clear() { value = null; writing = false }
    }

    @Test fun `new process recovers original disk snapshot and clears it after one write`() = runTest {
        val disk = Disk()
        val first = PendingWorkspaceExport<String>(this, disk)
        first.beginPersisted("original", "clients.csv") { fail("Preparation failed") }
        first.readyFileName.first { it != null }
        assertEquals("clients.csv", first.claimPickerLaunch())
        assertNull(first.claimPickerLaunch())
        val restored = PendingWorkspaceExport<String>(this, disk)
        val done = CompletableDeferred<ExportOutcome>()
        val writes = mutableListOf<String>()
        restored.finish(true, { writes += it }, { done.complete(it) })
        assertEquals(ExportOutcome.COMPLETED, done.await())
        assertEquals(listOf("original"), writes)
        assertFalse(disk.exists())
        restored.finish(true, { fail("Duplicate wrote again") }, {})
        runCurrent()
    }

    @Test fun `restored cancellation and account clear erase disk payload`() = runTest {
        val disk = Disk().apply { value = "private" }
        val restored = PendingWorkspaceExport<String>(this, disk)
        restored.finish(false, { fail("Cancelled") }, { assertEquals(ExportOutcome.CANCELLED, it) })
        assertFalse(disk.exists())
        disk.value = "owner A"
        restored.clear()
        assertFalse(disk.exists())
    }

    @Test fun `process interruption during writing cannot silently repeat the file`() = runTest {
        val disk = Disk().apply { value = "original"; writing = true }
        val restored = PendingWorkspaceExport<String>(this, disk)
        val done = CompletableDeferred<ExportOutcome>()
        restored.finish(true, { fail("Interrupted export repeated") }, { done.complete(it) })
        assertEquals(ExportOutcome.FAILED, done.await())
        assertFalse(disk.exists())
    }

    @Test fun `disk failure never opens picker and permits explicit retry`() = runTest {
        val disk = Disk().apply { failSave = true }
        val request = PendingWorkspaceExport<String>(this, disk)
        val failed = CompletableDeferred<Unit>()
        request.beginPersisted("private", "clients.csv") { failed.complete(Unit) }
        failed.await()
        assertNull(request.readyFileName.value)
        assertFalse(request.pending.value)
        assertFalse(disk.exists())
    }

    @Test fun `new UI callback consumes original snapshot once after recreation`() = runTest {
        val request = PendingWorkspaceExport<List<String>>(this)
        assertTrue(request.begin(listOf("original")))
        assertFalse(request.begin(listOf("changed during picker")))
        val writes = mutableListOf<List<String>>()
        val outcomes = mutableListOf<ExportOutcome>()
        // A new composition receives the same account-scoped state holder.
        request.finish(true, { writes.add(it) }, outcomes::add)
        request.finish(true, { writes.add(it) }, outcomes::add)
        runCurrent()
        assertEquals(listOf(listOf("original")), writes)
        assertEquals(listOf(ExportOutcome.COMPLETED), outcomes)
        assertFalse(request.pending.value)
    }

    @Test fun `cancel never writes and permits another export`() = runTest {
        val request = PendingWorkspaceExport<String>(this)
        request.begin("private snapshot")
        val outcomes = mutableListOf<ExportOutcome>()
        request.finish(false, { fail("Cancelled export wrote data") }, outcomes::add)
        assertEquals(listOf(ExportOutcome.CANCELLED), outcomes)
        assertTrue(request.begin("new snapshot"))
        request.clear()
    }

    @Test fun `account clear prevents old callback from exporting its payload`() = runTest {
        val request = PendingWorkspaceExport<String>(this)
        request.begin("owner A")
        request.clear()
        val outcomes = mutableListOf<ExportOutcome>()
        request.finish(true, { fail("Old owner payload escaped") }, outcomes::add)
        runCurrent()
        assertEquals(listOf(ExportOutcome.SELECTION_LOST), outcomes)
        assertFalse(request.pending.value)
    }

    @Test fun `account clear cancels outstanding write without success notification`() = runTest {
        val request = PendingWorkspaceExport<String>(this)
        request.begin("owner A")
        val barrier = CompletableDeferred<Unit>()
        val outcomes = mutableListOf<ExportOutcome>()
        request.finish(true, { barrier.await() }, outcomes::add)
        runCurrent()
        assertTrue(request.pending.value)
        request.clear()
        barrier.complete(Unit)
        runCurrent()
        assertTrue(outcomes.isEmpty())
        assertFalse(request.pending.value)
    }

    @Test fun `failed write releases pending state for retry`() = runTest {
        val request = PendingWorkspaceExport<String>(this)
        request.begin("snapshot")
        val outcomes = mutableListOf<ExportOutcome>()
        request.finish(true, { throw java.io.IOException("test failure") }, outcomes::add)
        runCurrent()
        assertEquals(listOf(ExportOutcome.FAILED), outcomes)
        assertTrue(request.begin("retry"))
        request.clear()
    }
}
