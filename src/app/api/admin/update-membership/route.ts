import { NextResponse, type NextRequest } from 'next/server';
import { Timestamp } from 'firebase-admin/firestore';
import { getAdminFirestore } from '@/lib/firebase-admin';
import { verifyAdminRequest } from '@/lib/admin-auth';
import { readLimitedJson, RequestBodyTooLarge } from '@/lib/request-body';
import { z } from 'zod';

const schema = z.object({
  businessId: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  membership: z.object({
    type: z.enum(['trial', 'pro', 'lifetime']),
    startsAt: z.string().datetime({ offset: true }).nullable().optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
  }).strict(),
}).strict();

export async function POST(request: NextRequest) {
  const auth = await verifyAdminRequest(request);
  if (!auth.authorized) return NextResponse.json({ success: false, message: 'No autorizado.' }, { status: 403 });
  let parsed: z.infer<typeof schema>;
  try {
    parsed = schema.parse(await readLimitedJson(request, 4096));
    const { membership: m } = parsed;
    if ((m.type === 'lifetime' && m.expiresAt !== null) || (m.type !== 'lifetime' && !m.expiresAt) ||
        (m.startsAt && m.expiresAt && Date.parse(m.expiresAt) <= Date.parse(m.startsAt))) throw new Error('Invalid interval');
  } catch (error) {
    return NextResponse.json({ success: false, message: 'Membresía o fechas inválidas.' }, { status: error instanceof RequestBodyTooLarge ? 413 : 400 });
  }
  try {
    const db = getAdminFirestore();
    const ref = db.collection('businesses').doc(parsed.businessId);
    const audit = db.collection('membershipAdminChanges').doc();
    const membership = {
      type: parsed.membership.type,
      startsAt: parsed.membership.startsAt ? Timestamp.fromDate(new Date(parsed.membership.startsAt)) : Timestamp.now(),
      expiresAt: parsed.membership.expiresAt ? Timestamp.fromDate(new Date(parsed.membership.expiresAt)) : null,
    };
    const changed = await db.runTransaction(async tx => {
      const current = await tx.get(ref);
      if (!current.exists || current.get('status') !== 'active') return false;
      // Manual overrides are recorded separately from provider payment ledgers.
      tx.create(audit, { businessId: parsed.businessId, actor: auth.email || '',
        before: current.get('membership') || null, after: membership, createdAt: Timestamp.now() });
      tx.update(ref, { membership });
      return true;
    });
    return NextResponse.json({ success: changed, message: changed ? 'Membresía actualizada exitosamente.' : 'Negocio no encontrado.' }, { status: changed ? 200 : 404, headers: { 'Cache-Control': 'no-store' } });
  } catch {
    return NextResponse.json({ success: false, message: 'No se pudo actualizar la membresía.' }, { status: 503 });
  }
}
