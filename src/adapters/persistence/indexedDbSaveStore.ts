import {
  SaveStoreError,
  type SaveStore,
  type SaveWriteRequest,
  type SlotManifest,
  type StorageReport,
} from '@engine/ports';

import { planWrite } from './retention.ts';

/**
 * The IndexedDB save store (Technical Specification 11.1).
 *
 * One database holds the slot manifests, the immutable snapshots keyed by save
 * id, and save diagnostics. Rotation happens in one transaction: the snapshot
 * is written, the manifest is updated, and only then is the excess deleted, so
 * a failed or interrupted write leaves the previous manifest and every
 * snapshot it names intact.
 *
 * The store runs wherever the engine host runs, which today is the dedicated
 * worker. It touches no other browser facility, and it never interprets what
 * it stores.
 *
 * @implements TECH-11.1
 */

export const SAVE_DATABASE_NAME = 'galactic-soup';
export const SAVE_DATABASE_VERSION = 1;

const MANIFEST_STORE = 'manifests';
const SNAPSHOT_STORE = 'snapshots';
const DIAGNOSTIC_STORE = 'diagnostics';

/** Bounds the diagnostics store so it cannot grow without limit. */
const MAX_DIAGNOSTICS = 32;

export interface IndexedDbSaveStoreOptions {
  readonly databaseName?: string;
  /** Overridable so a test can supply a fake factory. */
  readonly factory?: IDBFactory;
  readonly storageManager?: StorageManager | null;
}

interface SnapshotRecord {
  readonly saveId: string;
  readonly slotId: string;
  readonly document: unknown;
}

interface DiagnosticRecord {
  readonly key: string;
  readonly slotId: string;
  readonly saveId: string;
  readonly savedAtRealMs: number;
  readonly sequence: number;
}

export function createIndexedDbSaveStore(options: IndexedDbSaveStoreOptions = {}): SaveStore {
  const databaseName = options.databaseName ?? SAVE_DATABASE_NAME;
  const factory = options.factory ?? resolveFactory();
  const storageManager =
    options.storageManager === undefined ? resolveStorageManager() : options.storageManager;

  let opening: Promise<IDBDatabase> | null = null;

  function database(): Promise<IDBDatabase> {
    opening ??= openDatabase(factory, databaseName);
    return opening;
  }

  return {
    backend: 'indexeddb',

    async readManifest(slotId: string): Promise<SlotManifest | null> {
      const db = await database();
      const found = await request<SlotManifest | undefined>(
        db.transaction(MANIFEST_STORE, 'readonly').objectStore(MANIFEST_STORE).get(slotId),
        'readFailed',
        slotId,
      );
      return found ?? null;
    },

    async readSave(slotId: string, saveId: string): Promise<unknown | null> {
      const db = await database();
      const record = await request<SnapshotRecord | undefined>(
        db.transaction(SNAPSHOT_STORE, 'readonly').objectStore(SNAPSHOT_STORE).get(saveId),
        'readFailed',
        slotId,
      );
      if (record === undefined || record.slotId !== slotId) {
        return null;
      }
      return record.document;
    },

    async write(writeRequest: SaveWriteRequest): Promise<SlotManifest> {
      const { envelope, retention } = writeRequest;
      const db = await database();

      // The plan is computed before the transaction opens, so the transaction
      // itself issues its requests without waiting on anything and therefore
      // cannot be closed by the browser part-way through.
      const existing = await request<SlotManifest | undefined>(
        db
          .transaction(MANIFEST_STORE, 'readonly')
          .objectStore(MANIFEST_STORE)
          .get(envelope.slotId),
        'readFailed',
        envelope.slotId,
      );
      const plan = planWrite(existing ?? null, envelope, retention);

      const transaction = db.transaction(
        [MANIFEST_STORE, SNAPSHOT_STORE, DIAGNOSTIC_STORE],
        'readwrite',
      );
      const snapshot: SnapshotRecord = {
        saveId: envelope.saveId,
        slotId: envelope.slotId,
        document: envelope,
      };
      const diagnostic: DiagnosticRecord = {
        key: `${envelope.slotId}:lastWrite`,
        slotId: envelope.slotId,
        saveId: envelope.saveId,
        savedAtRealMs: envelope.savedAtRealMs,
        sequence: envelope.sequence,
      };

      transaction.objectStore(SNAPSHOT_STORE).put(snapshot);
      transaction.objectStore(MANIFEST_STORE).put(plan.manifest);
      for (const saveId of plan.removeIds) {
        transaction.objectStore(SNAPSHOT_STORE).delete(saveId);
      }
      transaction.objectStore(DIAGNOSTIC_STORE).put(diagnostic);
      pruneDiagnostics(transaction);

      await settle(transaction, envelope.slotId);
      return plan.manifest;
    },

    async clearSlot(slotId: string): Promise<void> {
      const db = await database();
      const manifest = await request<SlotManifest | undefined>(
        db.transaction(MANIFEST_STORE, 'readonly').objectStore(MANIFEST_STORE).get(slotId),
        'readFailed',
        slotId,
      );

      const transaction = db.transaction(
        [MANIFEST_STORE, SNAPSHOT_STORE, DIAGNOSTIC_STORE],
        'readwrite',
      );
      for (const save of manifest?.saves ?? []) {
        transaction.objectStore(SNAPSHOT_STORE).delete(save.saveId);
      }
      transaction.objectStore(MANIFEST_STORE).delete(slotId);
      transaction.objectStore(DIAGNOSTIC_STORE).delete(`${slotId}:lastWrite`);
      await settle(transaction, slotId);
    },

    async estimate(): Promise<StorageReport> {
      if (storageManager === null || typeof storageManager.estimate !== 'function') {
        return { persistent: null, usageBytes: null, quotaBytes: null };
      }
      try {
        const estimate = await storageManager.estimate();
        return {
          persistent: null,
          usageBytes: estimate.usage ?? null,
          quotaBytes: estimate.quota ?? null,
        };
      } catch {
        return { persistent: null, usageBytes: null, quotaBytes: null };
      }
    },

    async requestPersistence(): Promise<boolean | null> {
      if (storageManager === null || typeof storageManager.persist !== 'function') {
        return null;
      }
      try {
        if (typeof storageManager.persisted === 'function' && (await storageManager.persisted())) {
          return true;
        }
        return await storageManager.persist();
      } catch {
        return null;
      }
    },
  };
}

function resolveFactory(): IDBFactory {
  const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
  if (factory === undefined) {
    throw new SaveStoreError('unavailable', 'This browser provides no IndexedDB.');
  }
  return factory;
}

function resolveStorageManager(): StorageManager | null {
  const storage = (globalThis as { navigator?: { storage?: StorageManager } }).navigator?.storage;
  return storage ?? null;
}

function openDatabase(factory: IDBFactory, name: string): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    let open: IDBOpenDBRequest;
    try {
      open = factory.open(name, SAVE_DATABASE_VERSION);
    } catch (cause) {
      reject(new SaveStoreError('unavailable', 'The save database could not be opened.'));
      void cause;
      return;
    }

    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(MANIFEST_STORE)) {
        db.createObjectStore(MANIFEST_STORE, { keyPath: 'slotId' });
      }
      if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
        const snapshots = db.createObjectStore(SNAPSHOT_STORE, { keyPath: 'saveId' });
        snapshots.createIndex('slotId', 'slotId', { unique: false });
      }
      if (!db.objectStoreNames.contains(DIAGNOSTIC_STORE)) {
        db.createObjectStore(DIAGNOSTIC_STORE, { keyPath: 'key' });
      }
    };
    open.onsuccess = () => {
      resolve(open.result);
    };
    open.onerror = () => {
      reject(new SaveStoreError('unavailable', 'The save database could not be opened.'));
    };
    open.onblocked = () => {
      reject(new SaveStoreError('unavailable', 'Another tab is holding the save database open.'));
    };
  });
}

function request<TResult>(
  operation: IDBRequest<TResult>,
  reason: 'readFailed' | 'writeFailed',
  slotId: string,
): Promise<TResult> {
  return new Promise<TResult>((resolve, reject) => {
    operation.onsuccess = () => {
      resolve(operation.result);
    };
    operation.onerror = () => {
      reject(describe(operation.error, reason, slotId));
    };
  });
}

/** Resolves when the transaction has committed, or rejects with its failure. */
function settle(transaction: IDBTransaction, slotId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => {
      resolve();
    };
    transaction.onerror = () => {
      reject(describe(transaction.error, 'writeFailed', slotId));
    };
    transaction.onabort = () => {
      reject(describe(transaction.error, 'writeFailed', slotId));
    };
  });
}

/**
 * Keeps the diagnostics store bounded (Technical Specification 11.1).
 *
 * The follow-up deletes are issued from the request's own success handler
 * rather than after an `await`, so the transaction is never left without a
 * pending request and cannot commit part-way through.
 */
function pruneDiagnostics(transaction: IDBTransaction): void {
  const store = transaction.objectStore(DIAGNOSTIC_STORE);
  const all = store.getAllKeys();
  all.onsuccess = () => {
    const keys = all.result;
    for (const key of keys.slice(0, Math.max(0, keys.length - MAX_DIAGNOSTICS))) {
      store.delete(key);
    }
  };
}

/**
 * A quota failure is reported as its own reason, because the interface must
 * tell the player that space ran out rather than that the save was lost: the
 * previous snapshots are still there (Technical Specification 11.1).
 */
function describe(
  error: DOMException | null,
  reason: 'readFailed' | 'writeFailed',
  slotId: string,
): SaveStoreError {
  if (error?.name === 'QuotaExceededError') {
    return new SaveStoreError('quota', 'There is not enough space to store the save.', slotId);
  }
  return new SaveStoreError(reason, error?.message ?? 'The save store failed.', slotId);
}
