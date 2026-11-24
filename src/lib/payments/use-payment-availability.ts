'use client';

import { useEffect, useState } from 'react';

/** The public button follows the current server setting, never a baked build flag. */
export function usePaymentAvailability(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/public/payment-availability', { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Payment availability unavailable');
        const data = await response.json() as { enabled?: unknown };
        return data.enabled === true;
      })
      .then(setAvailable)
      .catch(() => {
        if (!controller.signal.aborted) setAvailable(false);
      });
    return () => controller.abort();
  }, []);

  return available;
}
