package com.pediturno.servicios

import com.pediturno.servicios.data.repository.SubscriptionOfferCandidate
import com.pediturno.servicios.data.repository.SubscriptionPricePhase
import com.pediturno.servicios.data.repository.selectMonthlySubscriptionOffer
import org.junit.Assert.*
import org.junit.Test

class MonthlySubscriptionOfferTest {
    private fun monthly(plan: String = "monthly") = SubscriptionOfferCandidate(
        plan, null, "token-$plan", listOf(SubscriptionPricePhase("ARS 5.123,45", "P1M", 1, 5_123_450_000))
    )

    @Test fun `uses regional formatted price without inventing a USD conversion`() {
        assertEquals("ARS 5.123,45", selectMonthlySubscriptionOffer(listOf(monthly()), "monthly")?.formattedPrice)
    }

    @Test fun `never substitutes first offer for the server authorized plan`() {
        val offers = listOf(monthly("wrong"), monthly("approved"))
        assertNull(selectMonthlySubscriptionOffer(offers))
        assertEquals("approved", selectMonthlySubscriptionOffer(offers, "approved")?.basePlanId)
        assertNull(selectMonthlySubscriptionOffer(offers, "missing"))
    }

    @Test fun `rejects trials yearly plans prepaid and free prices`() {
        val monthly = monthly()
        val phase = monthly.phases.single()
        listOf(
            monthly.copy(offerId = "trial"),
            monthly.copy(phases = listOf(phase.copy(billingPeriod = "P1Y"))),
            monthly.copy(phases = listOf(phase.copy(recurrenceMode = 3))),
            monthly.copy(phases = listOf(phase.copy(amountMicros = 0))),
            monthly.copy(phases = listOf(phase.copy(amountMicros = 0), phase))
        ).forEach { assertNull(selectMonthlySubscriptionOffer(listOf(it))) }
    }
}
