/**
 * Engine compatibility version (Technical Specification 11.2).
 *
 * This value identifies the rules implementation, not the application release.
 * It is stored with a campaign snapshot once snapshots exist, so it changes
 * only when engine behaviour changes in a way a save must know about.
 */
/**
 * 0.2.0 is the v0.2 Combat Progression Alpha rules implementation. Saves
 * written by 0.1.x engines (save formats up to 10) are refused rather than
 * migrated (ADR-V02-01).
 */
export const ENGINE_VERSION = '0.2.0';
