import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  return { promise: new Promise<T>(done => { resolve = done; }), resolve };
}

const mocks = vi.hoisted(() => ({
  authState: { user: null as null | { uid: string }, loading: false },
  getBusinessProfile: vi.fn(),
  getServices: vi.fn(),
  getCanchas: vi.fn(),
  getSpaces: vi.fn(),
  onSnapshot: vi.fn(),
  doc: vi.fn((_db: unknown, _collection: string, uid: string) => ({ uid })),
  snapshotCallbacks: new Map<string, (snapshot: any) => void>(),
}));

vi.mock('@/hooks/useAuthRedirect', () => ({ useAuth: () => mocks.authState }));
vi.mock('@/services/data', () => ({
  getBusinessProfile: mocks.getBusinessProfile,
  getServices: mocks.getServices,
  getCanchas: mocks.getCanchas,
  getSpaces: mocks.getSpaces,
}));
vi.mock('@/lib/firebase', () => ({ db: {} }));
vi.mock('@/lib/owner-workspace-client', () => ({
  subscribeOwnerProfile: (uid: string, next: (value: any) => void) => mocks.onSnapshot({ uid }, (snapshot: any) => next(snapshot.exists() ? { id: snapshot.id, ...snapshot.data() } : null)),
}));

import { DashboardProvider, useDashboard } from '@/context/DashboardContext';

function Probe() {
  const state = useDashboard();
  return <div
    data-testid="state"
    data-profile={state.businessProfile?.id || ''}
    data-services={state.services.map(service => service.id).join(',')}
    data-profile-loading={String(state.isProfileLoading)}
    data-services-loading={String(state.isServicesLoading)}
  ><button onClick={() => void state.refetchProfileAndServices()}>Refresh</button></div>;
}

function snapshot(id: string, data: Record<string, unknown>) {
  return { id, exists: () => true, data: () => data };
}

describe('DashboardProvider account isolation', () => {
  beforeEach(() => {
    mocks.getCanchas.mockResolvedValue([]);
    mocks.getSpaces.mockResolvedValue([]);
    mocks.authState.user = null;
    mocks.authState.loading = false;
    mocks.snapshotCallbacks.clear();
    mocks.doc.mockImplementation((_db: unknown, _collection: string, uid: string) => ({ uid }));
    mocks.onSnapshot.mockImplementation((reference: { uid: string }, next: (value: any) => void) => {
      mocks.snapshotCallbacks.set(reference.uid, next);
      return vi.fn();
    });
  });

  it('keeps the dashboard mounted during a same-account refresh', async () => {
    mocks.authState.user = { uid: 'owner-a' };
    mocks.getBusinessProfile.mockResolvedValue({ id: 'owner-a' });
    mocks.getServices.mockResolvedValue([]);
    render(<DashboardProvider><Probe /></DashboardProvider>);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveAttribute('data-profile-loading', 'false'));
    const refreshed = deferred<any[]>();
    mocks.getServices.mockReturnValue(refreshed.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(screen.getByTestId('state')).toHaveAttribute('data-profile-loading', 'false');
    expect(screen.getByTestId('state')).toHaveAttribute('data-profile', 'owner-a');
    await act(async () => { refreshed.resolve([{ id: 'new-service' }]); });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveAttribute('data-services', 'new-service'));
  });

  it('ignores an old async result after switching accounts and clears everything on logout', async () => {
    const profileA = deferred<any>();
    const servicesA = deferred<any[]>();
    const profileB = deferred<any>();
    const servicesB = deferred<any[]>();
    mocks.getBusinessProfile.mockImplementation((uid: string) => uid === 'owner-a' ? profileA.promise : profileB.promise);
    mocks.getServices.mockImplementation((uid: string) => uid === 'owner-a' ? servicesA.promise : servicesB.promise);

    mocks.authState.user = { uid: 'owner-a' };
    const view = render(<DashboardProvider><Probe /></DashboardProvider>);
    await waitFor(() => expect(mocks.getBusinessProfile).toHaveBeenCalledWith('owner-a'));

    mocks.authState.user = { uid: 'owner-b' };
    view.rerender(<DashboardProvider><Probe /></DashboardProvider>);
    await waitFor(() => expect(mocks.getBusinessProfile).toHaveBeenCalledWith('owner-b'));

    await act(async () => {
      profileB.resolve({ id: 'owner-b', name: 'B' });
      servicesB.resolve([{ id: 'service-b' }]);
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByTestId('state')).toHaveAttribute('data-profile', 'owner-b'));

    await act(async () => {
      profileA.resolve({ id: 'owner-a', name: 'A' });
      servicesA.resolve([{ id: 'service-a' }]);
      await Promise.resolve();
    });
    expect(screen.getByTestId('state')).toHaveAttribute('data-profile', 'owner-b');
    expect(screen.getByTestId('state')).toHaveAttribute('data-services', 'service-b');

    mocks.getCanchas.mockResolvedValue([]);
    mocks.authState.user = null;
    view.rerender(<DashboardProvider><Probe /></DashboardProvider>);
    await waitFor(() => expect(screen.getByTestId('state')).toHaveAttribute('data-profile', ''));
    expect(screen.getByTestId('state')).toHaveAttribute('data-services', '');
    expect(screen.getByTestId('state')).toHaveAttribute('data-profile-loading', 'false');
    expect(screen.getByTestId('state')).toHaveAttribute('data-services-loading', 'false');
  });

  it('clears the profile when the live business document no longer exists', async () => {
    mocks.getBusinessProfile.mockResolvedValue({ id: 'owner-a', name: 'A' });
    mocks.getServices.mockResolvedValue([]);
    mocks.authState.user = { uid: 'owner-a' };
    render(<DashboardProvider><Probe /></DashboardProvider>);
    await waitFor(() => expect(mocks.snapshotCallbacks.has('owner-a')).toBe(true));

    act(() => mocks.snapshotCallbacks.get('owner-a')!(snapshot('owner-a', { name: 'A live' })));
    expect(screen.getByTestId('state')).toHaveAttribute('data-profile', 'owner-a');

    act(() => mocks.snapshotCallbacks.get('owner-a')!({ exists: () => false }));
    expect(screen.getByTestId('state')).toHaveAttribute('data-profile', '');
  });
});
