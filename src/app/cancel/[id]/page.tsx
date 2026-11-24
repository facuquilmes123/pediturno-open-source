
import CancelClientPage from './CancelClientPage';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Cancelar Turno',
  description: 'Cancela tu turno de forma rápida y sencilla.',
};

export default function CancelPage() {
    return <CancelClientPage />;
}
