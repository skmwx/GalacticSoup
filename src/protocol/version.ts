/**
 * Protocol version (Technical Specification 7.1, 18).
 *
 * Version 5 adds the authored content catalogue the interface resolves
 * projection message keys against, and the per-slot fitting candidates the
 * fitting screen offers, to the station preparation contracts of version 4.
 */
export const PROTOCOL_VERSION = 5;

/**
 * Revision reported while no campaign is open. Revisions are per-campaign and
 * start above this value once a campaign exists (Technical Specification 7.2).
 */
export const NO_CAMPAIGN_REVISION = 0;

/** Correlation id used when a malformed message carries no usable request id. */
export const UNKNOWN_REQUEST_ID = '';

/** Upper bound on a request id, so correlation caches stay bounded. */
export const MAX_REQUEST_ID_LENGTH = 128;
