package com.pediturno.servicios

import com.pediturno.servicios.data.review.ReviewPromptPolicy
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ReviewPromptPolicyTest {

    @Test
    fun triggersOnlyOnConfiguredMilestones() {
        val t0 = 1_700_000_000_000L
        assertFalse(ReviewPromptPolicy.shouldPrompt(1, 0, 0L, t0))
        assertTrue(ReviewPromptPolicy.shouldPrompt(2, 0, 0L, t0))
        assertFalse(ReviewPromptPolicy.shouldPrompt(4, 1, t0, t0 + ReviewPromptPolicy.COOLDOWN_MILLIS))
        assertTrue(ReviewPromptPolicy.shouldPrompt(7, 1, t0, t0 + ReviewPromptPolicy.COOLDOWN_MILLIS))
        assertTrue(ReviewPromptPolicy.shouldPrompt(12, 2, t0, t0 + ReviewPromptPolicy.COOLDOWN_MILLIS))
    }

    @Test
    fun enforcesCooldownAndLifetimeCap() {
        val last = 1_700_000_000_000L
        assertFalse(
            ReviewPromptPolicy.shouldPrompt(
                completedEvents = 7,
                promptsShown = 1,
                lastPromptMillis = last,
                nowMillis = last + ReviewPromptPolicy.COOLDOWN_MILLIS - 1L,
            )
        )
        assertFalse(
            ReviewPromptPolicy.shouldPrompt(
                completedEvents = 12,
                promptsShown = ReviewPromptPolicy.MAX_LIFETIME_PROMPTS,
                lastPromptMillis = 0L,
                nowMillis = last + ReviewPromptPolicy.COOLDOWN_MILLIS,
            )
        )
    }
}
