// Best-effort IndexedDB read-cache for offline billing — SALT-204 / ADR 0017.
//
// The counter caches its read working set (the catalogue today) on every
// successful online load, and serves it when offline instead of the demo seed,
// so a dropped link does not turn the counter into fake stock.
//
// **Best-effort by design:** every operation resolves and never throws. A
// missing / blocked / private-mode IndexedDB simply behaves as "no cache" — the
// caller falls back to its normal path. IndexedDB (not localStorage) because a
// real catalogue is large (thousands of items + batches) and async.

const DB_NAME = "salt-offline";
const DB_VERSION = 1;
const STORE = "kv";

export interface CacheEntry<T> {
  /** epoch ms when this entry was written — drives the "data as of …" hint. */
  cachedAt: number;
  data: T;
}

/** Org-scoped key for a working-set slice, e.g. `cacheKey("catalog", orgId)`. */
export function cacheKey(scope: string, orgId: string): string {
  return `${scope}:${orgId}`;
}

/** Human "data as of" staleness for the offline hint. Pure. */
export function formatStaleness(cachedAt: number, now: number = Date.now()): string {
  const min = Math.max(0, Math.round((now - cachedAt) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

/** Read a cache entry, or null when absent / unavailable. Never throws. */
export async function cacheGet<T>(key: string): Promise<CacheEntry<T> | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
      req.onsuccess = () => resolve((req.result as CacheEntry<T> | undefined) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Write a cache entry stamped with the current time. Never throws. */
export async function cachePut<T>(key: string, data: T): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ cachedAt: Date.now(), data } as CacheEntry<T>, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}
