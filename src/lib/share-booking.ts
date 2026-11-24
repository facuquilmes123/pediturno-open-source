'use client';

export async function shareBookingLink(url: string, name?: string): Promise<'shared' | 'copied' | 'cancelled'> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: name || 'Reservá en Pediturno', text: 'Elegí tu horario y reservá online.', url });
      return 'shared';
    } catch (error) {
      if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') return 'cancelled';
      // Unsupported sharing contexts still let the user copy the link.
    }
  }
  await navigator.clipboard.writeText(url);
  return 'copied';
}
