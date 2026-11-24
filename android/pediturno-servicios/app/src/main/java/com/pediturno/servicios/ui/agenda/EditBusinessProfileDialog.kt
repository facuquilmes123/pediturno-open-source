package com.pediturno.servicios.ui.agenda

import android.net.Uri
import coil3.compose.AsyncImage
import androidx.compose.ui.layout.ContentScale
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.compose.ui.platform.LocalContext
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.LocationSearching
import androidx.compose.material.icons.outlined.Palette
import androidx.compose.material.icons.outlined.Payment
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Store
import androidx.compose.material3.BasicAlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Tab
import androidx.compose.material3.TabRow
import androidx.compose.material3.TabRowDefaults
import androidx.compose.material3.TabRowDefaults.tabIndicatorOffset
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.listSaver
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.Image
import androidx.compose.ui.res.painterResource
import com.pediturno.servicios.R
import com.pediturno.servicios.core.theme.BorderHairline
import com.pediturno.servicios.core.theme.BorderSubtle
import com.pediturno.servicios.core.theme.CrimsonCancelled
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.OnMintPrimary
import com.pediturno.servicios.core.theme.SurfaceLevel1
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import com.pediturno.servicios.data.model.Address
import com.pediturno.servicios.data.model.BookingRules
import com.pediturno.servicios.data.model.BusinessProfile
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import com.pediturno.servicios.data.model.CustomThemeColors
import com.pediturno.servicios.data.model.GeoLocation
import com.pediturno.servicios.data.model.SocialLink
import com.pediturno.servicios.data.model.SocialLinkType
import java.util.UUID

object BusinessProfileTestTags {
    const val NAME = "business_profile_name"
    const val SAVE = "business_profile_save"
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EditBusinessProfileDialog(
    profile: BusinessProfile,
    isSubmitting: Boolean,
    onSaveProfile: (BusinessProfile, Uri?) -> Unit,
    onDismiss: () -> Unit,
    errorMessage: String? = null
) {
    var selectedTab by rememberSaveable(profile.id) { mutableIntStateOf(0) } // 0 = Perfil & Web, 1 = Temas, 2 = Señas & Reglas

    // State Perfil
    var name by rememberSaveable(profile.id) { mutableStateOf(profile.name) }
    var slug by rememberSaveable(profile.id) { mutableStateOf(profile.slug) }
    var description by rememberSaveable(profile.id) { mutableStateOf(profile.description) }
    val logoUrl = profile.logoUrl
    var selectedLogoUri by rememberSaveable(profile.id) { mutableStateOf<String?>(null) }
    var logoPreviewLoading by remember(selectedLogoUri, logoUrl) { mutableStateOf(true) }
    var logoPreviewError by remember(selectedLogoUri, logoUrl) { mutableStateOf(false) }
    var whatsappButtonEnabled by rememberSaveable(profile.id) { mutableStateOf(profile.whatsappButtonEnabled) }
    var whatsappNumber by rememberSaveable(profile.id) { mutableStateOf(profile.whatsappNumber) }

    // Address
    var street by rememberSaveable(profile.id) { mutableStateOf(profile.address.street) }
    var number by rememberSaveable(profile.id) { mutableStateOf(profile.address.number) }
    var city by rememberSaveable(profile.id) { mutableStateOf(profile.address.city) }
    var province by rememberSaveable(profile.id) { mutableStateOf(profile.address.province) }

    var postalCode by rememberSaveable(profile.id) { mutableStateOf(profile.address.postalCode) }
    var country by rememberSaveable(profile.id) { mutableStateOf(profile.address.country) }
    var latitude by rememberSaveable(profile.id) { mutableStateOf(profile.location?.lat?.toString().orEmpty()) }
    var longitude by rememberSaveable(profile.id) { mutableStateOf(profile.location?.lng?.toString().orEmpty()) }
    val validLocation = (latitude.isBlank() && longitude.isBlank()) ||
        (latitude.toDoubleOrNull()?.let { it.isFinite() && it in -90.0..90.0 } == true &&
         longitude.toDoubleOrNull()?.let { it.isFinite() && it in -180.0..180.0 } == true)
    var primary by rememberSaveable(profile.id) { mutableStateOf(profile.customTheme.primary) }
    var background by rememberSaveable(profile.id) { mutableStateOf(profile.customTheme.background) }
    var accent by rememberSaveable(profile.id) { mutableStateOf(profile.customTheme.accent) }
    var socialMenu by remember { mutableStateOf<String?>(null) }
    // Theme
    var selectedTheme by rememberSaveable(profile.id) { mutableStateOf(profile.theme) }

    // Social Links
    val socialLinks = rememberSaveable(profile.id, saver = listSaver(
        save = { links -> links.flatMap { listOf(it.id, it.type.name, it.url, it.title) } },
        restore = { values -> mutableStateListOf<SocialLink>().apply {
            values.chunked(4).forEach { add(SocialLink(it[0], SocialLinkType.valueOf(it[1]), it[2], it[3])) }
        } }
    )) {
        mutableStateListOf<SocialLink>().apply { addAll(profile.socialLinks) }
    }

    // Mercado Pago & Booking Rules

    var leadTimeHours by rememberSaveable(profile.id) { mutableStateOf(profile.bookingRules.leadTimeHours.toString()) }
    var horizonDays by rememberSaveable(profile.id) { mutableStateOf(profile.bookingRules.horizonDays.toString()) }
    var bufferMinutes by rememberSaveable(profile.id) { mutableStateOf(profile.bookingRules.bufferMinutes.toString()) }
    var autoConfirm by rememberSaveable(profile.id) { mutableStateOf(profile.bookingRules.autoConfirm) }
    var remindersEnabled by rememberSaveable(profile.id) { mutableStateOf(profile.bookingRules.remindersEnabled) }
    var notifyEmailEnabled by rememberSaveable(profile.id) { mutableStateOf(profile.bookingRules.notifyNewByEmail) }
    var notificationEmail by rememberSaveable(profile.id) { mutableStateOf(profile.bookingRules.notificationEmail) }

    val photoContext = LocalContext.current
    val logoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        uri?.let { selected -> photoContext.retainDraftPhoto(selected); selectedLogoUri = selected.toString() }
    }

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = MintPrimary,
        unfocusedBorderColor = BorderSubtle,
        focusedTextColor = TextHighEmphasis,
        unfocusedTextColor = TextHighEmphasis,
        focusedLabelColor = MintPrimary,
        unfocusedLabelColor = TextMediumEmphasis,
        cursorColor = MintPrimary
    )

    val themesList = listOf(
        "menta" to ("Menta" to Color(0xFF0D9488)),
        "ocaso" to ("Ocaso" to Color(0xFFD97706)),
        "bosque" to ("Bosque" to Color(0xFF15803D)),
        "noche" to ("Noche" to Color(0xFFFACC15)),
        "cielo" to ("Cielo" to Color(0xFF2563EB)),
        "coral" to ("Coral" to Color(0xFFE11D48)),
        "lavanda" to ("Lavanda" to Color(0xFF7C3AED)),
        "custom" to ("Personalizado" to MintPrimary)
    )

    BasicAlertDialog(onDismissRequest = onDismiss) {
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .imePadding()
                .heightIn(max = 640.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(SurfaceLevel1)
                .border(1.dp, BorderHairline, RoundedCornerShape(24.dp))
                .padding(20.dp)
        ) {
            Column {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Outlined.Store, contentDescription = null, tint = MintPrimary, modifier = Modifier.size(22.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = "Personalizar Mi Negocio",
                            fontSize = 17.sp,
                            fontWeight = FontWeight.Bold,
                            color = TextHighEmphasis
                        )
                        Text(
                            text = "Página pública, redes, tema y reglas operativas",
                            fontSize = 11.sp,
                            color = TextMediumEmphasis
                        )
                    }
                    IconButton(onClick = onDismiss, modifier = Modifier.size(48.dp)) {
                        Icon(Icons.Outlined.Close, contentDescription = "Cerrar", tint = TextMediumEmphasis)
                    }
                }

                Spacer(modifier = Modifier.height(14.dp))

                if (errorMessage != null) {
                    Text(errorMessage, color = com.pediturno.servicios.core.theme.CrimsonCancelled, fontSize = 12.sp)
                    Spacer(modifier = Modifier.height(8.dp))
                }

                TabRow(
                    selectedTabIndex = selectedTab,
                    containerColor = SurfaceLevel2,
                    contentColor = MintPrimary,
                    indicator = { tabPositions ->
                        TabRowDefaults.SecondaryIndicator(
                            Modifier.tabIndicatorOffset(tabPositions[selectedTab]),
                            color = MintPrimary
                        )
                    },
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(12.dp))
                ) {
                    Tab(
                        selected = selectedTab == 0,
                        onClick = { selectedTab = 0 },
                        text = { Text("Página y redes", fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                    )
                    Tab(
                        selected = selectedTab == 1,
                        onClick = { selectedTab = 1 },
                        text = { Text("Temas", fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                    )
                    Tab(
                        selected = selectedTab == 2,
                        onClick = { selectedTab = 2 },
                        text = { Text("Reservas", fontSize = 11.sp, fontWeight = FontWeight.Bold) }
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                LazyColumn(
                    modifier = Modifier.testTag("business_profile_fields")
                        .fillMaxWidth()
                        .weight(1f, fill = false)
                        .heightIn(max = 480.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    if (selectedTab == 0) {
                        // TAB 0: INFORMACIÓN DEL NEGOCIO & REDES
                        item {
                            OutlinedTextField(
                                value = name,
                                onValueChange = { name = it },
                                label = { Text("Nombre del Negocio") },
                                colors = fieldColors,
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth().testTag(BusinessProfileTestTags.NAME)
                            )
                        }

                        item {
                            val previewModel = selectedLogoUri ?: logoUrl
                            if (!previewModel.isNullOrBlank()) {
                                AsyncImage(
                                    model = previewModel,
                                    contentDescription = "Vista previa del logo del negocio",
                                    contentScale = ContentScale.Fit,
                                    onLoading = { logoPreviewLoading = true; logoPreviewError = false },
                                    onSuccess = { logoPreviewLoading = false; logoPreviewError = false },
                                    onError = { logoPreviewLoading = false; logoPreviewError = true },
                                    modifier = Modifier.size(96.dp).clip(RoundedCornerShape(12.dp))
                                )
                                Text(
                                    when {
                                        logoPreviewError -> "No se pudo mostrar la imagen. Elegí otra."
                                        logoPreviewLoading -> "Cargando vista previa…"
                                        selectedLogoUri != null -> "El logo seleccionado se subirá al guardar."
                                        else -> "Logo guardado del negocio"
                                    },
                                    color = if (logoPreviewError) CrimsonCancelled else TextMediumEmphasis,
                                    fontSize = 12.sp
                                )
                            }
                            OutlinedButton(
                                onClick = {
                                    logoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                                },
                                enabled = !isSubmitting,
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Text(
                                    if (selectedLogoUri == null && logoUrl.isNullOrBlank()) "Agregar logo del negocio" else "Cambiar logo del negocio",
                                    color = MintPrimary
                                )
                            }
                        }

                        item {
                            OutlinedTextField(
                                value = slug,
                                onValueChange = { slug = it.lowercase().replace(" ", "-") },
                                label = { Text("URL Pública (pediturno.com/tu-slug)") },
                                colors = fieldColors,
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }

                        item {
                            OutlinedTextField(
                                value = description,
                                onValueChange = { description = it },
                                label = { Text("Biografía / Descripción del Local") },
                                colors = fieldColors,
                                maxLines = 3,
                                modifier = Modifier.fillMaxWidth()
                            )
                        }

                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(SurfaceLevel2)
                                    .padding(12.dp)
                            ) {
                                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        verticalAlignment = Alignment.CenterVertically,
                                        horizontalArrangement = Arrangement.SpaceBetween
                                    ) {
                                        Text("Botón de WhatsApp en página", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = TextHighEmphasis)
                                        Switch(
                                            checked = whatsappButtonEnabled,
                                            onCheckedChange = { whatsappButtonEnabled = it },
                                            colors = SwitchDefaults.colors(checkedThumbColor = MintPrimary)
                                        )
                                    }
                                    if (whatsappButtonEnabled) {
                                        OutlinedTextField(
                                            value = whatsappNumber,
                                            onValueChange = { whatsappNumber = it },
                                            label = { Text("Número de WhatsApp (+54...)") },
                                            colors = fieldColors,
                                            singleLine = true,
                                            modifier = Modifier.fillMaxWidth()
                                        )
                                    }
                                }
                            }
                        }

                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(SurfaceLevel2)
                                    .padding(12.dp)
                            ) {
                                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text("Dirección del Establecimiento", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = TextHighEmphasis)
                                    OutlinedTextField(value = postalCode, onValueChange = { postalCode = it }, label = { Text("Código postal") }, singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth())
                                    OutlinedTextField(value = country, onValueChange = { country = it }, label = { Text("País") }, singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth())
                                    Text("Ubicación opcional en el mapa. Dejá ambas coordenadas vacías para usar la dirección.", color = TextSubtle, fontSize = 11.sp)
                                    OutlinedTextField(value = latitude, onValueChange = { latitude = it }, label = { Text("Latitud (-90 a 90)") }, isError = !validLocation, singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth())
                                    OutlinedTextField(value = longitude, onValueChange = { longitude = it }, label = { Text("Longitud (-180 a 180)") }, isError = !validLocation, singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth())
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        OutlinedTextField(
                                            value = street,
                                            onValueChange = { street = it },
                                            label = { Text("Calle") },
                                            colors = fieldColors,
                                            singleLine = true,
                                            modifier = Modifier.weight(2f)
                                        )
                                        OutlinedTextField(
                                            value = number,
                                            onValueChange = { number = it },
                                            label = { Text("Número") },
                                            colors = fieldColors,
                                            singleLine = true,
                                            modifier = Modifier.weight(1f)
                                        )
                                    }
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        OutlinedTextField(
                                            value = city,
                                            onValueChange = { city = it },
                                            label = { Text("Ciudad") },
                                            colors = fieldColors,
                                            singleLine = true,
                                            modifier = Modifier.weight(1f)
                                        )
                                        OutlinedTextField(
                                            value = province,
                                            onValueChange = { province = it },
                                            label = { Text("Provincia") },
                                            colors = fieldColors,
                                            singleLine = true,
                                            modifier = Modifier.weight(1f)
                                        )
                                    }
                                }
                            }
                        }

                        item {
                            // Redes sociales (hasta 5)
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(SurfaceLevel2)
                                    .padding(12.dp)
                            ) {
                                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text("Redes Sociales (${socialLinks.size}/5)", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = TextHighEmphasis)
                                        if (socialLinks.size < 5) {
                                            TextButton(
                                                onClick = {
                                                    socialLinks.add(
                                                        SocialLink(
                                                            id = "sl_" + UUID.randomUUID().toString().substring(0, 4),
                                                            type = SocialLinkType.INSTAGRAM,
                                                            url = "https://instagram.com/",
                                                            title = "Instagram"
                                                        )
                                                    )
                                                }
                                            ) {
                                                Icon(Icons.Outlined.Add, contentDescription = null, modifier = Modifier.size(14.dp), tint = MintPrimary)
                                                Spacer(modifier = Modifier.width(4.dp))
                                                Text("Agregar", fontSize = 11.sp, color = MintPrimary)
                                            }
                                        }
                                    }

                                    socialLinks.forEachIndexed { idx, link ->
                                        Box {
                                            TextButton(onClick = { socialMenu = link.id }) { Text(link.type.label, color = MintPrimary) }
                                            DropdownMenu(expanded = socialMenu == link.id, onDismissRequest = { socialMenu = null }) {
                                                SocialLinkType.entries.forEach { type ->
                                                    DropdownMenuItem(text = { Text(type.label) }, onClick = {
                                                        socialLinks[idx] = link.copy(type = type, title = if (type == SocialLinkType.CUSTOM) link.title else type.label)
                                                        socialMenu = null
                                                    })
                                                }
                                            }
                                        }
                                        if (link.type == SocialLinkType.CUSTOM) OutlinedTextField(
                                            value = link.title, onValueChange = { socialLinks[idx] = link.copy(title = it) },
                                            label = { Text("Título del enlace") }, singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth()
                                        )
                                        Row(
                                            modifier = Modifier.fillMaxWidth(),
                                            verticalAlignment = Alignment.CenterVertically,
                                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                                        ) {
                                            OutlinedTextField(
                                                value = link.url,
                                                onValueChange = { newUrl ->
                                                    socialLinks[idx] = link.copy(url = newUrl)
                                                },
                                                label = { Text(link.title.ifBlank { "URL" }) },
                                                colors = fieldColors,
                                                singleLine = true,
                                                modifier = Modifier.weight(1f)
                                            )
                                            IconButton(
                                                onClick = { socialLinks.removeAt(idx) },
                                                modifier = Modifier.size(28.dp)
                                            ) {
                                                Icon(Icons.Outlined.Delete, contentDescription = "Eliminar", tint = CrimsonCancelled, modifier = Modifier.size(16.dp))
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    } else if (selectedTab == 1) {
                        // TAB 1: TEMAS VISUALES OFICIALES
                        item {
                            Text(
                                text = "SELECCIONÁ LA PALETA DE TU PÁGINA PÚBLICA",
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                                color = TextSubtle
                            )
                        }

                        items(themesList.size) { idx ->
                            val (key, pair) = themesList[idx]
                            val (themeLabel, themeColor) = pair
                            val isSelected = selectedTheme.equals(key, ignoreCase = true)

                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(SurfaceLevel2)
                                    .border(
                                        width = if (isSelected) 1.5.dp else 0.5.dp,
                                        color = if (isSelected) MintPrimary else BorderSubtle,
                                        shape = RoundedCornerShape(14.dp)
                                    )
                                    .clickable { selectedTheme = key }
                                    .padding(12.dp)
                            ) {
                                Row(
                                    modifier = Modifier.fillMaxWidth(),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.SpaceBetween
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Box(
                                            modifier = Modifier
                                                .size(24.dp)
                                                .clip(CircleShape)
                                                .background(themeColor)
                                                .border(1.dp, Color.White.copy(alpha = 0.2f), CircleShape)
                                        )
                                        Spacer(modifier = Modifier.width(10.dp))
                                        Text(
                                            text = themeLabel,
                                            fontSize = 14.sp,
                                            fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Medium,
                                            color = if (isSelected) MintPrimary else TextHighEmphasis
                                        )
                                    }
                                    if (isSelected) {
                                        Icon(
                                            Icons.Outlined.Check,
                                            contentDescription = "Seleccionado",
                                            tint = MintPrimary,
                                            modifier = Modifier.size(18.dp)
                                        )
                                    }
                                }
                            }
                        }
                        if (selectedTheme == "custom") item {
                            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Text("Colores en formato #RRGGBB", color = TextSubtle)
                                OutlinedTextField(value = primary, onValueChange = { primary = it }, label = { Text("Color principal") }, singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth())
                                OutlinedTextField(value = background, onValueChange = { background = it }, label = { Text("Color de fondo") }, singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth())
                                OutlinedTextField(value = accent, onValueChange = { accent = it }, label = { Text("Color de acento") }, singleLine = true, colors = fieldColors, modifier = Modifier.fillMaxWidth())
                            }
                        }
                    } else {
                        // Deposit settings have one authoritative editor in Mi negocio.
                        item {
                            Text(
                                "Administrá la cuenta y las señas desde Mercado Pago en Mi negocio.",
                                fontSize = 12.sp, color = TextMediumEmphasis
                            )
                        }

                        item {
                            Box(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clip(RoundedCornerShape(14.dp))
                                    .background(SurfaceLevel2)
                                    .padding(12.dp)
                            ) {
                                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                    Text("Reglas de Disponibilidad y Agenda", fontSize = 13.sp, fontWeight = FontWeight.Bold, color = TextHighEmphasis)

                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        OutlinedTextField(
                                            value = leadTimeHours,
                                            onValueChange = { leadTimeHours = it },
                                            label = { Text("Antelación (horas)") },
                                            colors = fieldColors,
                                            singleLine = true,
                                            modifier = Modifier.weight(1f)
                                        )
                                        OutlinedTextField(
                                            value = horizonDays,
                                            onValueChange = { horizonDays = it },
                                            label = { Text("Horizonte (días)") },
                                            colors = fieldColors,
                                            singleLine = true,
                                            modifier = Modifier.weight(1f)
                                        )
                                        OutlinedTextField(
                                            value = bufferMinutes,
                                            onValueChange = { bufferMinutes = it },
                                            label = { Text("Pausa (min)") },
                                            colors = fieldColors,
                                            singleLine = true,
                                            modifier = Modifier.weight(1f)
                                        )
                                    }

                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text("Auto-confirmar turnos automáticamente", fontSize = 12.sp, color = TextMediumEmphasis)
                                        Switch(
                                            checked = autoConfirm,
                                            onCheckedChange = { autoConfirm = it },
                                            colors = SwitchDefaults.colors(checkedThumbColor = MintPrimary)
                                        )
                                    }

                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text("Recibir un correo por cada nueva reserva", fontSize = 12.sp, color = TextMediumEmphasis)
                                        Switch(
                                            checked = notifyEmailEnabled,
                                            onCheckedChange = { notifyEmailEnabled = it },
                                            colors = SwitchDefaults.colors(checkedThumbColor = MintPrimary)
                                        )
                                    }

                                    Row(
                                        modifier = Modifier.fillMaxWidth(),
                                        horizontalArrangement = Arrangement.SpaceBetween,
                                        verticalAlignment = Alignment.CenterVertically
                                    ) {
                                        Text("Enviar recordatorios automáticos", fontSize = 12.sp, color = TextMediumEmphasis)
                                        Switch(
                                            checked = remindersEnabled,
                                            onCheckedChange = { remindersEnabled = it },
                                            colors = SwitchDefaults.colors(checkedThumbColor = MintPrimary)
                                        )
                                    }

                                    if (notifyEmailEnabled) {
                                        Text(
                                            "Se enviará al guardar una reserva nueva. Las notificaciones del teléfono se configuran desde los permisos del dispositivo.",
                                            fontSize = 10.sp,
                                            color = TextSubtle
                                        )
                                        OutlinedTextField(
                                            value = notificationEmail,
                                            onValueChange = { notificationEmail = it },
                                            label = { Text("Correo para avisos") },
                                            colors = fieldColors,
                                            singleLine = true,
                                            modifier = Modifier.fillMaxWidth()
                                        )
                                    }
                                }
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(18.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    OutlinedButton(
                        onClick = onDismiss,
                        modifier = Modifier.weight(1f),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text("Cancelar", color = TextMediumEmphasis, fontSize = 13.sp)
                    }

                    Button(
                        onClick = {
                            val updatedProfile = profile.copy(
                                name = name.trim(),
                                slug = slug.trim(),
                                description = description.trim(),
                                logoUrl = logoUrl,
                                whatsappButtonEnabled = whatsappButtonEnabled,
                                whatsappNumber = whatsappNumber.trim(),
                                address = Address(street.trim(), number.trim(), city.trim(), province.trim(), postalCode.trim(), country.trim()),
                                location = if (latitude.isBlank() && longitude.isBlank()) null else GeoLocation(latitude.toDouble(), longitude.toDouble()),
                                theme = selectedTheme,
                                customTheme = CustomThemeColors(primary, background, accent),
                                socialLinks = socialLinks.toList(),
                                bookingRules = BookingRules(
                                    leadTimeHours = leadTimeHours.toIntOrNull() ?: 2,
                                    horizonDays = horizonDays.toIntOrNull() ?: 30,
                                    bufferMinutes = bufferMinutes.toIntOrNull() ?: 15,
                                    autoConfirm = autoConfirm,
                                    remindersEnabled = remindersEnabled,
                                    notifyNewByEmail = notifyEmailEnabled,
                                    notificationEmail = notificationEmail.trim()
                                )
                            )
                            onSaveProfile(updatedProfile, selectedLogoUri?.let(Uri::parse))
                        },
                        modifier = Modifier.weight(1f).testTag(BusinessProfileTestTags.SAVE),
                        enabled = validLocation && (selectedTheme != "custom" || listOf(primary, background, accent).all { Regex("^#[0-9a-fA-F]{6}$").matches(it) }) && !isSubmitting && !(selectedLogoUri != null && logoPreviewError) && name.isNotBlank() && slug.isNotBlank() &&
                            (!notifyEmailEnabled || notificationEmail.contains("@")),
                        shape = RoundedCornerShape(12.dp),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MintPrimary,
                            contentColor = OnMintPrimary
                        )
                    ) {
                        Icon(Icons.Outlined.Check, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(modifier = Modifier.width(6.dp))
                        Text("Guardar Cambios", fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }
            }
        }
    }
}
