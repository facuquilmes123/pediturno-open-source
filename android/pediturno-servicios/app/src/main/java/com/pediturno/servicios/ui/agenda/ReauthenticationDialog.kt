package com.pediturno.servicios.ui.agenda

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

/**
 * UI-only reauthentication prompt. Provider calls and token refresh stay in the
 * caller so this composable never handles credentials outside its transient state.
 */
@Composable
fun ReauthenticationDialog(
    email: String,
    allowPassword: Boolean,
    allowGoogle: Boolean,
    isLoading: Boolean,
    error: String?,
    onPasswordSubmit: (String) -> Unit,
    onGoogleClick: () -> Unit,
    onDismiss: () -> Unit
) {
    var password by remember { mutableStateOf("") }
    DisposableEffect(Unit) {
        onDispose { password = "" }
    }

    fun submitPassword() {
        if (!isLoading && password.isNotEmpty()) {
            val submitted = password
            password = ""
            onPasswordSubmit(submitted)
        }
    }

    AlertDialog(
        onDismissRequest = { if (!isLoading) onDismiss() },
        title = { Text("Confirmá tu identidad") },
        text = {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .imePadding()
            ) {
                Text("Por seguridad, volvé a identificarte antes de solicitar la eliminación de tu cuenta.")
                Spacer(Modifier.height(8.dp))
                Text("Cuenta: $email")
                if (error != null) {
                    Spacer(Modifier.height(8.dp))
                    Text(error)
                }
                if (allowPassword) {
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = password,
                        onValueChange = { password = it },
                        enabled = !isLoading,
                        label = { Text("Contraseña") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submitPassword() }),
                        modifier = Modifier.fillMaxWidth()
                    )
                }
                if (allowGoogle) {
                    Spacer(Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = onGoogleClick,
                        enabled = !isLoading,
                        modifier = Modifier
                            .fillMaxWidth()
                            .heightIn(min = 48.dp)
                    ) { Text("Continuar con Google") }
                }
            }
        },
        confirmButton = {
            if (allowPassword) {
                Button(
                    onClick = ::submitPassword,
                    enabled = !isLoading && password.isNotEmpty(),
                    modifier = Modifier.heightIn(min = 48.dp)
                ) {
                    if (isLoading) CircularProgressIndicator(modifier = Modifier.height(20.dp)) else Text("Confirmar")
                }
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                enabled = !isLoading,
                modifier = Modifier.heightIn(min = 48.dp)
            ) { Text("Cancelar") }
        }
    )
}
