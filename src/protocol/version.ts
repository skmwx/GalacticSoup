/**
 * Protocol version (Technical Specification 7.1, 18).
 *
 * Version 12 adds player destruction and recovery: the `loss.report` query,
 * choosing and warping to the player's own wreck as a bookmark, a nullable
 * active ship for a pilot who owns none, recovery-grant marks on ships and
 * stacks, the `lost` sortie outcome, wreck ownership, and applied damage by
 * layer in the combat history.
 * Version 11 makes the tactical view an acceptance contract for the combat
 * interface: site objects carry the player's attitude toward them, the combat
 * view names who has locked the player, what each ship is running, which half
 * of the turret formula limits a shot and every charge a weapon could change
 * to, and a destination names the loot it discloses.
 * Version 10 added the encounter, opponent, wreck and loot contracts, the
 * disclosed reward summary on a destination, and the take-loot command.
 */
export const PROTOCOL_VERSION = 12;

/**
 * Revision reported while no campaign is open. Revisions are per-campaign and
 * start above this value once a campaign exists (Technical Specification 7.2).
 */
export const NO_CAMPAIGN_REVISION = 0;

/** Correlation id used when a malformed message carries no usable request id. */
export const UNKNOWN_REQUEST_ID = '';

/** Upper bound on a request id, so correlation caches stay bounded. */
export const MAX_REQUEST_ID_LENGTH = 128;
