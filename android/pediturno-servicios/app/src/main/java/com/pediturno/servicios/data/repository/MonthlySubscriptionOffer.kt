package com.pediturno.servicios.data.repository

/** Transport-neutral subset used to ensure the displayed price is the price actually bought. */
data class SubscriptionPricePhase(
    val formattedPrice: String,
    val billingPeriod: String,
    val recurrenceMode: Int,
    val amountMicros: Long
)

data class SubscriptionOfferCandidate(
    val basePlanId: String,
    val offerId: String?,
    val offerToken: String,
    val phases: List<SubscriptionPricePhase>
)

data class MonthlySubscriptionOffer(
    val basePlanId: String,
    val offerToken: String,
    val formattedPrice: String,
    val billingPeriod: String = "P1M",
    val renewalDescription: String = "Cobro mensual con renovación automática. Podés cancelar desde Google Play."
)

/** Only the approved recurring monthly base plan; no implicit trial or promotional offer. */
fun selectMonthlySubscriptionOffer(
    candidates: List<SubscriptionOfferCandidate>,
    basePlanId: String? = null
): MonthlySubscriptionOffer? {
    val eligible = candidates.filter { candidate ->
        candidate.offerId == null && candidate.offerToken.isNotBlank() &&
            (basePlanId == null || candidate.basePlanId == basePlanId) &&
            candidate.phases.size == 1 && candidate.phases.single().let {
                it.billingPeriod == "P1M" && it.recurrenceMode == 1 &&
                    it.amountMicros > 0 && it.formattedPrice.isNotBlank()
            }
    }
    // Never guess which of several monthly plans corresponds to the server's plan.
    val selected = eligible.singleOrNull() ?: return null
    return MonthlySubscriptionOffer(selected.basePlanId, selected.offerToken, selected.phases.single().formattedPrice)
}
