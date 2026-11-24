package com.pediturno.servicios

import com.pediturno.servicios.data.model.DayScheduleSlot
import com.pediturno.servicios.ui.agenda.validateScheduleSlots
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

class ScheduleValidationTest {
    @Test fun acceptsClosedDaysAndAdjacentUnorderedSlots() {
        assertNull(validateScheduleSlots(emptyList()))
        assertNull(validateScheduleSlots(listOf(DayScheduleSlot("13:00", "23:59"), DayScheduleSlot("00:00", "13:00"))))
    }
    @Test fun rejectsMalformedAndOutOfRangeClocks() {
        listOf("9:00", "24:00", "12:60", "ab:cd", "", " 09:00").forEach {
            assertNotNull(validateScheduleSlots(listOf(DayScheduleSlot(it, "23:59"))))
            assertNotNull(validateScheduleSlots(listOf(DayScheduleSlot("00:00", it))))
        }
    }
    @Test fun rejectsEmptyAndReversedIntervals() {
        assertNotNull(validateScheduleSlots(listOf(DayScheduleSlot("09:00", "09:00"))))
        assertNotNull(validateScheduleSlots(listOf(DayScheduleSlot("13:00", "09:00"))))
    }
    @Test fun rejectsOverlapRegardlessOfInputOrder() {
        assertNotNull(validateScheduleSlots(listOf(DayScheduleSlot("12:00", "14:00"), DayScheduleSlot("09:00", "13:00"))))
    }
}
