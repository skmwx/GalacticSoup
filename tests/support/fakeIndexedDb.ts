/**
 * A small transactional stand-in for IndexedDB (Technical Specification 11.1,
 * 15.1).
 *
 * The IndexedDB save store is the one adapter the headless suites cannot reach
 * through a real browser database, and a browser cannot be made to run out of
 * space on request. This factory implements exactly the part of the API the
 * adapter uses, with the one property the adapter depends on: a transaction's
 * writes become visible together when it completes, and not at all when it
 * aborts. A test can make a chosen write fail, which is how a quota failure
 * and an interrupted write are produced.
 *
 * It is not a general IndexedDB implementation. Requests settle on later
 * turns of the event loop, a transaction completes once it has no request
 * outstanding, and keys are strings taken from each store's key path.
 */

type Handler = (() => void) | null;

interface FakeRequest<TResult> {
  result: TResult;
  error: DOMException | null;
  onsuccess: Handler;
  onerror: Handler;
}

interface StoreData {
  readonly keyPath: string;
  readonly records: Map<string, unknown>;
}

export interface WriteFailure {
  /** The object store whose next write fails. */
  readonly store: string;
  /** The DOMException name the failed request and its transaction report. */
  readonly errorName: string;
}

export interface FakeIndexedDb {
  readonly factory: IDBFactory;
  /** Makes the next `put` into a store fail and abort its transaction. */
  failNextWrite(failure: WriteFailure): void;
  /** Committed records of one store, by key. */
  records(store: string): Record<string, unknown>;
  /** How many read-write transactions have completed or aborted. */
  readonly writeTransactions: number;
  /** Makes `open` throw, as a browser with storage disabled does. */
  disable(): void;
}

export function createFakeIndexedDb(): FakeIndexedDb {
  const stores = new Map<string, StoreData>();
  let pendingFailure: WriteFailure | null = null;
  let writeTransactions = 0;
  let disabled = false;
  let created = false;

  const later = (work: () => void): void => {
    setTimeout(work, 0);
  };

  function transaction(names: string | string[], mode: 'readonly' | 'readwrite') {
    /** Writes made in this transaction: a value, or `undefined` for a delete. */
    const staged = new Map<string, Map<string, unknown>>();
    let outstanding = 0;
    let finished = false;
    void names;

    const tx = {
      error: null as DOMException | null,
      oncomplete: null as Handler,
      onerror: null as Handler,
      onabort: null as Handler,
      objectStore,
    };

    const finish = (): void => {
      if (finished || outstanding > 0) return;
      finished = true;
      if (mode === 'readwrite') writeTransactions += 1;
      for (const [name, changes] of staged) {
        const data = stores.get(name);
        if (data === undefined) continue;
        for (const [key, value] of changes) {
          if (value === undefined) data.records.delete(key);
          else data.records.set(key, value);
        }
      }
      tx.oncomplete?.();
    };

    const abort = (error: DOMException): void => {
      if (finished) return;
      finished = true;
      if (mode === 'readwrite') writeTransactions += 1;
      staged.clear();
      tx.error = error;
      tx.onerror?.();
      tx.onabort?.();
    };

    function settle<TResult>(compute: () => TResult, failure: DOMException | null = null): FakeRequest<TResult> {
      const request: FakeRequest<TResult> = { result: undefined as TResult, error: null, onsuccess: null, onerror: null };
      outstanding += 1;
      later(() => {
        outstanding -= 1;
        if (finished) return;
        if (failure !== null) {
          request.error = failure;
          request.onerror?.();
          abort(failure);
          return;
        }
        request.result = compute();
        request.onsuccess?.();
        // A handler may have issued another request; complete only when none is left.
        later(finish);
      });
      return request;
    }

    function objectStore(name: string) {
      const data = stores.get(name);
      if (data === undefined) throw new DOMException(`No object store "${name}".`, 'NotFoundError');
      const changes = staged.get(name) ?? new Map<string, unknown>();
      staged.set(name, changes);
      const read = (key: string): unknown =>
        changes.has(key) ? changes.get(key) : data.records.get(key);

      return {
        get: (key: string) => settle(() => structuredClone(read(key))),
        getAllKeys: () => settle(() => {
          const keys = new Set([...data.records.keys(), ...changes.keys()]);
          return [...keys].filter((key) => read(key) !== undefined).sort();
        }),
        put: (value: Record<string, unknown>) => {
          // A value that cannot be stored is refused at once, as IndexedDB does.
          const copy = structuredClone(value);
          const failing = pendingFailure !== null && pendingFailure.store === name ? pendingFailure : null;
          if (failing !== null) pendingFailure = null;
          return settle(
            () => {
              changes.set(String(copy[data.keyPath]), copy);
              return undefined;
            },
            failing === null ? null : new DOMException('The write failed.', failing.errorName),
          );
        },
        delete: (key: string) => settle(() => {
          changes.set(key, undefined);
          return undefined;
        }),
      };
    }

    // A transaction nothing was asked of completes on its own.
    later(() => { later(finish); });
    return tx;
  }

  const database = {
    objectStoreNames: { contains: (name: string): boolean => stores.has(name) },
    createObjectStore(name: string, options: { keyPath: string }) {
      stores.set(name, { keyPath: options.keyPath, records: new Map() });
      return { createIndex(): void {} };
    },
    transaction,
    close(): void {},
  };

  const factory = {
    open() {
      if (disabled) throw new DOMException('Storage is disabled.', 'SecurityError');
      const request = {
        result: database,
        error: null as DOMException | null,
        onupgradeneeded: null as Handler,
        onsuccess: null as Handler,
        onerror: null as Handler,
        onblocked: null as Handler,
      };
      later(() => {
        if (!created) {
          created = true;
          request.onupgradeneeded?.();
        }
        request.onsuccess?.();
      });
      return request;
    },
  };

  return {
    factory: factory as unknown as IDBFactory,
    failNextWrite(failure: WriteFailure): void {
      pendingFailure = failure;
    },
    records(store: string): Record<string, unknown> {
      return Object.fromEntries(
        [...(stores.get(store)?.records ?? new Map<string, unknown>())].map(([key, value]) => [key, structuredClone(value)]),
      );
    },
    get writeTransactions(): number {
      return writeTransactions;
    },
    disable(): void {
      disabled = true;
    },
  };
}
