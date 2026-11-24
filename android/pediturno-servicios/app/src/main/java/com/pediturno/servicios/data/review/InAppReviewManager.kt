package com.pediturno.servicios.data.review

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import com.google.android.play.core.review.ReviewManagerFactory

/**
 * Pure policy rules governing when PediTurno Negocios may invoke Google Play In-App Review
 * after positive workspace milestones (e.g. agenda PDF / client CSV exports).
 */
object ReviewPromptPolicy {
    const val COOLDOWN_MILLIS: Long = 21L * 24L * 60L * 60L * 1000L
    const val MAX_LIFETIME_PROMPTS: Int = 3

    fun isMilestone(count: Int): Boolean = count == 2 || (count > 2 && (count - 2) % 5 == 0)

    fun shouldPrompt(
        completedEvents: Int,
        promptsShown: Int,
        lastPromptMillis: Long,
        nowMillis: Long,
    ): Boolean {
        if (promptsShown >= MAX_LIFETIME_PROMPTS) return false
        if (!isMilestone(completedEvents)) return false
        if (lastPromptMillis > 0L && (nowMillis - lastPromptMillis) < COOLDOWN_MILLIS) return false
        return true
    }
}

class InAppReviewManager private constructor(private val appContext: Context) {
    private val prefs: SharedPreferences =
        appContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    fun recordPositiveEventAndMaybePrompt(activity: Activity?) {
        val now = System.currentTimeMillis()
        val count = prefs.getInt(KEY_EVENTS_COUNT, 0) + 1
        val promptsShown = prefs.getInt(KEY_PROMPTS_SHOWN, 0)
        val lastPromptMillis = prefs.getLong(KEY_LAST_PROMPT_MILLIS, 0L)

        val eligible = ReviewPromptPolicy.shouldPrompt(
            completedEvents = count,
            promptsShown = promptsShown,
            lastPromptMillis = lastPromptMillis,
            nowMillis = now,
        )

        val editor = prefs.edit().putInt(KEY_EVENTS_COUNT, count)
        val activityAlive = activity != null && !activity.isFinishing && !activity.isDestroyed
        if (!eligible || !activityAlive) {
            editor.apply()
            return
        }

        editor
            .putInt(KEY_PROMPTS_SHOWN, promptsShown + 1)
            .putLong(KEY_LAST_PROMPT_MILLIS, now)
            .apply()

        runCatching {
            val reviewManager = ReviewManagerFactory.create(appContext)
            reviewManager.requestReviewFlow().addOnCompleteListener { task ->
                if (!task.isSuccessful) return@addOnCompleteListener
                val host = activity ?: return@addOnCompleteListener
                if (host.isFinishing || host.isDestroyed) return@addOnCompleteListener
                runCatching {
                    reviewManager.launchReviewFlow(host, task.result)
                }
            }
        }
    }

    companion object {
        private const val PREFS_NAME = "pediturno_in_app_review"
        private const val KEY_EVENTS_COUNT = "completed_events"
        private const val KEY_PROMPTS_SHOWN = "prompts_shown"
        private const val KEY_LAST_PROMPT_MILLIS = "last_prompt_millis"

        @Volatile
        private var instance: InAppReviewManager? = null

        fun getInstance(context: Context): InAppReviewManager =
            instance ?: synchronized(this) {
                instance ?: InAppReviewManager(context.applicationContext).also { instance = it }
            }
    }
}

tailrec fun Context.findActivity(): Activity? =
    when (this) {
        is Activity -> this
        is ContextWrapper -> baseContext.findActivity()
        else -> null
    }
