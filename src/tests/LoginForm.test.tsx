import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import AuthForm from '@/components/LoginForm';

const mocks = vi.hoisted(() => ({
  connection: { ready: true, error: null as string | null, retry: vi.fn() },
  ensureFirebaseReady: vi.fn().mockResolvedValue(undefined),
  push: vi.fn(),
  toast: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  signInWithPopup: vi.fn(),
  signOut: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  sendEmailVerification: vi.fn(),
  sendPasswordResetEmail: vi.fn(),
  updateProfile: vi.fn(),
  onAuthStateChanged: vi.fn(() => vi.fn()),
  getBusinessProfile: vi.fn(),
  updateBusinessProfile: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}));

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(),
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
  signInWithPopup: mocks.signInWithPopup,
  signOut: mocks.signOut,
  createUserWithEmailAndPassword: mocks.createUserWithEmailAndPassword,
  sendEmailVerification: mocks.sendEmailVerification,
  sendPasswordResetEmail: mocks.sendPasswordResetEmail,
  updateProfile: mocks.updateProfile,
  onAuthStateChanged: mocks.onAuthStateChanged,
}));

vi.mock('@/lib/firebase', () => ({ auth: {}, ensureFirebaseReady: mocks.ensureFirebaseReady }));
vi.mock('@/hooks/useFirebaseReady', () => ({ useFirebaseReady: () => mocks.connection }));

vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));

vi.mock('@/services/data', () => ({
  getBusinessProfile: mocks.getBusinessProfile,
  updateBusinessProfile: mocks.updateBusinessProfile,
}));

describe('AuthForm', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connection.ready = true;
    mocks.connection.error = null;
    mocks.ensureFirebaseReady.mockResolvedValue(undefined);
    sessionStorage.clear();
    mocks.onAuthStateChanged.mockImplementation(() => vi.fn());
  });

  it('explains the dedicated services login', () => {
    render(<AuthForm onSuccess={() => {}} />);

    expect(screen.getByText(/acceso para servicios y profesionales/i)).toBeInTheDocument();
    expect(screen.queryByText(/un solo acceso para toda la plataforma/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ingresar con google/i })).toBeInTheDocument();
  });

  it('opens registration on the requested sports modality', () => {
    render(
      <AuthForm
        onSuccess={() => {}}
        initialTab="register"
        initialVertical="sports_facility"
      />,
    );

    expect(screen.getByText('Cuenta para canchas y complejos')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Servicios$/ })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /crear cuenta con google/i })).toBeInTheDocument();
  });

  it('does not overwrite the modality of an existing account during login', async () => {
    const user = { uid: 'owner-1', email: 'club@example.com' };
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user });
    mocks.getBusinessProfile.mockResolvedValue({
      id: 'owner-1',
      email: 'club@example.com',
      name: 'Club Norte',
      businessType: 'sports_facility',
    });
    const onSuccess = vi.fn();

    render(
      <AuthForm
        onSuccess={onSuccess}
        initialTab="login"
        initialVertical="services"
      />,
    );

    fireEvent.change(screen.getByLabelText(/correo electrónico/i), {
      target: { value: 'club@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^contraseña$/i), {
      target: { value: 'secret123' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^iniciar sesión$/i }));

    await waitFor(() => expect(screen.getByRole('link', { name: 'Ir a Canchas' })).toHaveAttribute('href', 'https://canchas.pediturno.com/?login=1'));
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.updateBusinessProfile).not.toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('asks for an explicit modality when Google login has no business profile', async () => {
    const user = { uid: 'owner-2', email: 'new@example.com', displayName: 'Club Nuevo', emailVerified: true };
    mocks.signInWithPopup.mockResolvedValue({ user });
    mocks.getBusinessProfile.mockResolvedValue(null);

    render(<AuthForm onSuccess={() => {}} initialTab="login" />);
    fireEvent.click(screen.getByRole('button', { name: /ingresar con google/i }));

    expect(await screen.findByText(/tu acceso ya está creado/i)).toBeInTheDocument();
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.updateBusinessProfile).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'Completá la creación de tu cuenta',
    }));
    expect(screen.getByRole('tab', { name: /crear cuenta/i })).toHaveAttribute('data-state', 'active');
    expect(screen.queryByLabelText(/^contraseña$/i)).not.toBeInTheDocument();
    expect(screen.getByLabelText(/correo electrónico/i)).toBeDisabled();
    expect(screen.getByRole('button', { name: /completar cuenta/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /google/i })).not.toBeInTheDocument();
  });

  it('completes a verified authenticated identity without creating Firebase Auth again', async () => {
    const user: any = {
      uid: 'owner-cross-device',
      email: 'cross-device@example.com',
      displayName: 'Cuenta incompleta',
      emailVerified: true,
    };
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user });
    mocks.getBusinessProfile.mockResolvedValue(null);

    render(<AuthForm onSuccess={() => {}} initialVertical="sports_facility" />);
    fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: /^iniciar sesión$/i }));

    expect(await screen.findByText(/tu acceso ya está creado/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/nombre de tu negocio/i), { target: { value: 'Club Recuperado' } });
    fireEvent.click(screen.getByRole('button', { name: /completar cuenta/i }));

    await waitFor(() => expect(mocks.updateBusinessProfile).toHaveBeenCalledWith(user.uid, expect.objectContaining({
      email: user.email,
      name: 'Club Recuperado',
      businessType: 'sports_facility',
    })));
    expect(mocks.createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(mocks.updateProfile).toHaveBeenCalledWith(user, { displayName: 'Club Recuperado' });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/dashboard'));
  });

  it('collects the missing profile data and verifies an unverified authenticated identity', async () => {
    const user: any = {
      uid: 'owner-cross-device-unverified',
      email: 'pending@example.com',
      displayName: '',
      emailVerified: false,
    };
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user });
    mocks.getBusinessProfile.mockResolvedValue(null);
    mocks.sendEmailVerification.mockResolvedValue(undefined);

    render(<AuthForm onSuccess={() => {}} />);
    fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: /^iniciar sesión$/i }));

    expect(await screen.findByText(/tu acceso ya está creado/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/nombre de tu negocio/i), { target: { value: 'Estudio Pendiente' } });
    fireEvent.click(screen.getByRole('button', { name: /completar cuenta/i }));

    expect(await screen.findByRole('heading', { name: /verificá tu correo/i })).toBeInTheDocument();
    expect(mocks.createUserWithEmailAndPassword).not.toHaveBeenCalled();
    expect(mocks.sendEmailVerification).toHaveBeenCalledWith(user, { url: 'https://pediturno.com/?login=1' });
    expect(mocks.updateBusinessProfile).not.toHaveBeenCalled();
    expect(JSON.parse(sessionStorage.getItem(`pediturno_pending_signup:${user.uid}`) || '{}')).toMatchObject({
      name: 'Estudio Pendiente',
      vertical: 'services',
    });
  });

  it('ignores a delayed profile lookup after the authenticated UID changes', async () => {
    let authCallback: ((user: any) => void) | undefined;
    let resolveProfile: ((value: null) => void) | undefined;
    const delayedProfile = new Promise<null>((resolve) => { resolveProfile = resolve; });
    sessionStorage.setItem('pediturno_pending_signup:owner-old', JSON.stringify({
      name: 'Cuenta anterior',
      vertical: 'services',
    }));
    mocks.getBusinessProfile.mockReturnValue(delayedProfile);
    mocks.onAuthStateChanged.mockImplementation((_auth: unknown, callback: (user: any) => void) => {
      authCallback = callback;
      return vi.fn();
    });

    render(<AuthForm onSuccess={() => {}} />);
    await act(async () => {
      authCallback?.({ uid: 'owner-old', email: 'old@example.com', emailVerified: false });
      authCallback?.(null);
      resolveProfile?.(null);
      await delayedProfile;
    });

    expect(mocks.getBusinessProfile).toHaveBeenCalledWith('owner-old');
    expect(screen.queryByRole('heading', { name: /verificá tu correo/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^iniciar sesión$/i })).toBeInTheDocument();
  });

  it('does not bootstrap an email account until the address is verified', async () => {
    const user: any = {
      uid: 'owner-new',
      email: 'nuevo@example.com',
      emailVerified: false,
      reload: vi.fn(),
      getIdToken: vi.fn(),
    };
    mocks.createUserWithEmailAndPassword.mockResolvedValue({ user });
    mocks.updateProfile.mockResolvedValue(undefined);
    mocks.sendEmailVerification.mockResolvedValue(undefined);

    render(<AuthForm onSuccess={() => {}} initialTab="register" initialVertical="sports_facility" />);
    fireEvent.change(screen.getByLabelText(/nombre de tu negocio/i), { target: { value: 'Club Verificado' } });
    fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText(/^confirmar$/i), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: /crear cuenta gratis/i }));

    expect(await screen.findByRole('heading', { name: /verificá tu correo/i })).toBeInTheDocument();
    expect(mocks.sendEmailVerification).toHaveBeenCalledWith(user, { url: 'https://canchas.pediturno.com/?login=1' });
    expect(mocks.updateBusinessProfile).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /reenviar correo \(60s\)/i })).toBeDisabled();
    expect(JSON.parse(sessionStorage.getItem('pediturno_pending_signup:owner-new') || '{}')).toMatchObject({
      name: 'Club Verificado',
      vertical: 'sports_facility',
    });

    fireEvent.click(screen.getByRole('button', { name: /ya verifiqué mi correo/i }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      title: 'El correo todavía no está verificado',
    })));
    expect(mocks.updateBusinessProfile).not.toHaveBeenCalled();
  });

  it('bootstraps the pending profile only after reload confirms verification', async () => {
    const user: any = {
      uid: 'owner-verified',
      email: 'verificado@example.com',
      emailVerified: false,
      reload: vi.fn(async () => { user.emailVerified = true; }),
      getIdToken: vi.fn().mockResolvedValue('fresh-token'),
    };
    mocks.createUserWithEmailAndPassword.mockResolvedValue({ user });
    mocks.sendEmailVerification.mockResolvedValue(undefined);
    mocks.getBusinessProfile.mockResolvedValue(null);

    render(<AuthForm onSuccess={() => {}} initialTab="register" />);
    fireEvent.change(screen.getByLabelText(/nombre de tu negocio/i), { target: { value: 'Estudio Seguro' } });
    fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: 'secret123' } });
    fireEvent.change(screen.getByLabelText(/^confirmar$/i), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: /crear cuenta gratis/i }));
    fireEvent.click(await screen.findByRole('button', { name: /ya verifiqué mi correo/i }));

    await waitFor(() => expect(mocks.updateBusinessProfile).toHaveBeenCalledWith('owner-verified', expect.objectContaining({
      name: 'Estudio Seguro',
      businessType: 'services',
    })));
    expect(user.reload).toHaveBeenCalledOnce();
    expect(user.getIdToken).toHaveBeenCalledWith(true);
    expect(mocks.push).toHaveBeenCalledWith('/dashboard');
    expect(sessionStorage.getItem('pediturno_pending_signup:owner-verified')).toBeNull();
  });

  it('restores the verification step after a reload in the same tab', async () => {
    const user: any = { uid: 'owner-resume', email: 'resume@example.com', emailVerified: false };
    sessionStorage.setItem('pediturno_pending_signup:owner-resume', JSON.stringify({
      name: 'Club Resume',
      vertical: 'sports_facility',
      verificationSentAt: Date.now(),
    }));
    mocks.getBusinessProfile.mockResolvedValue(null);
    mocks.onAuthStateChanged.mockImplementation((_auth: unknown, callback: (value: unknown) => void) => {
      callback(user);
      return vi.fn();
    });

    render(<AuthForm onSuccess={() => {}} />);

    expect(await screen.findByRole('heading', { name: /verificá tu correo/i })).toBeInTheDocument();
    expect(screen.getByText(/resume@example.com/i)).toBeInTheDocument();
  });

  it('completes a verified pending account when it signs in without a profile', async () => {
    const user: any = {
      uid: 'owner-login-complete',
      email: 'complete@example.com',
      emailVerified: true,
    };
    sessionStorage.setItem('pediturno_pending_signup:owner-login-complete', JSON.stringify({
      name: 'Club Completo',
      vertical: 'sports_facility',
    }));
    mocks.signInWithEmailAndPassword.mockResolvedValue({ user });
    mocks.getBusinessProfile.mockResolvedValue(null);

    render(<AuthForm onSuccess={() => {}} />);
    fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: user.email } });
    fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: 'secret123' } });
    fireEvent.click(screen.getByRole('button', { name: /^iniciar sesión$/i }));

    await waitFor(() => expect(mocks.updateBusinessProfile).toHaveBeenCalledWith(user.uid, expect.objectContaining({
      name: 'Club Completo',
      businessType: 'sports_facility',
    })));
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(mocks.push).toHaveBeenCalledWith('/dashboard');
  });
});


describe('AuthForm secure initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks(); sessionStorage.clear();
    mocks.connection.ready = true; mocks.connection.error = null;
    mocks.ensureFirebaseReady.mockResolvedValue(undefined);
    mocks.onAuthStateChanged.mockImplementation(() => vi.fn());
  });
  it('keeps typed values, blocks login/Google while preparing, and lets the user retry', () => {
    mocks.connection.ready = false;
    mocks.connection.error = null;
    const view = render(<AuthForm onSuccess={() => {}} />);
    fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: 'qa@example.com' } });
    expect(screen.getByRole('status')).toHaveTextContent('Preparando tu acceso seguro');
    expect(screen.getByRole('button', { name: /^iniciar sesión$/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /ingresar con google/i })).toBeDisabled();
    expect(mocks.onAuthStateChanged).not.toHaveBeenCalled();
    mocks.connection.error = 'No pudimos verificar la conexión segura.';
    view.rerender(<AuthForm onSuccess={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /volver a intentar/i }));
    expect(mocks.connection.retry).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(/correo electrónico/i)).toHaveValue('qa@example.com');
    mocks.connection.error = null;
    mocks.connection.ready = true;
    view.rerender(<AuthForm onSuccess={() => {}} />);
    expect(screen.getByRole('button', { name: /^iniciar sesión$/i })).toBeEnabled();
    expect(mocks.onAuthStateChanged).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(/correo electrónico/i)).toHaveValue('qa@example.com');
  });

  it('opens Google from the click without awaiting another bootstrap request', async () => {
    mocks.connection.ready = true;
    mocks.signInWithPopup.mockRejectedValue({ code: 'auth/popup-closed-by-user' });
    render(<AuthForm onSuccess={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /ingresar con google/i }));
    expect(mocks.signInWithPopup).toHaveBeenCalledOnce();
    expect(mocks.ensureFirebaseReady).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('button', { name: /ingresar con google/i })).toBeEnabled());
  });

  it('does not label a failed App Check verification as an incorrect password', async () => {
    mocks.signInWithEmailAndPassword.mockRejectedValue({ code: 'auth/invalid-app-credential' });
    render(<AuthForm onSuccess={() => {}} />);
    fireEvent.change(screen.getByLabelText(/correo electrónico/i), { target: { value: 'qa@example.com' } });
    fireEvent.change(screen.getByLabelText(/^contraseña$/i), { target: { value: 'test-secret' } });
    fireEvent.click(screen.getByRole('button', { name: /^iniciar sesión$/i }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
      description: expect.stringContaining('acceso seguro'),
    })));
    expect(mocks.ensureFirebaseReady).toHaveBeenCalledOnce();
  });
});
