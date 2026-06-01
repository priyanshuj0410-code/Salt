/**
 * Offline write outbox (SALT-100) — the queued-writes substrate behind
 * "bill through an outage, sync on reconnect".
 *
 * The awareness layer (`useOnlineStatus` + `OfflineBanner`, SALT-135) tells the
 * user they are offline; this layer lets a mutation succeed anyway: it is
 * persisted to a durable local queue (IndexedDB, survives a reload) and replayed
 * to the server when connectivity returns.
 *
 * This file is intentionally **pure** (no React / Supabase / sibling imports) so
 * the queue logic is unit/smoke-testable with the in-memory store. The browser
 * singleton + React hook + online-aware auto-flush live in `./outbox`.
 *
 * Design per ADR 0017 (offline outbox over ElectricSQL):
 *  - The record `id` is a client-generated UUID used as the **idempotency key**;
 *    a replay-safe server (the RPC honours the key) makes delivery exactly-once,
 *    otherwise at-least-once with client-side de-dup on success.
 *  - Flush is strict **FIFO** and **stops on the first failure**, so a queued
 *    sale is never reordered behind a later one, and a dead link is not hammered.
 */

export interface OutboxRecord {
  /** Client UUID — also the server idempotency key. */
  id: string;
  /** Mutation type, e.g. "create_sales_invoice"; routes to a registered handler. */
  kind: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
  lastError?: string;
}

/** Durable storage for the queue. FIFO is by `createdAt`. */
export interface OutboxStore {
  list(): Promise<OutboxRecord[]>;
  add(rec: OutboxRecord): Promise<void>;
  update(rec: OutboxRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

/** Performs the real network mutation. Must be replay-safe (idempotent). */
export type OutboxHandler = (payload: unknown, rec: OutboxRecord) => Promise<void>;

export interface FlushResult {
  sent: number;
  failed: number;
}

function uuid(): string {
  // Browser secure context + Node 18+ both expose crypto.randomUUID globally.
  return globalThis.crypto.randomUUID();
}

/** In-memory store — for tests, SSR, and as a fallback when IndexedDB is absent. */
export class InMemoryOutboxStore implements OutboxStore {
  private recs: OutboxRecord[] = [];
  async list(): Promise<OutboxRecord[]> {
    return [...this.recs].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async add(rec: OutboxRecord): Promise<void> {
    this.recs.push({ ...rec });
  }
  async update(rec: OutboxRecord): Promise<void> {
    const i = this.recs.findIndex((r) => r.id === rec.id);
    if (i !== -1) this.recs[i] = { ...rec };
  }
  async remove(id: string): Promise<void> {
    this.recs = this.recs.filter((r) => r.id !== id);
  }
}

/** Durable browser store backed by IndexedDB (survives reloads / crashes). */
export class IndexedDbOutboxStore implements OutboxStore {
  private dbName: string;
  private storeName: string;

  constructor(dbName = "salt-offline", storeName = "outbox") {
    this.dbName = dbName;
    this.storeName = storeName;
  }

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(this.storeName)) {
          db.createObjectStore(this.storeName, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(this.storeName, mode);
      const req = fn(tx.objectStore(this.storeName));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
    });
  }

  async list(): Promise<OutboxRecord[]> {
    const all = await this.run<OutboxRecord[]>("readonly", (s) => s.getAll());
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async add(rec: OutboxRecord): Promise<void> {
    await this.run("readwrite", (s) => s.add(rec));
  }
  async update(rec: OutboxRecord): Promise<void> {
    await this.run("readwrite", (s) => s.put(rec));
  }
  async remove(id: string): Promise<void> {
    await this.run("readwrite", (s) => s.delete(id));
  }
}

/**
 * The outbox: enqueue mutations, replay them FIFO. Consumers `register()` a
 * handler per mutation `kind` (decoupling — billing registers its own sender),
 * then `enqueue()` instead of calling the network directly when offline (or
 * always, for an optimistic-then-sync model).
 */
export class Outbox {
  private handlers = new Map<string, OutboxHandler>();
  private store: OutboxStore;
  private onChange?: () => void;

  constructor(store: OutboxStore, onChange?: () => void) {
    this.store = store;
    this.onChange = onChange;
  }

  register(kind: string, handler: OutboxHandler): void {
    this.handlers.set(kind, handler);
  }

  async enqueue(kind: string, payload: unknown): Promise<OutboxRecord> {
    const rec: OutboxRecord = {
      id: uuid(),
      kind,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    await this.store.add(rec);
    this.onChange?.();
    return rec;
  }

  async pending(): Promise<number> {
    return (await this.store.list()).length;
  }

  async list(): Promise<OutboxRecord[]> {
    return this.store.list();
  }

  /**
   * Replay queued mutations oldest-first. Stops at the first failure to keep
   * order and avoid hammering a dead link. Items whose `kind` has no registered
   * handler are left in place (a wiring bug, not a transient failure) and skipped.
   */
  async flush(): Promise<FlushResult> {
    const items = await this.store.list();
    let sent = 0;
    for (const rec of items) {
      const handler = this.handlers.get(rec.kind);
      if (!handler) continue;
      try {
        await handler(rec.payload, rec);
        await this.store.remove(rec.id);
        sent++;
        this.onChange?.();
      } catch (err) {
        rec.attempts += 1;
        rec.lastError = err instanceof Error ? err.message : String(err);
        await this.store.update(rec);
        this.onChange?.();
        return { sent, failed: items.length - sent };
      }
    }
    return { sent, failed: 0 };
  }
}
