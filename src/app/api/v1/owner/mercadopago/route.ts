import { NextRequest, NextResponse } from 'next/server';
import { disconnectMercadoPagoAccount, updateMercadoPagoSettings } from '@/services/mercadopago';
import { depositsAvailable } from '@/lib/payments/deposits';
import { marketplaceConfiguration } from '@/lib/payments/marketplace';
import { AndroidOwnerApiError, androidError, asRecord, readAndroidOwnerJson, requireAndroidOwner } from '@/lib/android-owner-api';
import { isBusinessOperational } from '@/lib/server-membership';
import { canUseOnlineDeposits } from '@/lib/release-features';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type DepositSettings = { requireDeposit: boolean; depositType: 'fixed' | 'percentage'; depositValue: number };

function authorizationToken(request: Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new AndroidOwnerApiError(401, 'AUTH_REQUIRED', 'Authentication required');
  return token;
}

function marketplaceConfigured() {
  try { marketplaceConfiguration(); return true; } catch { return false; }
}

function depositsEnabled(configured: boolean) {
  return configured && depositsAvailable();
}

function savedSettings(business: Record<string, unknown>): DepositSettings {
  const settings = asRecord(business.mercadopago) || {};
  const depositType = settings.depositType === 'percentage' ? 'percentage' : 'fixed';
  const value = typeof settings.depositValue === 'number' && Number.isFinite(settings.depositValue) ? settings.depositValue : 0;
  return { requireDeposit: settings.requireDeposit === true, depositType, depositValue: value };
}

async function status(owner: Awaited<ReturnType<typeof requireAndroidOwner>>) {
  const connection = await owner.db.collection('mercadoPagoConnections').doc(owner.uid).get();
  // A business boolean is only a cache/display field. The private connection
  // record is the source of truth for whether a seller can receive deposits.
  const connected = connection.exists && connection.get('active') !== false && !!connection.get('encryptedAccessToken');
  const configured = canUseOnlineDeposits(owner.business.businessType) && marketplaceConfigured();
  const enabled = depositsEnabled(configured);
  const settings = savedSettings(owner.business);
  return {
    configured,
    connected,
    depositsEnabled: enabled,
    canConfigureDeposits: connected && enabled,
    settings: {
      // Never show an old local flag as enabled when the seller/configuration
      // is absent. Deposit validation is still repeated during PATCH and when
      // a public booking is created.
      requireDeposit: connected && enabled && settings.requireDeposit,
      depositType: settings.depositType,
      depositValue: settings.depositValue,
    },
  };
}

function readDepositSettings(input: Record<string, unknown>): DepositSettings {
  const keys = ['requireDeposit', 'depositType', 'depositValue'];
  if (Object.keys(input).length !== keys.length || Object.keys(input).some(key => !keys.includes(key)) ||
      typeof input.requireDeposit !== 'boolean' || (input.depositType !== 'fixed' && input.depositType !== 'percentage') ||
      typeof input.depositValue !== 'number' || !Number.isFinite(input.depositValue)) {
    throw new AndroidOwnerApiError(400, 'INVALID_DEPOSIT_SETTINGS', 'Invalid deposit settings');
  }
  const maximum = input.depositType === 'percentage' ? 100 : 1_000_000;
  if (input.depositValue < 0 || input.depositValue > maximum || input.requireDeposit && input.depositValue === 0) {
    throw new AndroidOwnerApiError(400, 'INVALID_DEPOSIT_SETTINGS', 'Invalid deposit settings');
  }
  return { requireDeposit: input.requireDeposit, depositType: input.depositType, depositValue: input.depositValue };
}

function failure(cause: unknown) {
  const error = cause as AndroidOwnerApiError;
  if (error?.status && error?.code) return androidError(error.message, error.status, error.code);
  return androidError('Mercado Pago settings unavailable', 503, 'MERCADOPAGO_UNAVAILABLE');
}

export async function GET(request: NextRequest) {
  try {
    const owner = await requireAndroidOwner(request);
    return NextResponse.json(await status(owner), { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return failure(cause);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const settings = readDepositSettings(await readAndroidOwnerJson(request));
    const owner = await requireAndroidOwner(request);
    if (!isBusinessOperational(owner.business)) return androidError('Active membership required', 403, 'MEMBERSHIP_REQUIRED');
    if (settings.requireDeposit && (!canUseOnlineDeposits(owner.business.businessType) || !depositsEnabled(marketplaceConfigured()))) {
      return androidError('Deposits are not enabled for this marketplace configuration', 409, 'DEPOSITS_UNAVAILABLE');
    }
    const result = await updateMercadoPagoSettings(authorizationToken(request), settings);
    if (!result.success) return androidError(result.message, 409, 'DEPOSIT_CONFIGURATION_REJECTED');
    // Re-read the server state; callers never infer success from their local
    // switch value or from a cached `isConnected` property.
    const refreshed = await requireAndroidOwner(request);
    return NextResponse.json(await status(refreshed), { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return failure(cause);
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Disconnect remains available to an authenticated Servicios owner even if
    // its membership expired; it only turns off future seller use.
    await requireAndroidOwner(request);
    const result = await disconnectMercadoPagoAccount(authorizationToken(request));
    if (!result.success) return androidError(result.message, 503, 'MERCADOPAGO_DISCONNECT_UNAVAILABLE');
    const owner = await requireAndroidOwner(request);
    return NextResponse.json(await status(owner), { headers: { 'Cache-Control': 'no-store' } });
  } catch (cause) {
    return failure(cause);
  }
}
