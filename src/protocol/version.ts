/**
 * Protocol version (Technical Specification 7.1, 18).
 *
 * Version 9 adds active module commands plus layered defenses, capacitor,
 * module runtime and significant combat events to the tactical combat view.
 * Version 8 added targeting and weapon commands.
 */
export const PROTOCOL_VERSION = 9;

/**
 * Revision reported while no campaign is open. Revisions are per-campaign and
 * start above this value once a campaign exists (Technical Specification 7.2).
 */
export const NO_CAMPAIGN_REVISION = 0;

/** Correlation id used when a malformed message carries no usable request id. */
export const UNKNOWN_REQUEST_ID = '';

/** Upper bound on a request id, so correlation caches stay bounded. */
export const MAX_REQUEST_ID_LENGTH = 128;
