/**
 * Command and query handling, transactions and request dispatch
 * (Technical Specification 4.3, 7.2).
 */
export {
  handleAdvanceTime,
  handleCloseCampaign,
  handleCreateCampaign,
  handleResetCampaign,
  handleResumeCampaign,
  handleSetTime,
  INSTALLED_BOUNDARY_RESOLVERS,
  INSTALLED_CONTINUOUS_SYSTEMS,
} from './commands';
export type { ResumeCampaignInput } from './commands';
export { createEngineHost } from './engineHost';
export type { EngineHost, EngineHostOptions } from './engineHost';
export {
  handleCapabilities,
  handleContentSummary,
  handleFrame,
  handleHealth,
  handleSession,
  handleStateHash,
} from './handlers';
export type { HandlerContext } from './handlers';
export {
  captureSnapshot,
  createSaveService,
  envelopeChecksum,
  isSealed,
  loadSave,
  migrateSave,
  SAVE_MIGRATIONS,
  saveIdOf,
} from './saves';
export type {
  CaptureInput,
  LoadContext,
  LoadFailure,
  LoadResult,
  LoadSuccess,
  MigratableSave,
  MigrationResult,
  ResumeResult,
  SaveMigration,
  SaveService,
  SaveServiceOptions,
} from './saves';
export { runCommand } from './pipeline';
export type { CommandRequest, CommandResult } from './pipeline';
export { createRecentRequests, RECENT_REQUEST_LIMIT } from './recentRequests';
export type { RecentRequests } from './recentRequests';
export {
  APPLIED,
  beginTransaction,
  commit,
  InvariantFailure,
  NoCampaignError,
  reject,
  UNCHANGED,
} from './transaction';
export type { CommandOutcome, CommitResult, Transaction } from './transaction';
export { ENGINE_VERSION } from './version';
