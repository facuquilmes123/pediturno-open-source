import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { dateKeyInZone, BUSINESS_TIME_ZONE } from '@/lib/booking-constraints';

const { getAdminFirestore, verifyPublicAppCheck } = vi.hoisted(() => ({
  getAdminFirestore: vi.fn(),
  verifyPublicAppCheck: vi.fn().mockResolvedValue(true),
}));

vi.mock('@/lib/firebase-admin', () => ({ getAdminFirestore }));
vi.mock('@/lib/app-check-server', () => ({ verifyPublicAppCheck }));

import { GET } from '@/app/api/public/availability/route';

describe('public availability cost guard', () => {
  it('stops uncached scans when the distributed business allowance is exhausted', async () => {
    verifyPublicAppCheck.mockResolvedValue(true);
    const appointmentsGet = vi.fn();
    getAdminFirestore.mockReturnValue({
      collection: vi.fn((name: string) => name === 'businesses'
        ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ status: 'active', membership: { type: 'lifetime' }, timeZone: BUSINESS_TIME_ZONE }), get: (key: string) => key === 'membership' ? { type: 'lifetime' } : key === 'status' ? 'active' : BUSINESS_TIME_ZONE }) }) }
        : name === 'availabilityRateLimits' ? { doc: () => ({}) } : { get: appointmentsGet }),
      runTransaction: vi.fn().mockResolvedValue(false),
    });
    const date = dateKeyInZone(new Date(Date.now() + 86400000), BUSINESS_TIME_ZONE);
    const response = await GET(new NextRequest(`https://pediturno.test/api/public/availability?businessId=limited-business&date=${date}`));
    expect(response.status).toBe(429);
    expect(response.headers.get('retry-after')).toBe('60');
    expect(appointmentsGet).not.toHaveBeenCalled();
  });
  it('coalesces concurrent requests for the same business and date into one Firestore read', async () => {
    verifyPublicAppCheck.mockResolvedValue(true);
    const businessGet = vi.fn().mockResolvedValue({
      exists: true,
      data: () => ({ status: 'active', membership: { type: 'pro', expiresAt: Timestamp.fromMillis(Date.now() + 86400000) }, timeZone: BUSINESS_TIME_ZONE }),
      get: (field: string) => ({
        membership: { type: 'pro', expiresAt: Timestamp.fromMillis(Date.now() + 86400000) },
        status: 'active',
        timeZone: BUSINESS_TIME_ZONE,
      })[field],
    });
    const appointmentsGet = vi.fn().mockResolvedValue({ size: 0, docs: [] });
    const query = { where: vi.fn(), limit: vi.fn(), get: appointmentsGet };
    query.where.mockReturnValue(query);
    query.limit.mockReturnValue(query);
    const db = {
      collection: vi.fn((name: string) => name === 'businesses'
        ? { doc: vi.fn(() => ({ get: businessGet })) }
        : name === 'availabilityRateLimits' ? { doc: vi.fn(() => ({})) }
        : query),
      runTransaction: vi.fn(fn => fn({ get: vi.fn().mockResolvedValue({ data: () => undefined }), set: vi.fn() })),
    };
    getAdminFirestore.mockReturnValue(db);
    const date = dateKeyInZone(new Date(Date.now() + 3 * 86400000), BUSINESS_TIME_ZONE);
    const url = `https://pediturno.test/api/public/availability?businessId=cache-business-${Date.now()}&date=${date}`;
    const responses = await Promise.all(Array.from({ length: 100 }, () => GET(new NextRequest(url))));
    expect([...new Set(responses.map(response => response.status))]).toEqual([200]);
    expect(businessGet).toHaveBeenCalledTimes(1);
    expect(appointmentsGet).toHaveBeenCalledTimes(1);
    expect(db.runTransaction).toHaveBeenCalledTimes(1);
    expect(verifyPublicAppCheck).toHaveBeenCalledTimes(100);
  });
});
