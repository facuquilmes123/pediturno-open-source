import { auth } from '@/lib/firebase';
import type { Service, Cancha, Space } from '@/services/data';
type Catalog = { services: Service; canchas: Cancha; spaces: Space };
/** Complete directory; never silently return a partial result or another session's data. */
export async function readOwnerCatalog<K extends keyof Catalog>(ownerId: string, kind: K): Promise<Catalog[K][]> {
  const owner = auth?.currentUser;
  const verify = () => {
    if (!owner || owner.uid !== ownerId || auth?.currentUser !== owner) throw new Error('Tu sesión cambió. Volvé a cargar el catálogo.');
  };
  verify();
  const items: Catalog[K][] = [], ids = new Set<string>(), cursors = new Set<string>();
  let cursor: string | null = null;
  do {
    const url = `/api/owner/catalog?kind=${kind}&limit=100` + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : '');
    let retries = 0, waited = 0, response: Response;
    for (;;) {
      verify(); const token = await owner!.getIdToken(); verify();
      response = await fetch(url, { cache: 'no-store', headers: { Authorization: `Bearer ${token}` } });
      verify();
      if (response.status !== 429) break;
      const retry = response.headers.get('Retry-After'); await response.body?.cancel();
      if (!retry || !/^\d+$/.test(retry)) throw new Error('Catálogo ocupado. Intentá nuevamente en unos momentos.');
      const delay = Math.max(1, Number(retry));
      if (retries >= 2 || waited + delay > 60) throw new Error('Catálogo ocupado. Intentá nuevamente en unos momentos.');
      retries++; waited += delay; await new Promise(resolve => setTimeout(resolve, delay * 1000));
    }
    if (!response.ok) throw new Error('No se pudo cargar el catálogo completo. Volvé a intentar.');
    const page = await response.json(); verify();
    if (!Array.isArray(page.items) || page.items.length > 100 || !(page.nextCursor === null ||
        typeof page.nextCursor === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(page.nextCursor))) throw new Error('Respuesta de catálogo inválida.');
    for (const row of page.items) {
      if (!row || typeof row.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(row.id) || ids.has(row.id) ||
          row.businessId !== ownerId || typeof row.name !== 'string' || !Array.isArray(row.unavailableDates)) throw new Error('Respuesta de catálogo inválida.');
      const dates = row.unavailableDates.map((value: unknown) => {
        if (typeof value !== 'string') throw new Error('Fecha de catálogo inválida.');
        const date = new Date(value); if (!Number.isFinite(date.getTime())) throw new Error('Fecha de catálogo inválida.'); return date;
      });
      ids.add(row.id); items.push({ ...row, unavailableDates: dates });
    }
    cursor = page.nextCursor;
    if (cursor) {
      if (!page.items.length || cursors.has(cursor)) throw new Error('Paginación de catálogo inválida.');
      cursors.add(cursor);
    }
  } while (cursor);
  verify(); return items;
}
