/**
 * The tuning digest of a compiled content bundle (MVP Implementation Plan
 * phase 17).
 *
 * The content hash changes with every edit, including a reworded description.
 * The tuning digest covers only what can change an outcome - rules,
 * definitions and market listings - so the balance candidate recorded in
 * `tests/fixtures/balance/candidate.json` goes stale exactly when a number
 * that the balance simulations measured has moved, and not when a player-facing
 * text has.
 *
 * Guidance, notifications and audible cues are definitions too, but they only
 * tell the player what happened; no rule reads them, so they are left out and a
 * reworded hint or a new cue leaves the candidate current.
 */
import { canonicalJson, sha256Hex } from '../../../src/shared/index.ts';

/** Definition kinds that present outcomes rather than decide them. */
const PRESENTATION_KINDS = new Set(['audio.cues', 'guidance', 'notifications']);

/**
 * @param {{ rules: unknown, definitions: unknown, listings: unknown }} bundle
 * @returns {string} lowercase hexadecimal SHA-256
 */
export function tuningDigest(bundle) {
  const definitions = Object.fromEntries(
    Object.entries(bundle.definitions).filter(([kind]) => !PRESENTATION_KINDS.has(kind)),
  );
  return sha256Hex(canonicalJson({
    definitions,
    listings: bundle.listings,
    rules: bundle.rules,
  }));
}
