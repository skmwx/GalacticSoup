/**
 * Protocol version (Technical Specification 7.1, 18).
 *
 * Version 10 adds the encounter, opponent, wreck and loot contracts, the
 * disclosed reward summary on a destination, and the take-loot command.
 * Version 9 added active module commands and the full tactical combat view.
 */
export const PROTOCOL_VERSION = 10;

/**
 * Revision reported while no campaign is open. Revisions are per-campaign and
 * start above this value once a campaign exists (Technical Specification 7.2).
 */
export const NO_CAMPAIGN_REVISION = 0;

/** Correlation id used when a malformed message carries no usable request id. */
export const UNKNOWN_REQUEST_ID = '';

/** Upper bound on a request id, so correlation caches stay bounded. */
export const MAX_REQUEST_ID_LENGTH = 128;
