import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import UnsavedChangesProvider, { useUnsavedChanges } from '@/components/UnsavedChangesProvider';

function Fixture() {
  const { setHasUnsavedChanges } = useUnsavedChanges();
  return <>
    <button onClick={() => setHasUnsavedChanges(true)}>Editar</button>
    <a href="#ajustes" onClick={(event) => event.preventDefault()}>Ir a ajustes</a>
  </>;
}

describe('UnsavedChangesProvider', () => {
  beforeEach(() => {
    window.history.replaceState({ __NA: true, tree: 'current' }, '', '/dashboard/ajustes');
  });

  afterEach(() => {
    vi.restoreAllMocks();
    window.history.replaceState(null, '', '/');
  });

  it('does not ask when there are no changes', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<UnsavedChangesProvider><Fixture /></UnsavedChangesProvider>);

    fireEvent.click(screen.getByRole('link', { name: 'Ir a ajustes' }));

    expect(confirm).not.toHaveBeenCalled();
  });

  it('blocks an internal link when the user keeps unsaved changes', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<UnsavedChangesProvider><Fixture /></UnsavedChangesProvider>);
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Editar' })));

    const allowed = fireEvent.click(screen.getByRole('link', { name: 'Ir a ajustes' }));

    expect(allowed).toBe(false);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('restores the current Next state when Back or Forward is cancelled', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const nextListener = vi.fn();
    render(<UnsavedChangesProvider><Fixture /></UnsavedChangesProvider>);
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Editar' })));
    window.addEventListener('popstate', nextListener);

    const destinationState = { __NA: true, tree: 'destination' };
    act(() => {
      window.history.pushState(destinationState, '', '/dashboard');
      window.dispatchEvent(new PopStateEvent('popstate', { state: destinationState }));
    });

    window.removeEventListener('popstate', nextListener);
    expect(confirm).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe('/dashboard/ajustes');
    expect(window.history.state).toEqual({ __NA: true, tree: 'current' });
    expect(nextListener).not.toHaveBeenCalled();
  });

  it('runs its capture guard before a Next bubble listener registered earlier', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const existingNextListener = vi.fn();
    window.addEventListener('popstate', existingNextListener);
    render(<UnsavedChangesProvider><Fixture /></UnsavedChangesProvider>);
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Editar' })));

    const destinationState = { __NA: true, tree: 'destination' };
    act(() => {
      window.history.pushState(destinationState, '', '/dashboard');
      window.dispatchEvent(new PopStateEvent('popstate', { state: destinationState }));
    });

    window.removeEventListener('popstate', existingNextListener);
    expect(confirm).toHaveBeenCalledOnce();
    expect(existingNextListener).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/dashboard/ajustes');
    expect(window.history.state).toEqual({ __NA: true, tree: 'current' });
  });

  it('lets history navigation and its Next state continue when confirmed', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const nextListener = vi.fn();
    render(<UnsavedChangesProvider><Fixture /></UnsavedChangesProvider>);
    act(() => fireEvent.click(screen.getByRole('button', { name: 'Editar' })));
    window.addEventListener('popstate', nextListener);

    const destinationState = { __NA: true, tree: 'destination' };
    act(() => {
      window.history.pushState(destinationState, '', '/dashboard');
      window.dispatchEvent(new PopStateEvent('popstate', { state: destinationState }));
    });

    window.removeEventListener('popstate', nextListener);
    expect(confirm).toHaveBeenCalledOnce();
    expect(window.location.pathname).toBe('/dashboard');
    expect(window.history.state).toEqual(destinationState);
    expect(nextListener).toHaveBeenCalledOnce();
  });
});
