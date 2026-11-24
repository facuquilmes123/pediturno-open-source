import { auth } from '@/lib/firebase';
import type { Client } from '@/services/data';

/** Read the complete owner directory through the server admission gate. */
export async function readOwnerClients(ownerId: string): Promise<Client[]> {
  const owner = auth?.currentUser;
  const verify = () => {
    if (!owner || owner.uid !== ownerId || auth?.currentUser?.uid !== ownerId) {
      throw new Error('Tu sesión cambió. Volvé a cargar el directorio.');
    }
  };
  verify();
  const clients: Client[] = [], ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const url = '/api/v1/owner/clients?limit=100' + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    let retries = 0, waited = 0, response: Response;
    for (;;) {
      verify();
      const token = await owner!.getIdToken();
      verify();
      response = await fetch(url, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      verify();
      if (response.status !== 429) break;
      const retry = response.headers.get('Retry-After');
      await response.body?.cancel();
      if (!retry || !/^\d+$/.test(retry)) throw new Error('Directorio ocupado. Intentá nuevamente en unos momentos.');
      const delay = Math.max(1, Number(retry));
      if (retries >= 2 || waited + delay > 60) throw new Error('Directorio ocupado. Intentá nuevamente en unos momentos.');
      retries++; waited += delay;
      await new Promise(resolve => setTimeout(resolve, delay * 1000));
    }
    if (!response.ok) throw new Error('No se pudo cargar el directorio completo. Volvé a intentar.');
    const page = await response.json();
    verify();
    if (!Array.isArray(page.clients) || page.clients.length > 100 ||
        !(page.nextCursor === null || typeof page.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(page.nextCursor))) {
      throw new Error('Respuesta de directorio inválida.');
    }
    for (const row of page.clients) {
      if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id) || ids.has(row.id) ||
          typeof row.name !== 'string' || typeof row.phone !== 'string') throw new Error('Respuesta de directorio inválida.');
      const lastAppointment = row.lastAppointment === null ? null : new Date(row.lastAppointment);
      if (lastAppointment && !Number.isFinite(lastAppointment.getTime())) throw new Error('Fecha de cliente inválida.');
      ids.add(row.id);
      clients.push({ id: row.id, businessId: ownerId, name: row.name, phone: row.phone,
        email: row.email ?? '', avatar: row.avatar ?? '', lastAppointment });
    }
    cursor = page.nextCursor;
    if (cursor) {
      if (!page.clients.length || cursors.has(cursor)) throw new Error('Paginación de directorio inválida.');
      cursors.add(cursor);
    }
  } while (cursor);
  verify();
  return clients.sort((a, b) => (b.lastAppointment?.getTime() ?? 0) - (a.lastAppointment?.getTime() ?? 0)
    || a.name.localeCompare(b.name, 'es-AR') || a.id.localeCompare(b.id));
}
