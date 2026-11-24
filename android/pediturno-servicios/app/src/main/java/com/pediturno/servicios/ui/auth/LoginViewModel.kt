package com.pediturno.servicios.ui.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.pediturno.servicios.data.repository.AuthRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class LoginUiState(
    val email: String = "",
    val pass: String = "",
    val businessName: String = "",
    val isSignUpMode: Boolean = false,
    val isLoading: Boolean = false,
    val errorMessage: String? = null,
    val resetMessage: String? = null
)

class LoginViewModel(
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = _uiState.asStateFlow()

    fun onEmailChange(newEmail: String) {
        _uiState.update { it.copy(email = newEmail, errorMessage = null) }
    }

    fun onPassChange(newPass: String) {
        _uiState.update { it.copy(pass = newPass, errorMessage = null) }
    }

    fun onBusinessNameChange(name: String) {
        _uiState.update { it.copy(businessName = name, errorMessage = null) }
    }

    fun toggleSignUpMode() {
        _uiState.update {
            it.copy(
                isSignUpMode = !it.isSignUpMode,
                errorMessage = null,
                resetMessage = null
            )
        }
    }

    fun login(onSuccess: () -> Unit) {
        val state = _uiState.value
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val result = authRepository.login(state.email, state.pass)
            result.fold(
                onSuccess = {
                    _uiState.update { it.copy(isLoading = false, pass = "", businessName = "") }
                    onSuccess()
                },
                onFailure = { err ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = err.message ?: "Credenciales inválidas"
                        )
                    }
                }
            )
        }
    }

    fun register(onSuccess: () -> Unit) {
        val state = _uiState.value
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
            val result = authRepository.register(state.businessName, state.email, state.pass)
            result.fold(
                onSuccess = {
                    _uiState.update { it.copy(isLoading = false, pass = "", businessName = "") }
                    onSuccess()
                },
                onFailure = { err ->
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            errorMessage = err.message ?: "Error al crear la cuenta"
                        )
                    }
                }
            )
        }
    }

    fun forgotPassword() {
        val email = _uiState.value.email
        viewModelScope.launch {
            authRepository.sendPasswordReset(email).fold(onSuccess = {
                _uiState.update {
                    it.copy(resetMessage = "Instrucciones de recuperación enviadas a $email.")
                }
            }, onFailure = {
                _uiState.update { it.copy(errorMessage = "Ingresá un correo electrónico válido primero.") }
            })
        }
    }

    fun loginWithGoogle(idToken: String, onSuccess: () -> Unit) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, errorMessage = null) }
        authRepository.signInWithGoogleIdToken(idToken).fold(onSuccess = { _uiState.update { it.copy(isLoading = false, pass = "", businessName = "") }; onSuccess() }, onFailure = { error -> _uiState.update { it.copy(isLoading = false, errorMessage = error.message ?: "No se pudo iniciar sesión con Google.") } })
        }
    }

    fun showGoogleError(message: String) { _uiState.update { it.copy(errorMessage = message) } }
}
