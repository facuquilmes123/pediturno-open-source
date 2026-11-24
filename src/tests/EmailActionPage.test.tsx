import { StrictMode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import EmailActionPage from '@/components/EmailActionPage';

const mocks = vi.hoisted(() => ({
  ensure: vi.fn(), check: vi.fn(), apply: vi.fn(), verifyReset: vi.fn(), confirmReset: vi.fn(),
}));
vi.mock('@/lib/firebase', () => ({ auth: {}, ensureFirebaseReady: mocks.ensure }));
vi.mock('firebase/auth', () => ({ checkActionCode: mocks.check, applyActionCode: mocks.apply, verifyPasswordResetCode: mocks.verifyReset, confirmPasswordReset: mocks.confirmReset }));

function link(mode = 'verifyEmail', extra = '') {
  window.history.replaceState({}, '', '/auth/action?mode=' + mode + '&oobCode=synthetic-code' + extra);
}

describe('email action page', () => {
  beforeEach(() => {
    vi.resetAllMocks(); mocks.ensure.mockResolvedValue(undefined);
    mocks.check.mockResolvedValue({ operation: 'VERIFY_EMAIL', data: { email: 'private@example.test' } });
    mocks.apply.mockResolvedValue(undefined); mocks.verifyReset.mockResolvedValue('private@example.test'); mocks.confirmReset.mockResolvedValue(undefined);
    link();
  });
  it('waits for attestation and removes the URL code before checking it; verification requires a click', async () => {
    let ready!: () => void; mocks.ensure.mockReturnValue(new Promise<void>(resolve => { ready = resolve; }));
    render(<EmailActionPage />);
    expect(window.location.search).toBe(''); expect(mocks.check).not.toHaveBeenCalled(); expect(mocks.apply).not.toHaveBeenCalled();
    await act(async () => ready());
    const button = await screen.findByRole('button', { name: 'Confirmar verificación' });
    expect(mocks.check).toHaveBeenCalledWith({}, 'synthetic-code'); expect(mocks.apply).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain('private@example.test');
    fireEvent.click(button);
    await screen.findByText('Listo, tu cuenta está actualizada'); expect(mocks.apply).toHaveBeenCalledWith({}, 'synthetic-code');
    expect(screen.getByRole('link', { name: 'Volver al ingreso' })).toHaveAttribute('href', 'https://pediturno.com/?login=1');
  });
  it('retains the code on a readiness retry despite having cleaned the URL', async () => {
    mocks.ensure.mockRejectedValueOnce(new Error('private-provider-details'));
    render(<EmailActionPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Volver a intentar' }));
    await screen.findByRole('button', { name: 'Confirmar verificación' });
    expect(mocks.check).toHaveBeenCalledWith({}, 'synthetic-code'); expect(document.body.textContent).not.toContain('private-provider-details');
  });
  it('keeps the captured link under StrictMode effect replay without consuming it automatically', async () => {
    render(<StrictMode><EmailActionPage /></StrictMode>);
    await screen.findByRole('button', { name: 'Confirmar verificación' });
    expect(mocks.check).toHaveBeenCalledTimes(1); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('rejects a code for another operation', async () => {
    mocks.check.mockResolvedValue({ operation: 'RECOVER_EMAIL' }); render(<EmailActionPage />);
    await screen.findByRole('alert'); expect(screen.queryByRole('button', { name: 'Confirmar verificación' })).not.toBeInTheDocument(); expect(mocks.apply).not.toHaveBeenCalled();
  });
  it('does not initialize Auth for unsupported or incomplete links', async () => {
    window.history.replaceState({}, '', '/auth/action?mode=unsupported&oobCode=synthetic'); render(<EmailActionPage />);
    await screen.findByRole('alert'); expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.check).not.toHaveBeenCalled();
  });
  it('does not submit two mutations while a confirmation is in flight', async () => {
    let finish!: () => void; mocks.apply.mockReturnValue(new Promise<void>(resolve => { finish = resolve; }));
    render(<EmailActionPage />); const button = await screen.findByRole('button', { name: 'Confirmar verificación' });
    fireEvent.click(button); fireEvent.click(button);
    await waitFor(() => expect(mocks.apply).toHaveBeenCalledTimes(1));
    await act(async () => finish()); await screen.findByText('Listo, tu cuenta está actualizada');
  });
  it('validates the reset code, rejects mismatched passwords and clears them after completion', async () => {
    link('resetPassword'); render(<EmailActionPage />);
    const password = await screen.findByLabelText('Nueva contraseña'); const confirmation = screen.getByLabelText('Repetí la contraseña');
    expect(mocks.verifyReset).toHaveBeenCalledWith({}, 'synthetic-code'); expect(mocks.confirmReset).not.toHaveBeenCalled();
    fireEvent.change(password, { target: { value: 'Only-Unit-Fixture-123!' } }); fireEvent.change(confirmation, { target: { value: 'different-fixture' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Las contraseñas no coinciden.'); expect(mocks.confirmReset).not.toHaveBeenCalled();
    fireEvent.change(confirmation, { target: { value: 'Only-Unit-Fixture-123!' } }); fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));
    await screen.findByText('Ya podés ingresar con tu nueva contraseña.');
    expect(mocks.confirmReset).toHaveBeenCalledWith({}, 'synthetic-code', 'Only-Unit-Fixture-123!'); expect(screen.queryByLabelText('Nueva contraseña')).not.toBeInTheDocument();
  });
  it('shows a provider password policy rejection without leaking its message or losing the form', async () => {
    link('resetPassword'); mocks.confirmReset.mockRejectedValue({ code: 'auth/password-does-not-meet-requirements', message: 'private-policy-payload' }); render(<EmailActionPage />);
    for (const label of ['Nueva contraseña', 'Repetí la contraseña']) fireEvent.change(await screen.findByLabelText(label), { target: { value: 'Only-Unit-Fixture-123!' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar nueva contraseña' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no cumple los requisitos'); expect(document.body.textContent).not.toContain('private-policy-payload');
    expect(screen.getByLabelText('Nueva contraseña')).toBeEnabled();
  });
  it.each([['recoverEmail', 'RECOVER_EMAIL', 'Restaurar mi correo'], ['verifyAndChangeEmail', 'VERIFY_AND_CHANGE_EMAIL', 'Confirmar verificación']])('checks the exact operation for %s', async (mode, operation, label) => {
    link(mode); mocks.check.mockResolvedValue({ operation }); render(<EmailActionPage />);
    fireEvent.click(await screen.findByRole('button', { name: label })); await screen.findByText('Listo, tu cuenta está actualizada'); expect(mocks.apply).toHaveBeenCalledTimes(1);
  });
  it.each(['auth/expired-action-code', 'auth/invalid-action-code'])('stops recovery after the provider rejects confirmation with %s', async code => {
    link('recoverEmail'); mocks.check.mockResolvedValue({ operation: 'RECOVER_EMAIL' });
    mocks.apply.mockRejectedValue({ code, message: 'private-recovery-code' }); render(<EmailActionPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Restaurar mi correo' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('venció o ya fue usado');
    expect(screen.queryByRole('button', { name: 'Restaurar mi correo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Volver a intentar' })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('private-recovery-code'); expect(window.location.search).toBe('');
  });
  it('never offers confirmation for an already invalid recovery code', async () => {
    link('recoverEmail'); mocks.check.mockRejectedValue({ code: 'auth/invalid-action-code' }); render(<EmailActionPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('solicitá uno nuevo');
    expect(mocks.apply).not.toHaveBeenCalled(); expect(screen.queryByRole('button', { name: 'Restaurar mi correo' })).not.toBeInTheDocument();
  });
});
