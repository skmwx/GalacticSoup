/**
 * Protocol version (Technical Specification 7.1, 18).
 *
 * Version 18 adds the system's stations to `navigation.destinations`, each
 * with the warp to its site and the dock with it, so space navigation can
 * offer the way home beside the encounters and wrecks. Choosing an encounter
 * or a wreck is now accepted in space as well as docked.
 * Version 17 adds repair scopes: `repair.preview` takes an optional `scope`
 * (armour, hull or all; omitted is all) and the repair preview states the scope
 * it priced, so the station can offer armour-only and hull-only repairs beside
 * the whole one.
 * Version 16 adds market suitability and the sell side to `market.listings`:
 * each listing says which slot a module occupies or which weapons accept a
 * charge (and whether the active ship's committed fit carries one), and the
 * view lists the plain stacks owned locally with their sale price and why one
 * cannot be sold.
 * Version 15 adds the station's system name and danger rating to the station
 * services view, so the campaign header can say which system a docked pilot is
 * in without the interface reading content.
 * Version 14 adds the capacitor to the repair preview: the station recharges
 * it as part of the free shield repair, so the preview states the charge it
 * found and the capacity it restores.
 * Version 13 adds contextual guidance (`onboarding.state` and the hide, show
 * and skip-step commands), the semantic notification history
 * (`notifications.list`), the authored audible cues (`audio.cues`), the
 * guidance rule violations, and the capacitor recharge explanation on the
 * ship view.
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
export const PROTOCOL_VERSION = 18;

/**
 * Revision reported while no campaign is open. Revisions are per-campaign and
 * start above this value once a campaign exists (Technical Specification 7.2).
 */
export const NO_CAMPAIGN_REVISION = 0;

/** Correlation id used when a malformed message carries no usable request id. */
export const UNKNOWN_REQUEST_ID = '';

/** Upper bound on a request id, so correlation caches stay bounded. */
export const MAX_REQUEST_ID_LENGTH = 128;
