// Durable offline write-queue — SALT-200 / ADR 0017, Phase 1.
//
// When the counter is offline, a write (a sale, a payment, …) is committed here
// as an **RPC intent** — the RPC name + args + a client-generated idempotency
// key — and drained in FIFO order on reconnect. Replay is safe because the key
// rides along to the RPC, which dedupes it (SALT-201); a duplicate returns the
// original document instead of re-posting.
//
// Decoupled by design: the queue never imports supabase. The caller passes an
// `executor` that performs the actual RPC (wired into billing in SALT-202), so
// this lib is pure orchestration + durable storage, and testable in isolation.
//
// Best-effort storage (its own IndexedDB DB): every op resolves, never throws.

const DB_NAME = "salt-write-queue";
const DB_VERSION = 1;
const STORE = "intents"; // out-of-line autoincrement keys => insertion order = FIFO

export interface QueueIntent {
  /** Client idempotency key (uuid). The executor passes it to the RPC (SALT-201). */
  key: string;
  /** RPC name, e.g. "create_sales_invoice". */
  rpc: string;
  args: Record<string, unknown>;
  enqueuedAt: number;
  attempts: number;
  status: "pending" | "parked";
  /** Last error message when retrying / parked. */
  error?: string;
}

/** Performs the real write for an intent; throws on failure. Provided by the caller. */
export type IntentExecutor = (intent: QueueIntent) => Promise<void>;

export type FlushAction = "delete" | "retry-stop" | "park-continue";

/**
 * Pure decision for one drained intent. On success → delete. On failure, bump
 * attempts: park it once it hits `maxAttempts` (and continue, so one poison
 * intent never deadlocks the head of the queue), otherwise stop the flush and
 * keep order for a later retry. Exported for tests.
 */
export function classifyFlushStep(
  intent: QueueIntent,
  ok: boolean,
  maxAttempts: number,
): { action: FlushAction; intent: QueueIntent } {
  if (ok) return { action: "delete", intent };
  const attempts = intent.attempts + 1;
  if (attempts >= maxAttempts) {
    return { action: "park-continue", intent: { ...intent, attempts, status: "parked" } };
  }
  return { action: "retry-stop", intent: { ...intent, attempts } };
}

function newKey(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

interface StoredIntent {
  idbKey: IDBValidKey;
  intent: QueueIntent;
}

function readAll(): Promise<StoredIntent[]> {
  return openDb().then(
    (db) =>
      new Promise<StoredIntent[]>((resolve) => {
        if (!db) return resolve([]);
        try {
          const tx = db.transaction(STORE, "readonly");
          const store = tx.objectStore(STORE);
          const keysReq = store.getAllKeys();
          const valsReq = store.getAll();
          tx.oncomplete = () => {
            const keys = keysReq.result as IDBValidKey[];
            const vals = valsReq.result as QueueIntent[];
            // getAllKeys + getAll both return in ascending key order, so they align.
            resolve(keys.map((k, i) => ({ idbKey: k, intent: vals[i] })));
          };
          tx.onerror = () => resolve([]);
        } catch {
          resolve([]);
        }
      }),
  );
}

function writeOp(run: (store: IDBObjectStore) => void): Promise<void> {
  return openDb().then(
    (db) =>
      new Promise<void>((resolve) => {
        if (!db) return resolve();
        try {
          const tx = db.transaction(STORE, "readwrite");
          run(tx.objectStore(STORE));
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      }),
  );
}

const listeners = new Set<() => void>();
/** Subscribe to queue changes (for a sync indicator). Returns an unsubscribe fn. */
export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function notify() {
  for (const fn of listeners) fn();
}

/** Commit an RPC intent to the durable queue. Returns its idempotency key. */
export async function enqueue(rpc: string, args: Record<string, unknown>): Promise<string> {
  const intent: QueueIntent = { key: newKey(), rpc, args, enqueuedAt: Date.now(), attempts: 0, status: "pending" };
  await writeOp((store) => store.put(intent));
  notify();
  return intent.key;
}

export interface FlushResult {
  synced: number;
  parked: number;
  /** pending intents still queued after this flush (transient failures to retry). */
  remaining: number;
}

/**
 * Drain pending intents in FIFO order through `executor`. Stops at the first
 * transient failure (preserving order for a later retry); parks an intent that
 * has exhausted `maxAttempts` and continues past it. Skips already-parked
 * intents. Call on reconnect.
 */
export async function flush(executor: IntentExecutor, maxAttempts = 5): Promise<FlushResult> {
  let synced = 0;
  let parked = 0;
  for (const { idbKey, intent } of await readAll()) {
    if (intent.status === "parked") continue;
    let ok = true;
    let error: string | undefined;
    try {
      await executor(intent);
    } catch (e) {
      ok = false;
      error = e instanceof Error ? e.message : String(e);
    }
    const { action, intent: updated } = classifyFlushStep(intent, ok, maxAttempts);
    if (action === "delete") {
      await writeOp((store) => store.delete(idbKey));
      synced++;
    } else if (action === "park-continue") {
      await writeOp((store) => store.put({ ...updated, error }, idbKey));
      parked++;
    } else {
      await writeOp((store) => store.put({ ...updated, error }, idbKey));
      break;
    }
  }
  notify();
  const remaining = (await readAll()).filter((s) => s.intent.status === "pending").length;
  return { synced, parked, remaining };
}

/** Queue depth by status, for a sync indicator. */
export async function status(): Promise<{ pending: number; parked: number }> {
  const all = await readAll();
  return {
    pending: all.filter((s) => s.intent.status === "pending").length,
    parked: all.filter((s) => s.intent.status === "parked").length,
  };
}
