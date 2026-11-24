import BookingDemo from '@/components/BookingDemo';
export const metadata = { title: 'Demo de reservas de canchas', robots: { index: false, follow: false } };
export default function Demo() { return <BookingDemo vertical="sports_facility" />; }
