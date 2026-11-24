package com.pediturno.servicios

import android.content.Context
import android.graphics.Bitmap
import androidx.activity.enableEdgeToEdge
import androidx.activity.ComponentActivity
import androidx.compose.material3.Surface
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.platform.app.InstrumentationRegistry
import com.pediturno.servicios.core.theme.PediturnoTheme
import com.pediturno.servicios.ui.auth.LoginScreen
import com.pediturno.servicios.ui.auth.LoginTestTags
import com.pediturno.servicios.ui.auth.LoginViewModel
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Layout-only test: never submits login, signs up or mutates an account. */
class LoginInsetsTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun passwordAndSubmitRemainReachableAboveTheRealKeyboard() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        check(context.packageName == "com.pediturno.servicios.debug" && BuildConfig.USE_FIREBASE_EMULATORS)
        val app = context.applicationContext as PediturnoApp
        val model = LoginViewModel(app.authRepository)
        compose.activityRule.scenario.onActivity { activity ->
            activity.enableEdgeToEdge()
        }
        compose.setContent { PediturnoTheme { Surface { LoginScreen(model, onLoginSuccess = {}) } } }
        compose.onNodeWithTag(LoginTestTags.EMAIL).performScrollTo().performTextInput("layout-only@example.test")
        compose.onNodeWithTag(LoginTestTags.PASSWORD).performScrollTo().performClick()
        compose.waitUntil(10_000) {
            ViewCompat.getRootWindowInsets(compose.activity.window.decorView)?.isVisible(WindowInsetsCompat.Type.ime()) == true
        }
        compose.onNodeWithTag(LoginTestTags.PASSWORD).performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag(LoginTestTags.SUBMIT).performScrollTo().assertIsDisplayed()
        val button = compose.onNodeWithTag(LoginTestTags.SUBMIT).fetchSemanticsNode().boundsInWindow
        val insets = ViewCompat.getRootWindowInsets(compose.activity.window.decorView)!!
        val keyboardTop = compose.activity.window.decorView.height - insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
        assertTrue("Submit overlaps the keyboard", button.bottom <= keyboardTop + 2)
        context.openFileOutput("play26-login-keyboard.png", Context.MODE_PRIVATE).use {
            compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it)
        }
    }
}
