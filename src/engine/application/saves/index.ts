/**
 * Save capture, loading and orchestration
 * (Technical Specification 11; Functional Specification 3.4).
 */
export { captureSnapshot, envelopeChecksum, isSealed, saveIdOf } from './envelope';
export type { CaptureInput } from './envelope';
export { loadSave } from './load';
export type { LoadContext, LoadFailure, LoadResult, LoadSuccess } from './load';
export { migrateSave, SAVE_MIGRATIONS } from './migrations';
export type { MigratableSave, MigrationResult, SaveMigration } from './migrations';
export { createSaveService } from './service';
export type { ResumeResult, SaveService, SaveServiceOptions } from './service';
