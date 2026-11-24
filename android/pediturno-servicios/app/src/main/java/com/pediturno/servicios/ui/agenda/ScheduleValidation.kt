package com.pediturno.servicios.ui.agenda

import com.pediturno.servicios.data.model.DayScheduleSlot

internal fun validateScheduleSlots(slots: List<DayScheduleSlot>): String? {
    if (slots.isEmpty()) return null
    if (slots.size > 2) {
        return "Cada día habilitado debe tener uno o dos rangos horarios."
    }
    val clock = Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]")
    if (slots.any { !clock.matches(it.start) || !clock.matches(it.end) }) {
        return "Usá el formato HH:mm, entre 00:00 y 23:59."
    }
    if (slots.any { it.start >= it.end }) {
        return "El inicio debe ser anterior al fin de cada franja."
    }
    if (slots.sortedBy { it.start }.zipWithNext().any { (a, b) -> a.end > b.start }) {
        return "Las franjas de un mismo día no pueden superponerse."
    }
    return null
}
