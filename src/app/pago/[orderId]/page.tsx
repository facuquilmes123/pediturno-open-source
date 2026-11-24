import type { Metadata } from 'next';
import PaymentStatus from './PaymentStatus';

export const metadata: Metadata = { title: 'Estado de tu seña', robots: { index: false, follow: false }, referrer: 'no-referrer' };
export default async function DepositPaymentPage({ params }: { params: Promise<{ orderId: string }> }) {
  return <PaymentStatus orderId={(await params).orderId} />;
}
