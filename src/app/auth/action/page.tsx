import type { Metadata } from 'next';
import EmailActionPage from '@/components/EmailActionPage';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Acceso seguro',
  description: 'Verificá tu correo o recuperá el acceso a tu cuenta de Pediturno.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default function AuthActionPage() { return <EmailActionPage />; }
