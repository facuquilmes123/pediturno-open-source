import { describe, expect, it, vi } from 'vitest';
import {
  MONTHLY_FREE_QUOTA,
  AppointmentQuotaExceededError,
  getMonthKey,
  isBusinessPro,
  checkAndConsumeAppointmentQuota,
  releaseAppointmentQuota,
  adjustAppointmentQuotaForReschedule,
} from '@/lib/appointment-quota';
import { getBusinessPlan } from '@/lib/membership-entitlement';
import { isBusinessOperational, hasActiveBusinessMembership } from '@/lib/server-membership';

describe('appointment quota & cross-platform entitlement', () => {
  const now = Date.UTC(2026, 9, 27, 12, 0, 0); // 2026-10-27

  describe('getMonthKey', () => {
    it('extracts YYYY-MM from date string', () => {
      expect(getMonthKey('2026-10-27')).toBe('2026-10');
      expect(getMonthKey('2026-11-05')).toBe('2026-11');
      expect(getMonthKey('2027-01-01')).toBe('2027-01');
    });

    it('extracts YYYY-MM from Date object in business timezone', () => {
      const date = new Date('2026-10-31T23:30:00Z');
      expect(getMonthKey(date, 'America/Argentina/Buenos_Aires')).toBe('2026-10');
    });
  });

  describe('getBusinessPlan & isBusinessPro', () => {
    const playMembership = {
      type: 'pro',
      source: 'GOOGLE_PLAY',
      productId: 'pediturno_servicios_pro_monthly',
      purchaseHash: 'b'.repeat(64),
      status: 'active',
      expiresAt: new Date(now + 86400000),
      autoRenewEnabled: true,
    };

    it('identifies Pro from Google Play purchase', () => {
      const business = { status: 'active', businessType: 'services', googlePlayMembership: playMembership };
      expect(isBusinessPro(business, now)).toBe(true);
      const plan = getBusinessPlan(business, now);
      expect(plan.plan).toBe('pro');
      expect(plan.isPro).toBe(true);
      expect(plan.monthlyQuota).toBeNull();
      expect(plan.source).toBe('GOOGLE_PLAY');
      expect(plan.autoRenew).toBe(true);
    });

    it('identifies Pro from legacy / Mercado Pago web purchase', () => {
      const business = {
        status: 'active',
        businessType: 'services',
        membership: { type: 'pro', source: 'MERCADO_PAGO', expiresAt: new Date(now + 86400000) },
      };
      expect(isBusinessPro(business, now)).toBe(true);
      const plan = getBusinessPlan(business, now);
      expect(plan.plan).toBe('pro');
      expect(plan.isPro).toBe(true);
      expect(plan.monthlyQuota).toBeNull();
      expect(plan.source).toBe('MERCADO_PAGO');
    });

    it('identifies Pro for lifetime accounts', () => {
      const business = { status: 'active', businessType: 'services', membership: { type: 'lifetime' } };
      expect(isBusinessPro(business, now)).toBe(true);
      const plan = getBusinessPlan(business, now);
      expect(plan.plan).toBe('pro');
      expect(plan.isPro).toBe(true);
      expect(plan.status).toBe('lifetime');
    });

    it('identifies Gratis for services accounts without active Pro', () => {
      const business = { status: 'active', businessType: 'services' };
      expect(isBusinessPro(business, now)).toBe(false);
      const plan = getBusinessPlan(business, now);
      expect(plan.plan).toBe('free');
      expect(plan.isPro).toBe(false);
      expect(plan.monthlyQuota).toBe(40);
      expect(plan.source).toBe('FREE');
      expect(plan.status).toBe('free');
      expect(plan.expiresAt).toBeNull();
    });

    it('services in Gratis is always operational', () => {
      const business = { status: 'active', businessType: 'services' };
      expect(isBusinessOperational(business, now)).toBe(true);
      // But hasActiveBusinessMembership (which checks paid/pro) returns false
      expect(hasActiveBusinessMembership(business, now)).toBe(false);
    });
  });

  describe('ledger authority and transaction ordering', () => {
    function fixture(counts: Record<string, number>, stale = 0) {
      let wrote = false;
      const writes: any[] = [];
      const bounds: any[] = [];
      const db = { collection: (name: string) => {
        const q: any = { name, where: (_field: string, op: string, value: any) => {
          if (_field === 'date') { bounds.push([op, value.toDate().toISOString()]); if (op === '>=') q.month = value.toDate().toISOString().slice(0, 7); }
          return q;
        }, doc: (id: string) => ({ id, collection: () => ({ doc: (month: string) => ({ month }) }) }) };
        return q;
      }} as any;
      const tx = { get: async (ref: any) => {
        if (wrote) throw new Error('READ_AFTER_WRITE');
        if (ref.name === 'appointments') return { docs: Array.from({ length: counts[ref.month] ?? 0 }, () => ({ data: () => ({ status: 'Confirmado' }) })) };
        return { exists: true, get: () => stale };
      }, set: (ref: any, data: any) => { wrote = true; writes.push({ month: ref.month, count: data.count }); } } as any;
      return { db, tx, writes, bounds };
    }
    it('uses the ledger instead of a stale counter after Pro expires', async () => {
      const f = fixture({ '2026-10': 40 }, 1);
      await expect(checkAndConsumeAppointmentQuota(f.tx, f.db, 'b', { businessType: 'services' }, '2026-10-28')).rejects.toThrow(AppointmentQuotaExceededError);
      expect(f.writes).toEqual([]);
    });
    it('admits the 40th appointment and repairs the advisory counter', async () => {
      const f = fixture({ '2026-10': 39 }, 100);
      expect((await checkAndConsumeAppointmentQuota(f.tx, f.db, 'b', {}, '2026-10-28')).usage).toBe(40);
      expect(f.writes[0].count).toBe(40);
    });
    it('reads both months before any rescheduling write', async () => {
      const f = fixture({ '2026-11': 10 }, 35);
      await adjustAppointmentQuotaForReschedule(f.tx, f.db, 'b', {}, '2026-10-10', '2026-11-05');
      expect(f.writes).toContainEqual({ month: '2026-11', count: 11 });
    });
    it('uses business-local boundaries, including a positive UTC offset', async () => {
      const f = fixture({});
      await checkAndConsumeAppointmentQuota(f.tx, f.db, 'b', {}, '2026-10-15', 'Asia/Tokyo');
      expect(f.bounds).toEqual([['>=', '2026-09-30T15:00:00.000Z'], ['<', '2026-10-31T15:00:00.000Z']]);
    });
    it('does not cap Pro or touch a Free counter', async () => {
      const f = fixture({ '2026-10': 80 });
      expect((await checkAndConsumeAppointmentQuota(f.tx, f.db, 'b', { membership: { type: 'lifetime' } }, '2026-10-28')).quota).toBeNull();
      expect(f.writes).toEqual([]);
    });
  });
});
