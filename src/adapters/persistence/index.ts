/**
 * Save stores behind the persistence port
 * (Technical Specification 4.3, 11.1).
 *
 * The engine decides what a snapshot contains and when one exists; these
 * adapters decide only where the bytes live. The direction never reverses: no
 * store reaches into the engine's domain, and no engine module imports one.
 */
export { createIndexedDbSaveStore, SAVE_DATABASE_NAME, SAVE_DATABASE_VERSION } from './indexedDbSaveStore.ts';
export type { IndexedDbSaveStoreOptions } from './indexedDbSaveStore.ts';
export { createMemorySaveStore } from './memorySaveStore.ts';
export type { MemorySaveStore, MemorySaveStoreOptions } from './memorySaveStore.ts';
export { planWrite } from './retention.ts';
export type { WritePlan } from './retention.ts';
