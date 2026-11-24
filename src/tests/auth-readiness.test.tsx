import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth, useAuthRedirect } from '@/hooks/useAuthRedirect';
const mocks = vi.hoisted(() => ({ ensure: vi.fn(), subscribe: vi.fn(), push: vi.fn(), unsubscribe: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ auth: {}, ensureFirebaseReady: mocks.ensure }));
vi.mock('firebase/auth', () => ({ onAuthStateChanged: mocks.subscribe }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push }), usePathname: () => '/dashboard' }));

function Consumer() {
  const { user, loading, error, retry } = useAuth(); useAuthRedirect();
  return <><p data-testid="state">{error || (loading ? 'loading' : user?.uid || 'signed out')}</p><button onClick={retry}>retry</button></>;
}
beforeEach(() => { vi.clearAllMocks(); mocks.ensure.mockResolvedValue(undefined); mocks.subscribe.mockReturnValue(mocks.unsubscribe); });

describe('Auth readiness and restoration', () => {
  it('does not redirect or subscribe when secure initialization fails, then restores on retry', async () => {
    mocks.ensure.mockRejectedValueOnce(new Error('network'));
    let callback: ((user: { uid: string } | null) => void) | undefined;
    mocks.subscribe.mockImplementation((_: unknown, onUser: typeof callback) => { callback = onUser; return mocks.unsubscribe; });
    render(<AuthProvider><Consumer /></AuthProvider>);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveTextContent('No pudimos verificar'));
    expect(mocks.subscribe).not.toHaveBeenCalled(); expect(mocks.push).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('retry'));
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce());
    act(() => callback?.({ uid: 'restored-owner' }));
    expect(screen.getByTestId('state')).toHaveTextContent('restored-owner'); expect(mocks.push).not.toHaveBeenCalled();
  });

  it('redirects a confirmed signed-out user only after initialization and the Auth callback', async () => {
    let callback: ((user: null) => void) | undefined;
    mocks.subscribe.mockImplementation((_: unknown, onUser: typeof callback) => { callback = onUser; return mocks.unsubscribe; });
    render(<AuthProvider><Consumer /></AuthProvider>);
    await waitFor(() => expect(mocks.subscribe).toHaveBeenCalledOnce());
    expect(mocks.push).not.toHaveBeenCalled();
    act(() => callback?.(null)); expect(mocks.push).toHaveBeenCalledWith('/');
  });

  it('does not subscribe when unmounted while initialization is pending', async () => {
    let resolve!: () => void; mocks.ensure.mockReturnValue(new Promise<void>((done) => { resolve = done; }));
    const view = render(<AuthProvider><Consumer /></AuthProvider>); view.unmount();
    await act(async () => resolve()); expect(mocks.subscribe).not.toHaveBeenCalled();
  });
});
