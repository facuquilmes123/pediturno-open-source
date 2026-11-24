const DEVICE_VERIFICATION_MESSAGE = 'No pudimos verificar tu dispositivo para reservar. Revisá tu conexión y volvé a intentarlo; tus datos siguen cargados.';
const REQUEST_VERIFICATION_MESSAGE = 'No pudimos verificar tu solicitud para reservar. Revisá tu conexión y volvé a intentarlo; tus datos siguen cargados.';
const NETWORK_MESSAGE = 'No se pudo conectar para guardar la reserva. Revisá tu conexión y volvé a intentarlo; tus datos siguen cargados.';

/** Maps known public-booking transport/attestation failures to safe retry guidance. */
export function publicBookingFailureMessage(error: unknown): string | null {
  const message = error instanceof Error ? error.message : '';
  if (/appcheck\/(?:recaptcha-error|token-error)|appcheck:\s*recaptcha/i.test(message)) return DEVICE_VERIFICATION_MESSAGE;
  if (message === 'PUBLIC_APP_CHECK_REJECTED') return REQUEST_VERIFICATION_MESSAGE;
  if (error instanceof TypeError || /(?:failed to fetch|networkerror|load failed)/i.test(message)) return NETWORK_MESSAGE;
  return null;
}
