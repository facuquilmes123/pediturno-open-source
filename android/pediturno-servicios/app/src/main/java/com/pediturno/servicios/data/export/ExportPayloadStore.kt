package com.pediturno.servicios.data.export

interface ExportPayloadStore<T : Any> {
    fun save(value: T)
    fun load(): T?
    fun exists(): Boolean
    fun markWriting()
    fun interruptedWrite(): Boolean
    fun clear()
}
