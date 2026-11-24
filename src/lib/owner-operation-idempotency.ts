const STORAGE_KEY = 'pediturno:owner-operation-idempotency:v1';
const TTL_MS = 24 * 60 * 60 * 1000;
const KEY_PATTERN = /^[A-Za-z0-9_-]{16,100}$/;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/;

type StoredOperation = { fingerprint: string; key: string; createdAt: number };
type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export type OwnerOperation = { fingerprint: string; key: string };

export class OwnerOperationStorageError extends Error {
  constructor() { super('No se pudo preparar la operación de forma segura. Verificá el almacenamiento del navegador e intentá nuevamente.'); }
}

function stableSerialize(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (Array.isArray(value)) return `[${value.map(item => stableSerialize(item === undefined ? null : item)).join(',')}]`;
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter(key => record[key] !== undefined).map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`).join(',')}}`;
  }
  throw new OwnerOperationStorageError();
}

function browserStorage(storage?: BrowserStorage): BrowserStorage {
  try {
    const value = storage ?? globalThis.localStorage;
    if (!value) throw new Error('unavailable');
    return value;
  } catch { throw new OwnerOperationStorageError(); }
}

function validEntry(value: unknown, now: number): value is StoredOperation {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Partial<StoredOperation>;
  return typeof entry.fingerprint === 'string' && FINGERPRINT_PATTERN.test(entry.fingerprint) &&
    typeof entry.key === 'string' && KEY_PATTERN.test(entry.key) &&
    typeof entry.createdAt === 'number' && Number.isFinite(entry.createdAt) && entry.createdAt <= now && now - entry.createdAt < TTL_MS;
}

function readEntries(storage: BrowserStorage, now: number): StoredOperation[] {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed) ? parsed.filter(entry => validEntry(entry, now)) : [];
    if (entries.length !== parsed.length) storage.setItem(STORAGE_KEY, JSON.stringify(entries));
    return entries;
  } catch { throw new OwnerOperationStorageError(); }
}

function writeEntries(storage: BrowserStorage, entries: StoredOperation[]) {
  try {
    if (entries.length) storage.setItem(STORAGE_KEY, JSON.stringify(entries));
    else storage.removeItem(STORAGE_KEY);
  } catch { throw new OwnerOperationStorageError(); }
}

async function sha256Hex(value: string): Promise<string> {
  try {
    const crypto = globalThis.crypto;
    if (!crypto?.subtle) throw new Error('unavailable');
    const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
    return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { throw new OwnerOperationStorageError(); }
}

/** Stores hashes and random keys only; browser storage never receives request data or a Firebase UID. */
export async function prepareOwnerOperation(input: { uid: string; operation: string; payload: unknown; storage?: BrowserStorage; now?: number }): Promise<OwnerOperation> {
  const now = input.now ?? Date.now();
  if (!Number.isFinite(now) || !input.uid || !input.operation) throw new OwnerOperationStorageError();
  const fingerprint = await sha256Hex(`${input.uid}\u0000${input.operation}\u0000${stableSerialize(input.payload)}`);
  const storage = browserStorage(input.storage);
  const entries = readEntries(storage, now);
  const existing = entries.find(entry => entry.fingerprint === fingerprint);
  if (existing) return { fingerprint, key: existing.key };
  let key: string;
  try {
    key = globalThis.crypto?.randomUUID?.() ?? '';
  } catch { throw new OwnerOperationStorageError(); }
  if (!KEY_PATTERN.test(key)) throw new OwnerOperationStorageError();
  writeEntries(storage, [...entries, { fingerprint, key, createdAt: now }]);
  return { fingerprint, key };
}

/** Clear only after a confirmed successful HTTP response, allowing uncertain responses to be retried safely. */
export function clearOwnerOperation(operation: OwnerOperation, storage?: BrowserStorage, now = Date.now()): void {
  if (!Number.isFinite(now) || !FINGERPRINT_PATTERN.test(operation.fingerprint) || !KEY_PATTERN.test(operation.key)) throw new OwnerOperationStorageError();
  const target = browserStorage(storage);
  const entries = readEntries(target, now).filter(entry => entry.fingerprint !== operation.fingerprint || entry.key !== operation.key);
  writeEntries(target, entries);
}
