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
 *  - Flush is strict **FIFO**. A transient failure stops the drain (order kept
 *    for retry, dead link not hammered); a record that fails `maxAttempts` times
 *    is **parked** and skipped, so one poison write can never block the head.
 *
 * (Consolidates the parallel `lib/offline/writeQueue.ts` spike — SALT-210 — whose
 * only unique feature, poison-parking, is folded in here.)
 */

export interface OutboxRecord {
  /** Client UUID — also the server idempotency key. */
  id: string;
  /** Mutation type, e.g. "create_sales_invoice"; routes to a registered handler. */
  kind: string;
  payload: unknown;
  createdAt: string;
  attempts: number;
  /** "parked" after `maxAttempts` failures — skipped by flush so it never blocks the head. Absent = pending. */
  status?: "pending" | "parked";
  lastError?: string;
  /** Opaque, non-routing metadata (e.g. amountPaise) for diagnostics/telemetry. Never read by the queue. */
  meta?: Record<string, unknown>;
}

/**
 * Generic lifecycle hooks for the (impure) caller to observe the queue — kept
 * here so `offline.ts` stays pure: it only invokes the callbacks, the wiring to
 * Supabase/telemetry lives in `./outbox`. Each callback must be side-effect-only
 * and non-throwing.
 */
export interface OutboxObserver {
  /** A queued record begins its first replay attempt (i.e. connectivity returned). */
  onReplayStart?(rec: OutboxRecord): void;
  /** A record synced and was removed from the queue. */
  onSynced?(rec: OutboxRecord): void;
  /** A record was parked (poison) after exhausting maxAttempts. */
  onParked?(rec: OutboxRecord): void;
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
  /** Records successfully synced and removed. */
  sent: number;
  /** Records parked this flush (exhausted maxAttempts). */
  parked: number;
  /** True if the drain halted on a transient failure (pending records remain to retry). */
  stopped: boolean;
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
  private observer?: OutboxObserver;

  constructor(store: OutboxStore, onChange?: () => void, observer?: OutboxObserver) {
    this.store = store;
    this.onChange = onChange;
    this.observer = observer;
  }

  /** Invoke an observer callback so a throwing observer can NEVER alter the drain
   *  (a throw in `onSynced` would otherwise hit flush's catch and re-queue an
   *  already-synced record → duplicate bill). Enforces the no-throw contract. */
  private safeNotify(cb: ((rec: OutboxRecord) => void) | undefined, rec: OutboxRecord): void {
    if (!cb) return;
    try {
      cb(rec);
    } catch {
      /* observers must never break the queue */
    }
  }

  register(kind: string, handler: OutboxHandler): void {
    this.handlers.set(kind, handler);
  }

  async enqueue(kind: string, payload: unknown, meta?: Record<string, unknown>): Promise<OutboxRecord> {
    const rec: OutboxRecord = {
      id: uuid(),
      kind,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
      status: "pending",
      ...(meta ? { meta } : {}),
    };
    await this.store.add(rec);
    this.onChange?.();
    return rec;
  }

  /** Records still waiting to sync — excludes parked (poison) records. */
  async pending(): Promise<number> {
    return (await this.store.list()).filter((r) => r.status !== "parked").length;
  }

  /** Parked (permanently-failed) records, for diagnostics / a "stuck" indicator. */
  async parked(): Promise<number> {
    return (await this.store.list()).filter((r) => r.status === "parked").length;
  }

  async list(): Promise<OutboxRecord[]> {
    return this.store.list();
  }

  /**
   * Replay queued mutations oldest-first. A transient failure **stops** the drain
   * (order kept for a later retry, dead link not hammered). A record that has
   * failed `maxAttempts` times is **parked** (status set, skipped from now on) and
   * the drain **continues** — so one poison write can never dead-lock the head.
   * Already-parked records and unregistered kinds are skipped.
   */
  async flush(maxAttempts = 5): Promise<FlushResult> {
    const items = await this.store.list();
    let sent = 0;
    let parked = 0;
    for (const rec of items) {
      if (rec.status === "parked") continue;
      const handler = this.handlers.get(rec.kind);
      if (!handler) continue;
      // First replay of a queued record — connectivity has returned for it.
      if (rec.attempts === 0) this.safeNotify(this.observer?.onReplayStart, rec);
      try {
        await handler(rec.payload, rec);
        await this.store.remove(rec.id);
        sent += 1;
        this.safeNotify(this.observer?.onSynced, rec);
        this.onChange?.();
      } catch (err) {
        rec.attempts += 1;
        rec.lastError = err instanceof Error ? err.message : String(err);
        if (rec.attempts >= maxAttempts) {
          rec.status = "parked";
          await this.store.update(rec);
          parked += 1;
          this.safeNotify(this.observer?.onParked, rec);
          this.onChange?.();
          continue; // poison record parked: keep draining the rest
        }
        await this.store.update(rec);
        this.onChange?.();
        return { sent, parked, stopped: true };
      }
    }
    return { sent, parked, stopped: false };
  }
}
