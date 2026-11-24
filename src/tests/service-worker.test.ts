import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

type Listener = (event: any) => void;

function loadWorker() {
  const listeners = new Map<string, Listener>();
  const registration = { showNotification: vi.fn(() => Promise.resolve()) };
  const clients = {
    matchAll: vi.fn(() => Promise.resolve([])),
    openWindow: vi.fn(() => Promise.resolve()),
  };
  const self = {
    addEventListener: (type: string, handler: Listener) => listeners.set(type, handler),
    registration,
    location: { origin: 'https://pediturno.test' },
  };
  const source = readFileSync(resolve(process.cwd(), 'public/service-worker.js'), 'utf8');
  vm.runInNewContext(source, { self, clients, URL, console });

  return { listeners, registration, clients };
}

describe('service worker notifications', () => {
  it('shows a fallback notification when a push has no payload', async () => {
    const { listeners, registration } = loadWorker();
    let task: Promise<unknown> | undefined;

    listeners.get('push')!({ data: null, waitUntil: (promise: Promise<unknown>) => { task = promise; } });
    await task;

    expect(registration.showNotification).toHaveBeenCalledWith('Pediturno Online', expect.objectContaining({
      body: 'Tienes una nueva notificación.',
      data: { url: 'https://pediturno.test/' },
    }));
  });

  it('focuses an existing window when the notification uses a relative URL', async () => {
    const { listeners, clients } = loadWorker();
    const focus = vi.fn(() => Promise.resolve());
    clients.matchAll.mockResolvedValue([{ url: 'https://pediturno.test/dashboard', focus }]);
    let task: Promise<unknown> | undefined;

    listeners.get('notificationclick')!({
      notification: { close: vi.fn(), data: { url: '/dashboard' } },
      waitUntil: (promise: Promise<unknown>) => { task = promise; },
    });
    await task;

    expect(focus).toHaveBeenCalledOnce();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });
});
