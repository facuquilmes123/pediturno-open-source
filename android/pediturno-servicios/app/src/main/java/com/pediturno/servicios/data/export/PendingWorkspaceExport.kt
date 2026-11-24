package com.pediturno.servicios.data.export

import com.pediturno.servicios.data.model.Appointment
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable

enum class ExportOutcome { COMPLETED, CANCELLED, SELECTION_LOST, FAILED }

@Serializable
data class AgendaExportSnapshot(val businessName: String, val dateLabel: String, val appointments: List<Appointment>)

/** Account-scoped request. Optional encrypted snapshots recover SAF results after process death.
 * Large directories never enter saved-instance-state bundles. Coordination is on the main thread.
 */
class PendingWorkspaceExport<T : Any>(private val scope: CoroutineScope, private val store: ExportPayloadStore<T>? = null) {
    private var snapshot: T? = null
    private var generation = 0L
    private var writeJob: Job? = null
    private var prepareJob: Job? = null
    private val _readyFileName = MutableStateFlow<String?>(null)
    val readyFileName = _readyFileName.asStateFlow()
    private val _pending = MutableStateFlow(false)
    val pending = _pending.asStateFlow()

    fun begin(value: T): Boolean {
        if (_pending.value) return false
        snapshot = value
        _pending.value = true
        return true
    }

    /** Persist off the UI thread before opening SAF; the current composition claims the launch. */
    fun beginPersisted(value: T, fileName: String, onFailure: () -> Unit): Boolean {
        if (!begin(value)) return false
        val requestGeneration = generation
        prepareJob = scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    // A process killed during a write must not silently create a duplicate file.
                    check(store?.interruptedWrite() != true)
                    store?.save(value)
                }
                if (generation == requestGeneration) _readyFileName.value = fileName
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) {
                if (generation == requestGeneration) { clear(); onFailure() }
            }
        }
        return true
    }

    fun claimPickerLaunch(): String? = _readyFileName.value.also { _readyFileName.value = null }

    fun finish(accepted: Boolean, write: suspend (T) -> Unit, onOutcome: (ExportOutcome) -> Unit) {
        if (!accepted) {
            if (snapshot == null && store?.exists() != true) return
            clear()
            onOutcome(ExportOutcome.CANCELLED)
            return
        }
        if (writeJob?.isActive == true) return
        val memorySnapshot = snapshot
        if (memorySnapshot == null && store?.exists() != true) {
            // A duplicate callback must never start another write.
            if (!_pending.value) onOutcome(ExportOutcome.SELECTION_LOST)
            return
        }
        snapshot = null
        _readyFileName.value = null
        _pending.value = true
        val requestGeneration = generation
        writeJob = scope.launch {
            val outcome = try {
                val selected = if (store == null) memorySnapshot else withContext(Dispatchers.IO) {
                    check(store?.interruptedWrite() != true)
                    store.load()
                }
                if (selected == null) {
                    if (generation == requestGeneration) onOutcome(ExportOutcome.SELECTION_LOST)
                    return@launch
                }
                if (store != null) withContext(Dispatchers.IO) { store.markWriting() }
                write(selected)
                ExportOutcome.COMPLETED
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                ExportOutcome.FAILED
            } finally {
                if (generation == requestGeneration) { store?.clear(); _pending.value = false }
            }
            if (generation == requestGeneration) onOutcome(outcome)
        }
    }

    /** Logout invalidates payloads, callbacks and outstanding work for this owner. */
    fun clear() {
        generation++
        snapshot = null
        writeJob?.cancel()
        prepareJob?.cancel()
        prepareJob = null
        writeJob = null
        _pending.value = false
        _readyFileName.value = null
        store?.clear()
    }
}
