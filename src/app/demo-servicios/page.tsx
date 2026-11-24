import BookingDemo from '@/components/BookingDemo';
export const metadata = { title: 'Demo de reservas para servicios', robots: { index: false, follow: false } };
export default function Demo() { return <BookingDemo vertical="services" />; }
