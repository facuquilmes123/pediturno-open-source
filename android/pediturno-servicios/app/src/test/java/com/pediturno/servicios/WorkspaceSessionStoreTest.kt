package com.pediturno.servicios

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStoreOwner
import com.pediturno.servicios.ui.WorkspaceSessionStoreViewModel
import org.junit.Assert.*
import org.junit.Test

class WorkspaceSessionStoreTest {
    private class RecordedWorkspace : ViewModel() {
        var cleared = false
        override fun onCleared() { cleared = true }
    }
    private fun workspace(owner: ViewModelStoreOwner): RecordedWorkspace =
        ViewModelProvider(owner, object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = RecordedWorkspace() as T
        })[RecordedWorkspace::class.java]

    @Test fun `the same account retains its workspace across recomposition or Activity recreation`() {
        val holder = WorkspaceSessionStoreViewModel()
        val first = workspace(holder.forAccount("owner-a"))
        assertSame(first, workspace(holder.forAccount("owner-a")))
        assertFalse(first.cleared)
        holder.clearAccount()
    }

    @Test fun `account change cancels old work and clears the previous workspace`() {
        val holder = WorkspaceSessionStoreViewModel()
        val first = workspace(holder.forAccount("owner-a"))
        var cleanups = 0
        holder.attachCleanup { cleanups++ }
        val second = workspace(holder.forAccount("owner-b"))
        assertNotSame(first, second)
        assertTrue(first.cleared)
        assertEquals(1, cleanups)
        assertFalse(second.cleared)
        holder.clearAccount()
    }

    @Test fun `logout is idempotent and logging into the same uid creates a fresh workspace`() {
        val holder = WorkspaceSessionStoreViewModel()
        val first = workspace(holder.forAccount("owner-a"))
        var cleanups = 0
        holder.attachCleanup { cleanups++ }
        holder.clearAccount()
        holder.clearAccount()
        assertEquals(1, cleanups)
        assertTrue(first.cleared)
        assertNotSame(first, workspace(holder.forAccount("owner-a")))
        holder.clearAccount()
    }
}
