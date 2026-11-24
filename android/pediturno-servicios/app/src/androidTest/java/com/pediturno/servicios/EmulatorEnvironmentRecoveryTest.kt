package com.pediturno.servicios

import android.os.Build
import android.os.SystemClock
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** QA environment repair only: never dismiss a Pediturno ANR or run on a physical device. */
class EmulatorEnvironmentRecoveryTest {
    @Test fun waitForPreviouslyReportedSystemUiAnrOnce() {
        check(Build.HARDWARE == "ranchu" || Build.HARDWARE == "goldfish")
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val automation = instrumentation.uiAutomation
        val root = automation.rootInActiveWindow
        val systemUiAnr = root?.findAccessibilityNodeInfosByText("System UI isn't responding")
            ?.any { it.text?.toString() == "System UI isn't responding" } == true
        if (systemUiAnr) {
            val wait = root!!.findAccessibilityNodeInfosByText("Wait")
                .single { it.text?.toString() == "Wait" && it.packageName?.toString() == "android" }
            assertTrue(wait.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            SystemClock.sleep(5000)
        }
        val remains = automation.rootInActiveWindow?.findAccessibilityNodeInfosByText("System UI isn't responding")
            ?.any { it.text?.toString() == "System UI isn't responding" } == true
        val directory = File(instrumentation.targetContext.getExternalFilesDir(null), "compat29").apply { mkdirs() }
        File(directory, "environment-recovery.txt").writeText("emulatorOnly=true\nobservedSystemUiAnr=$systemUiAnr\nclickedWait=$systemUiAnr\nremains=$remains\n")
        assertFalse("System UI still blocks the owned emulator", remains)
    }
}
