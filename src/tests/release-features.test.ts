import { describe, expect, it } from 'vitest';
import { canUseOnlineDeposits } from '@/lib/release-features';
import { androidBusinessDto } from '@/lib/android-owner-api';
import { ownerProfileDto } from '@/lib/owner-workspace-dto';

describe('Servicios first release', () => {
  it.each(['services', undefined, null, 'unknown'])('does not offer new online deposits for %s', businessType => {
    expect(canUseOnlineDeposits(businessType)).toBe(false);
  });
  it.each(['sports_facility', 'spaces', 'hybrid'])('preserves the existing %s payment scope', businessType => {
    expect(canUseOnlineDeposits(businessType)).toBe(true);
  });
  it('projects old deposit settings as unavailable without changing stored history or membership', () => {
    const source = { businessType: 'services', status: 'active', membership: { type: 'lifetime' }, mercadopago: { isConnected: true, requireDeposit: true, depositType: 'fixed', depositValue: 900 }, name: 'Fixture' };
    const before = JSON.stringify(source);
    const owner = ownerProfileDto('fixture', source);
    expect(owner.mercadopago).toMatchObject({ isConnected: true, requireDeposit: false, depositValue: 900 });
    expect(androidBusinessDto('fixture', source).mercadopago).toMatchObject({ connected: true, requireDeposit: false });
    expect(JSON.stringify(source)).toBe(before);
  });
});
