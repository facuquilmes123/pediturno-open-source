import { describe, expect, it } from 'vitest';
import { publicBookingFailureMessage } from '@/lib/public-booking-error';

describe('public booking failure messages', () => {
  it('explains a reCAPTCHA Enterprise App Check failure without exposing provider details', () => {
    expect(publicBookingFailureMessage(new Error('FirebaseError: AppCheck: ReCAPTCHA error. (appCheck/recaptcha-error)')))
      .toBe('No pudimos verificar tu dispositivo para reservar. Revisá tu conexión y volvé a intentarlo; tus datos siguen cargados.');
  });

  it('explains rejected App Check HTTP requests and network failures while preserving a generic fallback', () => {
    expect(publicBookingFailureMessage(new Error('PUBLIC_APP_CHECK_REJECTED')))
      .toBe('No pudimos verificar tu solicitud para reservar. Revisá tu conexión y volvé a intentarlo; tus datos siguen cargados.');
    expect(publicBookingFailureMessage(new TypeError('Failed to fetch')))
      .toBe('No se pudo conectar para guardar la reserva. Revisá tu conexión y volvé a intentarlo; tus datos siguen cargados.');
    expect(publicBookingFailureMessage(new Error('Booking unavailable'))).toBeNull();
  });
});
