package com.pediturno.servicios.data.model

import androidx.compose.runtime.Immutable
import kotlinx.serialization.Serializable

@Immutable
@Serializable
data class Address(
    val street: String = "",
    val number: String = "",
    val city: String = "",
    val province: String = "",
    val postalCode: String = "",
    val country: String = "Argentina"
) {
    val formatted: String
        get() = listOfNotNull(
            if (street.isNotBlank()) "$street $number".trim() else null,
            city.takeIf { it.isNotBlank() },
            province.takeIf { it.isNotBlank() }
        ).joinToString(", ")
}

@Immutable
@Serializable
data class GeoLocation(
    val lat: Double = -34.5885,
    val lng: Double = -58.4103
)

@Serializable
enum class SocialLinkType(val label: String) {
    INSTAGRAM("Instagram"),
    FACEBOOK("Facebook"),
    TIKTOK("TikTok"),
    WEBSITE("Sitio Web"),
    X("X (Twitter)"),
    YOUTUBE("YouTube"),
    LINKEDIN("LinkedIn"),
    CUSTOM("Personalizado")
}

@Immutable
@Serializable
data class SocialLink(
    val id: String,
    val type: SocialLinkType,
    val url: String,
    val title: String = ""
)

@Immutable
@Serializable
data class CustomThemeColors(
    val primary: String = "#4FB5AB",
    val background: String = "#F0F0F0",
    val accent: String = "#3B998F"
)

@Immutable
@Serializable
data class MercadoPagoSettings(
    val isConnected: Boolean = false,
    val requireDeposit: Boolean = false,
    val depositType: String = "percentage", // "percentage" | "fixed"
    val depositValue: Double = 30.0
)

@Immutable
@Serializable
data class BookingRules(
    val leadTimeHours: Int = 24,
    val horizonDays: Int = 30,
    val bufferMinutes: Int = 15,
    val autoConfirm: Boolean = true,
    val remindersEnabled: Boolean = false,
    val notifyNewByEmail: Boolean = false,
    val notificationEmail: String = ""
)

/** Server-derived Mercado Pago state. Credentials and OAuth details never reach the device. */
@Immutable
data class MercadoPagoConnectionStatus(
    val configured: Boolean = false,
    val connected: Boolean = false,
    val depositsEnabled: Boolean = false,
    val canConfigureDeposits: Boolean = false,
    val requireDeposit: Boolean = false,
    val depositType: String = "percentage",
    val depositValue: Double = 0.0
)

enum class AppointmentNotificationKind(val wireValue: String) {
    CONFIRMATION("confirmation"),
    CANCELLATION("cancellation"),
    REMINDER("reminder")
}

@Immutable
@Serializable
data class MembershipInfo(
    val plan: String = "free",
    val planName: String = "Gratis",
    val status: String = "free", // server-authoritative membership state
    val source: String = "FREE",
    val monthlyQuota: Int? = 40,
    val currentMonthUsage: Int = 0,
    val currentMonthKey: String = "",
    val daysRemaining: Int = 0,
    val expiresAtIso: String = "",
    val playProductId: String = "pediturno_servicios_pro_monthly",
    val autoRenewEnabled: Boolean = false
) {
    val isPro: Boolean
        get() = plan.equals("pro", ignoreCase = true) ||
            status.equals("active", ignoreCase = true) ||
            status.equals("grace_period", ignoreCase = true) ||
            status.equals("lifetime", ignoreCase = true) ||
            planName.equals("pro", ignoreCase = true) ||
            planName.equals("vitalicia", ignoreCase = true)

    val remainingQuota: Int
        get() = monthlyQuota?.let { maxOf(0, it - currentMonthUsage) } ?: Int.MAX_VALUE

    val isOperational: Boolean
        get() = true
}

@Immutable
@Serializable
data class BusinessProfile(
    val id: String,
    val name: String,
    val slug: String,
    val businessType: String = "services",
    val timeZone: String = "America/Argentina/Buenos_Aires",
    val email: String,
    val description: String = "",
    val logoUrl: String? = null,
    val phone: String = "",
    val whatsappButtonEnabled: Boolean = true,
    val whatsappNumber: String = "",
    val address: Address = Address(),
    val location: GeoLocation? = null,
    val socialLinks: List<SocialLink> = emptyList(),
    val theme: String = "menta", // "menta", "ocaso", "bosque", "noche", "cielo", "coral", "lavanda", "custom"
    val customTheme: CustomThemeColors = CustomThemeColors(),
    val bookingRules: BookingRules = BookingRules(),
    val mercadopago: MercadoPagoSettings = MercadoPagoSettings(),
    val workingHoursSummary: String = "Sin horarios configurados",
    val openTime: String = "",
    val closeTime: String = "",
    val membership: MembershipInfo = MembershipInfo()
) {
    // Backwards-compatible properties
    val bookingLeadTimeMinutes: Int get() = bookingRules.leadTimeHours * 60
    val bookingHorizonDays: Int get() = bookingRules.horizonDays
    val bookingBufferMinutes: Int get() = bookingRules.bufferMinutes
    val autoConfirmBookings: Boolean get() = bookingRules.autoConfirm
    val unavailableDates: List<String> get() = emptyList()

    val publicBookingUrl: String
        get() = "https://pediturno.com/$slug"
}
