package com.pediturno.servicios.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner

/** Retains the workspace during Activity recreation; account changes clear it. */
class WorkspaceSessionStoreViewModel : ViewModel(), ViewModelStoreOwner {
    override val viewModelStore = ViewModelStore()
    private var accountId: String? = null
    private var onAccountCleared: (() -> Unit)? = null

    fun forAccount(uid: String): ViewModelStoreOwner {
        require(uid.isNotBlank())
        if (accountId != uid) {
            clearAccount()
            accountId = uid
        }
        return this
    }

    fun attachCleanup(cleanup: () -> Unit) {
        onAccountCleared = cleanup
    }

    fun clearAccount() {
        val cleanup = onAccountCleared
        onAccountCleared = null
        accountId = null
        cleanup?.invoke()
        viewModelStore.clear()
    }

    override fun onCleared() = clearAccount()
}
