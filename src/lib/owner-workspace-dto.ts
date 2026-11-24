import 'server-only';
const address = { street: '', number: '', city: '', province: '', postalCode: '', country: 'Argentina' };
import { canUseOnlineDeposits } from '@/lib/release-features';

function pick(data: Record<string, unknown>, fields: string[]) {
  return Object.fromEntries(fields.filter(field => data[field] !== undefined).map(field => [field, data[field]]));
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function ownerDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const v = value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function' ? value.toDate() : value;
  const date = v instanceof Date ? v : new Date(v as string);
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid stored date');
  return date.toISOString();
}
export function ownerProfileDto(id: string, data: Record<string, unknown>) {
  const profile: Record<string, unknown> = { id, email: '', name: '', address, ...pick(data, [
    'email','name','slug','businessType','timeZone','description','logo','address','status','location','whatsappButtonEnabled',
    'whatsappNumber','socialLinks','theme','customTheme','bookingSettings',
  ]) };
  for (const [field, fields] of Object.entries({
    address: ['street','number','city','province','postalCode','country'], location: ['lat','lng'],
    customTheme: ['primary','background','accent'], bookingSettings: ['bookingLeadTimeHours','bookingHorizonDays','autoConfirm','appointmentBufferMinutes','remindersEnabled','newAppointmentNotificationsEnabled','notificationEmail'],
  })) if (data[field] !== undefined) profile[field] = pick(record(data[field]), fields);
  if (Array.isArray(data.socialLinks)) profile.socialLinks = data.socialLinks.map(link => pick(record(link), ['id','type','url','title']));
  for (const field of ['createdAt','lastModified']) if (data[field] !== undefined) profile[field] = ownerDate(data[field]);
  for (const field of ['membership','googlePlayMembership']) if (data[field]) {
    const membership = record(data[field]);
    const safe: Record<string, unknown> = pick(membership, ['type','source','productId','purchaseHash','status','autoRenewEnabled']);
    for (const date of ['startsAt','expiresAt']) if (membership[date] !== undefined) safe[date] = ownerDate(membership[date]);
    profile[field] = safe;
  }
  if (data.mercadopago) {
    const mp = record(data.mercadopago);
    profile.mercadopago = { ...pick(mp, ['isConnected','userId','publicKey','requireDeposit','depositType','depositValue']),
      ...(mp.requireDeposit === undefined ? {} : { requireDeposit: canUseOnlineDeposits(data.businessType) && mp.requireDeposit === true }),
      ...(mp.connectedAt === undefined ? {} : { connectedAt: ownerDate(mp.connectedAt) }) };
  }
  return profile;
}
export function ownerAppointmentDto(id: string, uid: string, data: Record<string, unknown>) {
  const row: Record<string, unknown> = { ...pick(data, [
    'client','clientId','service','serviceId','canchaId','spaceId','durationMinutes','priceAtBooking','paymentStatus','depositAmount',
    'depositPaid','paymentReviewRequired','cancha','space','preparationMinutes','cleanupMinutes','bookingBufferMinutes',
    'preparationMinutesAtBooking','cleanupMinutesAtBooking','bookingBufferMinutesAtBooking','time','avatar','status','clientEmail','clientPhone',
  ]), id, businessId: uid, date: ownerDate(data.date) };
  for (const field of ['occupiedStartAt','occupiedEndAt']) if (data[field] !== undefined) row[field] = ownerDate(data[field]);
  return row;
}
