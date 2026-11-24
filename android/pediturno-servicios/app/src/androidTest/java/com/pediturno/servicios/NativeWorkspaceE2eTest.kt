package com.pediturno.servicios

import android.view.WindowManager
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertHasClickAction
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.isRoot
import androidx.compose.ui.test.ComposeTimeoutException
import androidx.compose.ui.test.printToString
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.filters.LargeTest
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.pediturno.servicios.core.network.ApiResult
import com.pediturno.servicios.ui.MainActivity
import com.pediturno.servicios.ui.agenda.AppointmentTestTags
import com.pediturno.servicios.ui.agenda.ClientDetailTestTags
import com.pediturno.servicios.ui.agenda.MonthCalendarTestTags
import com.pediturno.servicios.ui.agenda.RescheduleTestTags
import com.pediturno.servicios.ui.agenda.ServiceAvailabilityTestTags
import com.pediturno.servicios.ui.agenda.BusinessProfileTestTags
import com.pediturno.servicios.ui.agenda.WorkspaceNavigationTestTags
import com.pediturno.servicios.ui.agenda.WorkspaceActionTestTags
import com.pediturno.servicios.ui.agenda.WorkspaceTestTags
import com.pediturno.servicios.ui.auth.LoginTestTags
import com.pediturno.servicios.ui.components.AppointmentCardTestTags
import com.pediturno.servicios.ui.components.BusinessDashboardTestTags
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import kotlinx.coroutines.runBlocking
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.time.temporal.ChronoUnit
import java.text.NumberFormat
import java.util.Locale
import java.util.concurrent.TimeUnit
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

/**
 * Exercises the actual debug application against Firebase Auth, Firestore and
 * the owner HTTP API emulators. Credentials are supplied by the local fixture
 * runner as instrumentation arguments and are deliberately never logged.
 */
@RunWith(AndroidJUnit4::class)
@LargeTest
class NativeWorkspaceE2eTest {

    @get:Rule(order = 0)
    val compose = createAndroidComposeRule<MainActivity>()

    private val http = OkHttpClient.Builder()
        .callTimeout(15, TimeUnit.SECONDS)
        .build()

    private lateinit var ownerA: FixtureOwner
    private lateinit var ownerB: FixtureOwner
    private lateinit var fixtureDate: String
    private var lastInteractionSnapshot: String = "No action snapshot yet"
    private var keepScreenOnWasSetBeforeTest: Boolean? = null

    @Before
    fun requireLocalFixtureArguments() {
        check(BuildConfig.USE_FIREBASE_EMULATORS) {
            "NativeWorkspaceE2eTest only runs in the explicit Firebase emulator debug build."
        }
        // A physical device may enter Doze while the real HTTP round-trip is
        // waiting. Keep only this test Activity awake; this does not alter any
        // device setting and the original flag state is restored in @After.
        compose.runOnUiThread {
            val window = compose.activity.window
            keepScreenOnWasSetBeforeTest =
                (window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) != 0
            window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        }
        val arguments = InstrumentationRegistry.getArguments()
        fixtureDate = arguments.required("fixtureDate")
        ownerA = FixtureOwner(
            email = arguments.required("ownerAEmail"),
            password = arguments.required("ownerAPassword"),
            serviceId = arguments.required("ownerAServiceId")
        )
        ownerB = FixtureOwner(
            email = arguments.required("ownerBEmail"),
            password = arguments.required("ownerBPassword"),
            serviceId = arguments.required("ownerBServiceId")
        )
        FirebaseAuth.getInstance().signOut()
    }

    @After
    fun restoreScreenWakeState() {
        compose.runOnUiThread {
            if (keepScreenOnWasSetBeforeTest == false && !compose.activity.isDestroyed) {
                compose.activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    @Test
    fun ownerWorkspace_roundTrip_isIsolatedAndServerReflected() {
        try {
            runOwnerWorkspaceRoundTrip()
        } catch (failure: Throwable) {
            failWithUiEvidence("workspace action: ${failure.message}", failure)
        }
    }

    private fun runOwnerWorkspaceRoundTrip() {
        login(ownerA)
        dismissGuidedTourIfPresent()

        val services = getJson("/v1/owner/services?limit=100")
        val seededService = services.array("services").findObject("id", ownerA.serviceId)
        val serviceName = seededService.getString("name")
        val seededClient = getJson("/v1/owner/clients?limit=100")
            .array("clients")
            .getJSONObject(0)
        val seededClientName = seededClient.getString("name")

        // This is the same HTTP adapter and token provider used by the screen.
        // It makes a mapper/authorization fault explicit instead of reporting a
        // generic missing Compose text node later in the test.
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as PediturnoApp
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: throw AssertionError("Authenticated user disappeared")
        when (val profile = runBlocking { app.remoteDataSource.getBusinessProfile(uid) }) {
            is ApiResult.Success -> Unit
            is ApiResult.Error -> throw AssertionError("App bootstrap adapter rejected fixture: ${profile.code} ${profile.message}")
            is ApiResult.NetworkError -> throw AssertionError("App bootstrap adapter network error", profile.exception)
        }
        when (val serviceResult = runBlocking { app.remoteDataSource.getServices(uid) }) {
            is ApiResult.Success -> assertTrue(
                "App services adapter did not return the seeded service",
                serviceResult.data.any { it.id == ownerA.serviceId }
            )
            is ApiResult.Error -> throw AssertionError("App services adapter rejected fixture: ${serviceResult.code} ${serviceResult.message}")
            is ApiResult.NetworkError -> throw AssertionError("App services adapter network error", serviceResult.exception)
        }

        exerciseDiscardableServiceCrud()
        exerciseDiscardableClientCrud()
        exerciseBusinessProfileSave()

        // Loaded data is rendered through the app, not inferred from the fixture.
        compose.onNodeWithTag(WorkspaceNavigationTestTags.SERVICES).performClick()
        waitForText(serviceName)
        compose.onNodeWithTag(WorkspaceNavigationTestTags.CLIENTS).performClick()
        waitForText(seededClientName)

        compose.onNodeWithTag(WorkspaceNavigationTestTags.AGENDA).performClick()
        selectAgendaDate(fixtureDate)
        compose.onNodeWithTag(WorkspaceActionTestTags.NEW_APPOINTMENT).performClick()
        waitForText("Nuevo Turno Manual")
        compose.onNodeWithTag(AppointmentTestTags.service(ownerA.serviceId)).performClick()

        val originalSlot = firstAvailableSlot(ownerA.serviceId, fixtureDate)
        waitForTag(AppointmentTestTags.slot(originalSlot))
        compose.onNodeWithTag(AppointmentTestTags.slot(originalSlot)).performClick()

        val reservationClient = "Reserva Nativa ${System.nanoTime()}"
        compose.onNodeWithTag(AppointmentTestTags.CLIENT_NAME).performTextInput(reservationClient)
        compose.onNodeWithTag(AppointmentTestTags.CLIENT_PHONE).performTextInput("5491112345678")
        compose.onNodeWithTag(AppointmentTestTags.CLIENT_EMAIL).performTextInput("native-e2e@example.test")
        compose.onNodeWithTag(AppointmentTestTags.CONFIRM).assertIsDisplayed().performClick()

        val created = eventually("new appointment to be persisted") {
            getAgenda(fixtureDate).findObjectOrNull("client", reservationClient)
        }
        val appointmentId = created.getString("id")
        assertEquals("Created appointment must keep the selected server slot", originalSlot, created.getString("time"))
        // HTTP persistence can precede removal of the modal Compose window.
        // Wait for the actual form to close before interacting with cards behind it.
        waitForTag(AppointmentTestTags.CONFIRM, expected = false)
        compose.waitForIdle()
        val afterCreateDashboard = getJson("/v1/owner/dashboard")
        assertEquals(2, afterCreateDashboard.getInt("upcomingAppointmentsCount"))
        assertDashboardMetric(BusinessDashboardTestTags.UPCOMING_COUNT, "2")
        revealAgendaAction(AppointmentCardTestTags.reschedule(appointmentId))

        // The reschedule dialog must ask the server again, excluding this appointment.
        val rescheduleAction = compose.onNodeWithTag(AppointmentCardTestTags.reschedule(appointmentId))
        lastInteractionSnapshot = "Before reschedule click:\n${rescheduleAction.printToString()}"
        rescheduleAction.assertIsDisplayed().assertIsEnabled().assertHasClickAction().performClick()
        waitForTag(RescheduleTestTags.DIALOG_TITLE)
        val rescheduledDate = LocalDate.parse(fixtureDate).plusDays(1).toString()
        compose.onNodeWithTag(RescheduleTestTags.DATE).assertIsDisplayed().performClick()
        if (LocalDate.parse(fixtureDate).month != LocalDate.parse(rescheduledDate).month) {
            compose.onAllNodesWithContentDescription("Mes siguiente")[0].performClick()
        }
        waitForTag(MonthCalendarTestTags.day(rescheduledDate))
        compose.onNodeWithTag(MonthCalendarTestTags.day(rescheduledDate)).performClick()
        waitForTag(MonthCalendarTestTags.day(rescheduledDate), expected = false)
        compose.activityRule.scenario.recreate()
        waitForTag(RescheduleTestTags.DIALOG_TITLE)
        compose.onNodeWithTag(RescheduleTestTags.DATE).assertTextContains(
            "Fecha: " + LocalDate.parse(rescheduledDate).format(DateTimeFormatter.ofLocalizedDate(FormatStyle.LONG).withLocale(Locale.forLanguageTag("es")))
        )
        val rescheduledSlot = firstAvailableSlot(ownerA.serviceId, rescheduledDate)
        waitForTag(RescheduleTestTags.slot(rescheduledSlot))
        compose.onNodeWithTag(RescheduleTestTags.slot(rescheduledSlot))
            .performScrollTo().assertIsDisplayed().performClick()
        compose.onNodeWithTag(RescheduleTestTags.SAVE).assertIsDisplayed().performClick()

        eventually("rescheduled appointment to be persisted") {
            getAgenda(rescheduledDate).findObjectOrNull("id", appointmentId)
                ?.takeIf { it.optString("time") == rescheduledSlot }
        }
        waitForTag(RescheduleTestTags.SAVE, expected = false)
        compose.waitForIdle()
        revealAgendaAction(AppointmentCardTestTags.complete(appointmentId))
        compose.onNodeWithTag(AppointmentCardTestTags.complete(appointmentId)).performClick()
        val completed = eventually("completed status to be persisted") {
            getAgenda(rescheduledDate).findObjectOrNull("id", appointmentId)
                ?.takeIf { it.optString("status").equals("Completado", ignoreCase = true) }
        }
        assertEquals("Completado", completed.getString("status"))
        val completedDashboard = getJson("/v1/owner/dashboard")
        assertEquals(1, completedDashboard.getInt("upcomingAppointmentsCount"))
        assertEquals(seededService.getDouble("price"), completedDashboard.getDouble("monthlyRevenue"), 0.001)
        assertDashboardMetric(BusinessDashboardTestTags.UPCOMING_COUNT, "1")
        val completedValue = NumberFormat.getCurrencyInstance(Locale.forLanguageTag("es-AR"))
            .format(completedDashboard.getDouble("monthlyRevenue"))
        assertDashboardMetric(BusinessDashboardTestTags.COMPLETED_VALUE, completedValue)

        // A -> logout -> A must not reuse a cancelled ViewModel or stale cache.
        logout()
        login(ownerA)
        assertNotNull(getAgenda(rescheduledDate).findObjectOrNull("id", appointmentId))

        // A -> logout -> B receives a fresh owner store. Server and rendered UI
        // must both exclude A's appointment.
        logout()
        login(ownerB)
        val ownerBServiceName = getJson("/v1/owner/services?limit=100")
            .array("services")
            .findObject("id", ownerB.serviceId)
            .getString("name")
        compose.onNodeWithTag(WorkspaceNavigationTestTags.SERVICES).performClick()
        waitForText(ownerBServiceName)
        compose.onNodeWithTag(WorkspaceNavigationTestTags.AGENDA).performClick()
        assertFalse(
            "Owner B must not read the appointment created by owner A",
            getAgenda(rescheduledDate).containsValue("client", reservationClient)
        )
        assertTrue(
            "Owner B UI must not retain owner A's appointment",
            compose.onAllNodesWithText(reservationClient, substring = false).fetchSemanticsNodes().isEmpty()
        )
    }

    private fun assertDashboardMetric(tag: String, expected: String) {
        eventually("dashboard metric to reflect the server") {
            compose.onNodeWithTag(WorkspaceActionTestTags.AGENDA_LIST)
                .performScrollToNode(hasTestTag(tag))
            compose.onNodeWithTag(tag).assertIsDisplayed().assertTextEquals(expected)
            true
        }
    }

    private fun revealAgendaAction(tag: String) {
        // A matching node can still sit beneath a visible transient notice.
        // Use the same close button available to the person using the app.
        if (compose.onAllNodesWithTag(WorkspaceActionTestTags.DISMISS_MESSAGE).fetchSemanticsNodes().isNotEmpty()) {
            compose.onNodeWithTag(WorkspaceActionTestTags.DISMISS_MESSAGE).assertIsDisplayed().performClick()
            waitForTag(WorkspaceActionTestTags.DISMISS_MESSAGE, expected = false)
        }
        // Lazy items are composed as they enter the viewport. Scroll the real
        // agenda container, then require the action to be visible before clicking.
        eventually("agenda action to become visible") {
            compose.onNodeWithTag(WorkspaceActionTestTags.AGENDA_LIST)
                .performScrollToNode(hasTestTag(tag))
            compose.onNodeWithTag(tag).assertIsDisplayed()
            true
        }
    }

    /**
     * Uses only the owner UI to mutate a uniquely named disposable service.
     * HTTP reads provide the canonical identifier and persistence assertions.
     */
    private fun exerciseDiscardableServiceCrud() {
        val createdName = "Servicio CRUD ${System.nanoTime()}"
        val editedName = "$createdName editado"
        val editedDuration = "45"
        val editedPrice = "12345.67"
        val blockedDate = LocalDate.parse(fixtureDate).plusDays(7).toString()

        compose.onNodeWithTag(WorkspaceNavigationTestTags.SERVICES).performClick()
        eventually("new service action to become visible after navigation") {
            compose.onNodeWithText("Nuevo Servicio", useUnmergedTree = true).assertIsDisplayed()
            true
        }
        compose.onNodeWithText("Nuevo Servicio", useUnmergedTree = true).assertIsDisplayed().performClick()
        waitForTag(WorkspaceTestTags.SERVICE_NAME)
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_NAME).performTextClearance()
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_NAME).performTextInput(createdName)
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_DURATION).performTextClearance()
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_DURATION).performTextInput("30")
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_PRICE).performTextClearance()
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_PRICE).performTextInput("9000")
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_SAVE).performClick()
        waitForTag(WorkspaceTestTags.SERVICE_SAVE, expected = false)

        val created = eventually("discardable service creation") {
            getJson("/v1/owner/services?limit=100").array("services")
                .findObjectOrNull("name", createdName)
        }
        val serviceId = created.getString("id")

        revealServiceAction(WorkspaceActionTestTags.serviceEdit(serviceId))
        eventually("service edit dialog to open") {
            if (compose.onAllNodesWithTag(WorkspaceTestTags.SERVICE_NAME, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) {
                true
            } else {
                compose.onNodeWithTag(WorkspaceActionTestTags.serviceEdit(serviceId)).performClick()
                compose.waitForIdle()
                if (compose.onAllNodesWithTag(WorkspaceTestTags.SERVICE_NAME, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) true else null
            }
        }
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_NAME).performTextClearance()
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_NAME).performTextInput(editedName)
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_DURATION).performTextClearance()
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_DURATION).performTextInput(editedDuration)
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_PRICE).performTextClearance()
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_PRICE).performTextInput(editedPrice)
        compose.onNodeWithTag(WorkspaceTestTags.SERVICE_SAVE).performClick()
        waitForTag(WorkspaceTestTags.SERVICE_SAVE, expected = false)
        eventually("discardable service edit persistence") {
            serviceById(serviceId)?.takeIf {
                it.optString("name") == editedName &&
                    it.optInt("duration") == editedDuration.toInt() &&
                    kotlin.math.abs(it.optDouble("price") - editedPrice.toDouble()) < 0.001
            }
        }

        // A new service starts paused. Explicitly review/save its proposed
        // schedule through the real editor before making it reservable.
        revealServiceAction(WorkspaceActionTestTags.serviceAvailability(serviceId))
        eventually("service availability dialog to open") {
            if (compose.onAllNodesWithTag(WorkspaceActionTestTags.SERVICE_AVAILABILITY_SAVE, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) {
                true
            } else {
                compose.onNodeWithTag(WorkspaceActionTestTags.serviceAvailability(serviceId)).performClick()
                compose.waitForIdle()
                if (compose.onAllNodesWithTag(WorkspaceActionTestTags.SERVICE_AVAILABILITY_SAVE, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) true else null
            }
        }
        compose.onNodeWithTag(WorkspaceActionTestTags.SERVICE_AVAILABILITY_SAVE).assertIsDisplayed().performClick()
        waitForTag(WorkspaceActionTestTags.SERVICE_AVAILABILITY_SAVE, expected = false)
        eventually("discardable service schedule persistence") {
            serviceById(serviceId)?.takeIf { it.optJSONObject("workingHours")?.length()?.let { days -> days > 0 } == true }
        }
        revealServiceAction(WorkspaceActionTestTags.serviceAvailability(serviceId))
        eventually("service availability dialog to reopen") {
            if (compose.onAllNodesWithTag(WorkspaceActionTestTags.SERVICE_AVAILABILITY_SAVE, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) {
                true
            } else {
                compose.onNodeWithTag(WorkspaceActionTestTags.serviceAvailability(serviceId)).performClick()
                compose.waitForIdle()
                if (compose.onAllNodesWithTag(WorkspaceActionTestTags.SERVICE_AVAILABILITY_SAVE, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) true else null
            }
        }
        compose.onNodeWithTag(ServiceAvailabilityTestTags.BLOCKED_DATES_TAB).performClick()
        compose.onNodeWithTag(ServiceAvailabilityTestTags.SELECT_BLOCKED_DATE).assertIsDisplayed().performClick()
        val today = LocalDate.now(ZoneId.of("America/Argentina/Buenos_Aires"))
        val monthDistance = ChronoUnit.MONTHS.between(YearMonth.from(today), YearMonth.from(LocalDate.parse(blockedDate))).toInt()
        repeat(monthDistance.coerceAtLeast(0)) { compose.onAllNodesWithContentDescription("Mes siguiente")[0].performClick() }
        waitForTag(MonthCalendarTestTags.day(blockedDate))
        compose.onNodeWithTag(MonthCalendarTestTags.day(blockedDate)).performScrollTo().assertIsDisplayed().performClick()
        waitForTag(ServiceAvailabilityTestTags.blockedDate(blockedDate))
        compose.onNodeWithTag(WorkspaceActionTestTags.SERVICE_AVAILABILITY_SAVE).assertIsDisplayed().performClick()
        waitForTag(WorkspaceActionTestTags.SERVICE_AVAILABILITY_SAVE, expected = false)
        eventually("blocked service date persistence") {
            serviceById(serviceId)?.takeIf { item ->
                item.optJSONArray("unavailableDates")?.let { dates ->
                    (0 until dates.length()).any { dates.getString(it) == blockedDate }
                } == true
            }
        }
        revealServiceAction(WorkspaceActionTestTags.servicePause(serviceId))
        eventually("new service remains visibly paused until activation") {
            compose.onNodeWithTag(WorkspaceActionTestTags.servicePause(serviceId)).assertIsOff()
            true
        }
        compose.onNodeWithTag(WorkspaceActionTestTags.servicePause(serviceId)).performClick()
        eventually("discardable service initial activation persistence") {
            serviceById(serviceId)?.takeIf { it.optString("status") == "Activo" }
        }
        eventually("discardable service activation rendered") {
            compose.onNodeWithTag(WorkspaceActionTestTags.servicePause(serviceId)).assertIsOn()
            true
        }
        compose.waitForIdle()
        captureScreen("verified_screen_servicios")
        val blockedSlots = getJson("/v1/owner/availability?serviceId=$serviceId&date=$blockedDate").array("slots")
        assertFalse("A persisted blocked day must not expose a reservable slot", (0 until blockedSlots.length()).any { blockedSlots.getJSONObject(it).getBoolean("available") })

        revealServiceAction(WorkspaceActionTestTags.servicePause(serviceId))
        compose.onNodeWithTag(WorkspaceActionTestTags.servicePause(serviceId)).performClick()
        eventually("discardable service pause persistence") {
            serviceById(serviceId)?.takeIf { it.optString("status") == "Pausado" }
        }
        eventually("discardable service pause rendered") {
            compose.onNodeWithTag(WorkspaceActionTestTags.servicePause(serviceId)).assertIsOff()
            true
        }
        revealServiceAction(WorkspaceActionTestTags.servicePause(serviceId))
        compose.onNodeWithTag(WorkspaceActionTestTags.servicePause(serviceId)).performClick()
        eventually("discardable service reactivation persistence") {
            serviceById(serviceId)?.takeIf { it.optString("status") == "Activo" }
        }

        revealServiceAction(WorkspaceActionTestTags.serviceDelete(serviceId))
        eventually("service delete dialog to open") {
            if (compose.onAllNodesWithTag(WorkspaceActionTestTags.SERVICE_DELETE_CONFIRM, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) {
                true
            } else {
                compose.onNodeWithTag(WorkspaceActionTestTags.serviceDelete(serviceId)).performClick()
                compose.waitForIdle()
                if (compose.onAllNodesWithTag(WorkspaceActionTestTags.SERVICE_DELETE_CONFIRM, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) true else null
            }
        }
        compose.onNodeWithTag(WorkspaceActionTestTags.SERVICE_DELETE_CANCEL).performClick()
        waitForTag(WorkspaceActionTestTags.SERVICE_DELETE_CONFIRM, expected = false)
        assertNotNull("Cancelling service deletion must preserve the service", serviceById(serviceId))

        revealServiceAction(WorkspaceActionTestTags.serviceDelete(serviceId))
        eventually("service delete dialog to reopen") {
            if (compose.onAllNodesWithTag(WorkspaceActionTestTags.SERVICE_DELETE_CONFIRM, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) {
                true
            } else {
                compose.onNodeWithTag(WorkspaceActionTestTags.serviceDelete(serviceId)).performClick()
                compose.waitForIdle()
                if (compose.onAllNodesWithTag(WorkspaceActionTestTags.SERVICE_DELETE_CONFIRM, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) true else null
            }
        }
        compose.onNodeWithTag(WorkspaceActionTestTags.SERVICE_DELETE_CONFIRM).performClick()
        eventually("discardable service deletion") {
            if (serviceById(serviceId) == null) true else null
        }
        eventually("discardable service removal from rendered list") {
            if (compose.onAllNodesWithTag(WorkspaceActionTestTags.serviceCard(serviceId)).fetchSemanticsNodes().isEmpty()) true else null
        }
    }

    private fun exerciseBusinessProfileSave() {
        val newName = "Negocio Servicios ${System.nanoTime()}"
        compose.onNodeWithTag(WorkspaceNavigationTestTags.BUSINESS).performClick()
        waitForTag(WorkspaceActionTestTags.EDIT_PROFILE)
        compose.waitForIdle()
        captureScreen("verified_screen_negocio")
        compose.onNodeWithTag(WorkspaceActionTestTags.EDIT_PROFILE).performScrollTo().assertIsDisplayed().performClick()
        waitForTag(BusinessProfileTestTags.NAME)
        compose.waitForIdle()
        captureScreen("verified_dialog_business_profile")
        compose.onNodeWithTag(BusinessProfileTestTags.NAME).performTextClearance()
        compose.onNodeWithTag(BusinessProfileTestTags.NAME).performTextInput(newName)
        compose.onNodeWithTag(BusinessProfileTestTags.SAVE).assertIsDisplayed().performClick()
        waitForTag(BusinessProfileTestTags.SAVE, expected = false)
        eventually("business profile saved without a logo or notification email") {
            getJson("/v1/owner/bootstrap").getJSONObject("business").takeIf {
                it.getString("name") == newName && it.getJSONObject("bookingSettings").optString("notificationEmail").isEmpty()
            }
        }
        compose.onNodeWithTag(WorkspaceNavigationTestTags.AGENDA).performClick()
    }

    private fun revealServiceAction(tag: String) {
        if (compose.onAllNodesWithTag(WorkspaceActionTestTags.DISMISS_MESSAGE).fetchSemanticsNodes().isNotEmpty()) {
            compose.onNodeWithTag(WorkspaceActionTestTags.DISMISS_MESSAGE).assertIsDisplayed().performClick()
            waitForTag(WorkspaceActionTestTags.DISMISS_MESSAGE, expected = false)
        }
        eventually("service action to become visible") {
            compose.onNodeWithTag(WorkspaceActionTestTags.SERVICES_LIST)
                .performScrollToNode(hasTestTag(tag))
            compose.waitForIdle()
            compose.onNodeWithTag(tag).assertIsDisplayed()
            true
        }
    }

    private fun serviceById(serviceId: String): JSONObject? =
        getJson("/v1/owner/services?limit=100").array("services").findObjectOrNull("id", serviceId)

    /** Mirrors the service flow: UI writes only, owner HTTP reads verify state. */
    private fun exerciseDiscardableClientCrud() {
        val suffix = System.nanoTime().toString().takeLast(8)
        val createdName = "Cliente CRUD $suffix"
        val createdPhone = "54911$suffix"
        val createdEmail = "native-crud-$suffix@example.test"
        val editedName = "$createdName editado"
        val editedPhone = "54912$suffix"
        val editedEmail = "native-crud-edit-$suffix@example.test"

        compose.onNodeWithTag(WorkspaceNavigationTestTags.CLIENTS).performClick()
        eventually("new client action to become visible after navigation") {
            compose.onNodeWithText("Nuevo Cliente", useUnmergedTree = true).assertIsDisplayed()
            true
        }
        compose.onNodeWithText("Nuevo Cliente", useUnmergedTree = true).assertIsDisplayed().performClick()
        waitForTag(WorkspaceTestTags.CLIENT_NAME)
        compose.onNodeWithTag(WorkspaceTestTags.CLIENT_NAME).performTextInput(createdName)
        compose.onNodeWithTag(WorkspaceTestTags.CLIENT_PHONE).performTextInput(createdPhone)
        compose.onNodeWithTag(WorkspaceTestTags.CLIENT_EMAIL).performTextInput(createdEmail)
        compose.onNodeWithTag(WorkspaceTestTags.CLIENT_SAVE).performClick()
        waitForTag(WorkspaceTestTags.CLIENT_SAVE, expected = false)

        val created = eventually("discardable client creation") {
            getJson("/v1/owner/clients?limit=100").array("clients")
                .findObjectOrNull("name", createdName)
        }
        val clientId = created.getString("id")

        revealClientCard(clientId)
        compose.waitForIdle()
        captureScreen("verified_screen_clientes")
        eventually("client detail to open") {
            if (compose.onAllNodesWithTag(ClientDetailTestTags.EDIT, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) {
                true
            } else {
                compose.onNodeWithTag(WorkspaceActionTestTags.clientCard(clientId)).performClick()
                compose.waitForIdle()
                if (compose.onAllNodesWithTag(ClientDetailTestTags.EDIT, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) true else null
            }
        }
        compose.waitForIdle()
        captureScreen("verified_dialog_client_detail")
        compose.onNodeWithTag(ClientDetailTestTags.EDIT).performClick()
        waitForTag(ClientDetailTestTags.NAME)
        compose.onNodeWithTag(ClientDetailTestTags.NAME).performTextClearance()
        compose.onNodeWithTag(ClientDetailTestTags.NAME).performTextInput(editedName)
        compose.onNodeWithTag(ClientDetailTestTags.PHONE).performTextClearance()
        compose.onNodeWithTag(ClientDetailTestTags.PHONE).performTextInput(editedPhone)
        compose.onNodeWithTag(ClientDetailTestTags.EMAIL).performTextClearance()
        compose.onNodeWithTag(ClientDetailTestTags.EMAIL).performTextInput(editedEmail)
        compose.onNodeWithTag(ClientDetailTestTags.SAVE).performClick()
        eventually("discardable client edit persistence") {
            clientById(clientId)?.takeIf {
                it.optString("name") == editedName &&
                    it.optString("phone") == editedPhone &&
                    it.optString("email") == editedEmail
            }
        }
        eventually("client detail closes after update") {
            if (compose.onAllNodesWithTag(ClientDetailTestTags.EDIT).fetchSemanticsNodes().isEmpty()) true else null
        }

        revealClientCard(clientId)
        eventually("client detail to open for deletion") {
            if (compose.onAllNodesWithTag(ClientDetailTestTags.DELETE_REQUEST, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) {
                true
            } else {
                compose.onNodeWithTag(WorkspaceActionTestTags.clientCard(clientId)).performClick()
                compose.waitForIdle()
                if (compose.onAllNodesWithTag(ClientDetailTestTags.DELETE_REQUEST, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()) true else null
            }
        }
        compose.onNodeWithTag(ClientDetailTestTags.DELETE_REQUEST).performClick()
        waitForTag(ClientDetailTestTags.DELETE_CONFIRM)
        compose.onNodeWithTag(ClientDetailTestTags.DELETE_CONFIRM).performClick()
        eventually("discardable client deletion") {
            if (clientById(clientId) == null) true else null
        }
        eventually("discardable client removal from rendered list") {
            if (compose.onAllNodesWithTag(WorkspaceActionTestTags.clientCard(clientId)).fetchSemanticsNodes().isEmpty()) true else null
        }
    }

    private fun revealClientCard(clientId: String) {
        if (compose.onAllNodesWithTag(WorkspaceActionTestTags.DISMISS_MESSAGE).fetchSemanticsNodes().isNotEmpty()) {
            compose.onNodeWithTag(WorkspaceActionTestTags.DISMISS_MESSAGE).assertIsDisplayed().performClick()
            waitForTag(WorkspaceActionTestTags.DISMISS_MESSAGE, expected = false)
        }
        eventually("client card to become visible") {
            compose.onNodeWithTag(WorkspaceActionTestTags.CLIENTS_LIST)
                .performScrollToNode(hasTestTag(WorkspaceActionTestTags.clientCard(clientId)))
            compose.waitForIdle()
            compose.onNodeWithTag(WorkspaceActionTestTags.clientCard(clientId)).assertIsDisplayed()
            true
        }
    }

    private fun clientById(clientId: String): JSONObject? =
        getJson("/v1/owner/clients?limit=100").array("clients").findObjectOrNull("id", clientId)

    private fun login(owner: FixtureOwner) {
        try {
            compose.waitUntil(TIMEOUT_MS) { compose.activity.hasWindowFocus() }
        } catch (failure: ComposeTimeoutException) {
            failWithUiEvidence("login window must be in foreground", failure)
        }
        waitForTag(LoginTestTags.EMAIL)
        compose.onNodeWithTag(LoginTestTags.EMAIL).performTextClearance()
        compose.onNodeWithTag(LoginTestTags.EMAIL).performTextInput(owner.email)
        compose.onNodeWithTag(LoginTestTags.PASSWORD).performTextClearance()
        compose.onNodeWithTag(LoginTestTags.PASSWORD).performTextInput(owner.password)
        compose.onNodeWithTag(LoginTestTags.SUBMIT).performScrollTo().assertIsDisplayed().performClick()
        compose.waitUntil(TIMEOUT_MS) {
            compose.onAllNodesWithContentDescription("Cerrar sesión").fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun logout() {
        compose.onAllNodesWithContentDescription("Cerrar sesión")[0].performClick()
        waitForTag(LoginTestTags.EMAIL)
        val password = compose.onAllNodesWithTag(LoginTestTags.PASSWORD)
            .fetchSemanticsNodes()
            .single()
            .config[SemanticsProperties.EditableText]
            .text
        assertEquals("Password must not remain rendered after logout", "", password)
    }

    private fun dismissGuidedTourIfPresent() {
        val closeButtons = compose.onAllNodesWithContentDescription("Cerrar tour")
        if (closeButtons.fetchSemanticsNodes().isNotEmpty()) {
            closeButtons[0].performClick()
        }
        compose.waitForIdle()
    }

    private fun selectAgendaDate(dateKey: String) {
        compose.onAllNodesWithContentDescription("Ver mes completo")[0].performClick()
        waitForTag(MonthCalendarTestTags.day(dateKey))
        compose.onNodeWithTag(MonthCalendarTestTags.day(dateKey)).performClick()
        waitForTag(MonthCalendarTestTags.day(dateKey), expected = false)
        compose.waitForIdle()
    }

    private fun firstAvailableSlot(serviceId: String, dateKey: String): String {
        val slots = getJson("/v1/owner/availability?serviceId=${serviceId.urlPart()}&date=${dateKey.urlPart()}").array("slots")
        for (index in 0 until slots.length()) {
            val slot = slots.getJSONObject(index)
            if (slot.optBoolean("available")) return slot.getString("time")
        }
        throw AssertionError("Fixture has no available server slot for $dateKey")
    }

    private fun getAgenda(dateKey: String): JSONArray =
        getJson("/v1/owner/agenda?date=${dateKey.urlPart()}").array("appointments")

    private fun getJson(path: String): JSONObject {
        val user = FirebaseAuth.getInstance().currentUser
            ?: throw AssertionError("Expected an authenticated Firebase user before calling $path")
        val token = Tasks.await(user.getIdToken(true), 15, TimeUnit.SECONDS).token
            ?: throw AssertionError("Firebase did not issue an ID token")
        val request = Request.Builder()
            .url("${BuildConfig.API_BASE_URL}$path")
            .header("Authorization", "Bearer $token")
            .build()
        http.newCall(request).execute().use { response ->
            val body = response.body?.string().orEmpty()
            assertEquals("Owner endpoint failed for $path: $body", 200, response.code)
            return JSONObject(body)
        }
    }

    private fun waitForTag(tag: String, expected: Boolean = true) {
        try {
            compose.waitUntil(TIMEOUT_MS) {
                // Dialog title Text semantics may be merged by Material. The
                // tag still proves the actual dialog exists in the UI tree.
                val exists = compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
                exists == expected
            }
        } catch (failure: ComposeTimeoutException) {
            failWithUiEvidence("tag=$tag", failure)
        }
    }

    private fun waitForText(value: String) {
        try {
            compose.waitUntil(TIMEOUT_MS) {
                compose.onAllNodesWithText(value, substring = false).fetchSemanticsNodes().isNotEmpty()
            }
        } catch (failure: ComposeTimeoutException) {
            failWithUiEvidence("expected text", failure)
        }
    }

    private fun captureScreen(name: String) {
        runCatching {
            val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
            val descriptor = automation.executeShellCommand("screencap -p /data/local/tmp/$name.png")
            android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use { it.readBytes() }
        }
    }

    private fun failWithUiEvidence(condition: String, cause: Throwable): Nothing {
        val captureId = InstrumentationRegistry.getArguments().getString("ownerAServiceId").orEmpty()
            .replace(Regex("[^A-Za-z0-9]"), "").take(40).ifEmpty { "fixture" }
        val capturePath = "/data/local/tmp/pediturno-native-e2e-$captureId.png"
        val captureDescriptor = AtomicReference<android.os.ParcelFileDescriptor?>(null)
        val executor = Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "e2e-screenshot").apply { isDaemon = true }
        }
        val screenshotSaved = try {
            executor.submit<Boolean> {
                val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
                val descriptor = automation.executeShellCommand("screencap -p $capturePath")
                captureDescriptor.set(descriptor)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(descriptor).use {
                    it.readBytes()
                }
                val sizeDescriptor = automation.executeShellCommand("stat -c %s $capturePath")
                captureDescriptor.set(sizeDescriptor)
                android.os.ParcelFileDescriptor.AutoCloseInputStream(sizeDescriptor).use {
                    (it.readBytes().toString(Charsets.UTF_8).trim().toLongOrNull() ?: 0L) > 8L
                }
            }.get(5, TimeUnit.SECONDS)
        } catch (_: Exception) {
            false
        } finally {
            runCatching { captureDescriptor.getAndSet(null)?.close() }
            executor.shutdownNow()
        }
        var safeCondition = condition
        var tree = "LAST ACTION\n$lastInteractionSnapshot\n" + runCatching {
            val roots = compose.onAllNodes(isRoot(), useUnmergedTree = true)
            (0 until minOf(roots.fetchSemanticsNodes().size, 3))
                .joinToString("\n--- UI ROOT ---\n") { roots[it].printToString() }
        }.getOrElse { "UI tree unavailable: ${it.javaClass.simpleName}" }
        val arguments = InstrumentationRegistry.getArguments()
        for (key in listOf("ownerAEmail", "ownerAPassword", "ownerBEmail", "ownerBPassword")) {
            arguments.getString(key)?.takeIf { it.isNotBlank() }?.let {
                tree = tree.replace(it, "[REDACTED]")
                safeCondition = safeCondition.replace(it, "[REDACTED]")
            }
        }
        // Bound each root after redaction so a large agenda cannot hide the modal root.
        val boundedRoots = tree.split("\n--- UI ROOT ---\n").joinToString("\n--- UI ROOT ---\n") { it.take(6000) }
        throw AssertionError("UI failure ($safeCondition); activityFocus=${compose.activity.hasWindowFocus()}; screenshotSaved=$screenshotSaved; capturePath=$capturePath\n$boundedRoots", cause)
    }

    private fun <T> eventually(description: String, action: () -> T?): T {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(TIMEOUT_MS)
        var lastFailure: Throwable? = null
        while (System.nanoTime() < deadline) {
            try {
                action()?.let { return it }
            } catch (failure: Throwable) {
                lastFailure = failure
            }
            Thread.sleep(200)
        }
        throw AssertionError("Timed out waiting for $description", lastFailure)
    }

    private data class FixtureOwner(
        val email: String,
        val password: String,
        val serviceId: String
    )

    private fun android.os.Bundle.required(name: String): String =
        getString(name)?.takeIf { it.isNotBlank() }
            ?: throw AssertionError("Missing required local E2E instrumentation argument: $name")

    private fun JSONObject.array(name: String): JSONArray =
        optJSONArray(name) ?: throw AssertionError("Expected '$name' array in owner API response")

    private fun JSONArray.findObject(field: String, value: String): JSONObject =
        findObjectOrNull(field, value) ?: throw AssertionError("Expected $field=$value in owner API response")

    private fun JSONArray.findObjectOrNull(field: String, value: String): JSONObject? {
        for (index in 0 until length()) {
            val item = optJSONObject(index) ?: continue
            if (item.optString(field) == value) return item
        }
        return null
    }

    private fun JSONArray.containsValue(field: String, value: String): Boolean =
        findObjectOrNull(field, value) != null

    private fun String.urlPart(): String = java.net.URLEncoder.encode(this, "UTF-8")

    private companion object {
        const val TIMEOUT_MS = 30_000L
    }
}
