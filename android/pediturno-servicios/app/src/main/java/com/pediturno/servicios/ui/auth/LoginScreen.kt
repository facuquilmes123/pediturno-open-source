package com.pediturno.servicios.ui.auth

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Business
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Shield
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import com.pediturno.servicios.R
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.pediturno.servicios.core.theme.BorderSubtle
import com.pediturno.servicios.core.theme.CrimsonCancelled
import com.pediturno.servicios.core.theme.CrimsonContainer
import com.pediturno.servicios.core.theme.EmeraldConfirmed
import com.pediturno.servicios.core.theme.EmeraldContainer
import com.pediturno.servicios.core.theme.MintPrimary
import com.pediturno.servicios.core.theme.ObsidianCanvas
import com.pediturno.servicios.core.theme.OnMintPrimary
import com.pediturno.servicios.core.theme.SurfaceLevel2
import com.pediturno.servicios.core.theme.TextHighEmphasis
import com.pediturno.servicios.core.theme.TextMediumEmphasis
import com.pediturno.servicios.core.theme.TextSubtle
import kotlinx.coroutines.launch

object LoginTestTags {
    const val BUSINESS_NAME = "login_business_name"
    const val EMAIL = "login_email"
    const val PASSWORD = "login_password"
    const val SUBMIT = "login_submit"
    const val TOGGLE_SIGN_UP = "login_toggle_sign_up"
}

@Composable
fun LoginScreen(
    viewModel: LoginViewModel,
    onLoginSuccess: () -> Unit,
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    var passwordVisible by rememberSaveable { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val submit: () -> Unit = {
        if (!uiState.isLoading) {
            focusManager.clearFocus()
            if (uiState.isSignUpMode) viewModel.register(onLoginSuccess)
            else viewModel.login(onLoginSuccess)
        }
    }
    val context = LocalContext.current
    val coroutineScope = rememberCoroutineScope()
    val googleCredentials = remember(context) { GoogleCredentialManager(context) }

    val fieldColors = OutlinedTextFieldDefaults.colors(
        focusedBorderColor = MintPrimary,
        unfocusedBorderColor = BorderSubtle,
        focusedTextColor = TextHighEmphasis,
        unfocusedTextColor = TextHighEmphasis,
        focusedLabelColor = MintPrimary,
        unfocusedLabelColor = TextMediumEmphasis,
        cursorColor = MintPrimary
    )

    Box(
        modifier = modifier
            .fillMaxSize()
            .background(ObsidianCanvas)
            .safeDrawingPadding(),
        contentAlignment = Alignment.Center
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center
        ) {
            // Emblema visual superior con Logo Oficial Pediturno
            Box(
                modifier = Modifier
                    .size(68.dp)
                    .clip(RoundedCornerShape(18.dp))
                    .background(SurfaceLevel2)
                    .border(1.5.dp, MintPrimary.copy(alpha = 0.5f), RoundedCornerShape(18.dp)),
                contentAlignment = Alignment.Center
            ) {
                Image(
                    painter = painterResource(id = R.drawable.pediturno_logo),
                    contentDescription = "Pediturno Logo",
                    contentScale = ContentScale.Fit,
                    modifier = Modifier
                        .size(44.dp)
                        .clip(RoundedCornerShape(8.dp))
                )
            }

            Spacer(modifier = Modifier.height(18.dp))

            Text(
                text = "Pediturno",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                color = TextHighEmphasis
            )

            Text(
                text = if (uiState.isSignUpMode) "Comenzá a recibir turnos en minutos" else "Gestión Profesional y Agenda Inteligente",
                fontSize = 13.sp,
                color = TextMediumEmphasis,
                modifier = Modifier.padding(top = 4.dp, bottom = 24.dp)
            )

            if (uiState.errorMessage != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(CrimsonContainer)
                        .border(1.dp, CrimsonCancelled.copy(alpha = 0.3f), RoundedCornerShape(10.dp))
                        .padding(12.dp)
                ) {
                    Text(
                        text = uiState.errorMessage!!,
                        color = CrimsonCancelled,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
                Spacer(modifier = Modifier.height(16.dp))
            }

            if (uiState.resetMessage != null) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(10.dp))
                        .background(EmeraldContainer)
                        .border(1.dp, EmeraldConfirmed.copy(alpha = 0.3f), RoundedCornerShape(10.dp))
                        .padding(12.dp)
                ) {
                    Text(
                        text = uiState.resetMessage!!,
                        color = EmeraldConfirmed,
                        fontSize = 13.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
                Spacer(modifier = Modifier.height(16.dp))
            }

            AnimatedVisibility(visible = uiState.isSignUpMode) {
                Column {
                    OutlinedTextField(
                        value = uiState.businessName,
                        onValueChange = viewModel::onBusinessNameChange,
                        label = { Text("Nombre de tu Negocio / Emprendimiento") },
                        leadingIcon = {
                            Icon(imageVector = Icons.Outlined.Business, contentDescription = null, tint = TextMediumEmphasis)
                        },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next),
                        keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Next) }),
                        singleLine = true,
                        colors = fieldColors,
                        modifier = Modifier.fillMaxWidth().testTag(LoginTestTags.BUSINESS_NAME)
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                }
            }

            OutlinedTextField(
                value = uiState.email,
                onValueChange = viewModel::onEmailChange,
                label = { Text("Correo electrónico") },
                leadingIcon = {
                    Icon(imageVector = Icons.Outlined.Mail, contentDescription = null, tint = TextMediumEmphasis)
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                keyboardActions = KeyboardActions(onNext = { focusManager.moveFocus(FocusDirection.Next) }),
                singleLine = true,
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth().testTag(LoginTestTags.EMAIL)
            )

            Spacer(modifier = Modifier.height(12.dp))

            OutlinedTextField(
                value = uiState.pass,
                onValueChange = viewModel::onPassChange,
                label = { Text("Contraseña") },
                leadingIcon = {
                    Icon(imageVector = Icons.Outlined.Lock, contentDescription = null, tint = TextMediumEmphasis)
                },
                visualTransformation = if (passwordVisible) VisualTransformation.None else PasswordVisualTransformation(),
                trailingIcon = {
                    IconButton(onClick = { passwordVisible = !passwordVisible }, modifier = Modifier.size(48.dp)) {
                        Icon(
                            if (passwordVisible) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                            contentDescription = if (passwordVisible) "Ocultar contraseña" else "Mostrar contraseña",
                            tint = TextMediumEmphasis
                        )
                    }
                },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                keyboardActions = KeyboardActions(onDone = { submit() }),
                singleLine = true,
                colors = fieldColors,
                modifier = Modifier.fillMaxWidth().testTag(LoginTestTags.PASSWORD)
            )

            if (!uiState.isSignUpMode) {
                Spacer(modifier = Modifier.height(6.dp))
                Box(
                    modifier = Modifier.fillMaxWidth(),
                    contentAlignment = Alignment.CenterEnd
                ) {
                    TextButton(onClick = viewModel::forgotPassword) {
                        Text("¿Olvidaste tu contraseña?", color = MintPrimary, fontSize = 12.sp)
                    }
                }
            } else {
                Spacer(modifier = Modifier.height(14.dp))
            }

            Spacer(modifier = Modifier.height(14.dp))

            Button(
                onClick = submit,
                enabled = !uiState.isLoading,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp)
                    .testTag(LoginTestTags.SUBMIT),
                shape = RoundedCornerShape(9999.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = MintPrimary,
                    contentColor = OnMintPrimary
                )
            ) {
                if (uiState.isLoading) {
                    CircularProgressIndicator(
                        color = OnMintPrimary,
                        modifier = Modifier.height(20.dp)
                    )
                } else {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        if (uiState.isSignUpMode) {
                            Icon(Icons.Outlined.AutoAwesome, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(modifier = Modifier.width(6.dp))
                        }
                        Text(
                            text = if (uiState.isSignUpMode) "Crear Cuenta Gratis" else "Acceder al Panel",
                            fontSize = 15.sp,
                            fontWeight = FontWeight.Bold,
                            color = OnMintPrimary
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            TextButton(enabled = !uiState.isLoading, onClick = {
                coroutineScope.launch {
                    googleCredentials.requestIdToken().fold(
                        onSuccess = { viewModel.loginWithGoogle(it, onLoginSuccess) },
                        onFailure = { viewModel.showGoogleError(it.message ?: "No se pudo abrir Google Sign-In.") }
                    )
                }
            }) { Text("Continuar con Google", color = MintPrimary, fontSize = 13.sp, fontWeight = FontWeight.SemiBold) }

            TextButton(
                onClick = viewModel::toggleSignUpMode,
                modifier = Modifier.testTag(LoginTestTags.TOGGLE_SIGN_UP)
            ) {
                Text(
                    text = if (uiState.isSignUpMode) "¿Ya tenés una cuenta? Iniciar Sesión" else "¿Nuevo en Pediturno? Crear cuenta de negocio",
                    color = MintPrimary,
                    fontSize = 13.sp,
                    fontWeight = FontWeight.SemiBold
                )
            }

            Spacer(modifier = Modifier.height(20.dp))

            Row(
                modifier = Modifier.fillMaxWidth()
                    .background(SurfaceLevel2, RoundedCornerShape(10.dp))
                    .border(1.dp, BorderSubtle, RoundedCornerShape(10.dp))
                    .padding(10.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                Icon(
                    imageVector = Icons.Outlined.Shield,
                    contentDescription = null,
                    tint = TextSubtle,
                    modifier = Modifier.size(13.dp)
                )
                Spacer(modifier = Modifier.width(5.dp))
                Text(
                    text = "Conexión cifrada • Integración con Mercado Pago",
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.weight(1f),
                    color = TextSubtle
                )
            }
        }
    }
}
