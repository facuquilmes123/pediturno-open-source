import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore: vi.fn(), initializeAdminApp: vi.fn() }));
vi.mock('@/lib/app-check-server', () => ({ verifyPublicAppCheck: vi.fn() }));
import { POST } from '@/app/api/public/bookings/route';
import { verifyPublicAppCheck } from '@/lib/app-check-server';

describe('public booking request boundary', () => {
  it.each(['null', '[]', '"text"', '42', 'true', '{'])('rejects malformed body %s before app verification', async body => {
    const result = await POST(new Request('https://pediturno.test/api/public/bookings', { method: 'POST', body }) as never);
    expect(result.status).toBe(400);
    expect(verifyPublicAppCheck).not.toHaveBeenCalled();
  });

  it('cancels an oversized stream without trusting Content-Length', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(4097)); }, cancel });
    const request = new Request('https://pediturno.test/api/public/bookings', { method: 'POST', body, duplex: 'half' } as RequestInit);
    const result = await POST(request as never);
    expect(result.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(verifyPublicAppCheck).not.toHaveBeenCalled();
  });
});
