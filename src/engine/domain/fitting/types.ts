import type { SlotKind } from '@engine/ports';
import type { AmmunitionId, ModuleId } from '@shared';
import type { EntityId } from '../campaign/identity';

/**
 * Slots, fits and fitting drafts (Functional Specification 8.3-8.5).
 *
 * A fit is described in one shape whether it is the fit a ship is actually
 * wearing or a fit the player is only considering. The derived-attribute
 * pipeline, the constraint checks and the previews therefore all read the same
 * description, and a preview cannot drift from the thing it previews.
 *
 * @implements FUNC-8.3, FUNC-8.4
 */

/** The largest slot index any hull may offer. */
export const MAX_SLOT_INDEX = 15;

export interface SlotRef {
  readonly kind: SlotKind;
  readonly index: number;
}

/** Stable key for a slot, used as a record key in authoritative state. */
export function slotKey(slot: SlotRef): string {
  return `${slot.kind}:${String(slot.index)}`;
}

export const SLOT_KEY_PATTERN = /^(weapon|system|engineering|utility):(0|[1-9][0-9]?)$/;

export function parseSlotKey(key: string): SlotRef | null {
  const match = SLOT_KEY_PATTERN.exec(key);
  if (match === null) {
    return null;
  }
  const index = Number(match[2]);
  return index > MAX_SLOT_INDEX ? null : { kind: match[1] as SlotKind, index };
}

/** Stable slot order: by kind as declared, then by index. */
export const SLOT_ORDER: readonly SlotKind[] = ['weapon', 'system', 'engineering', 'utility'];

export function compareSlots(a: SlotRef, b: SlotRef): number {
  return SLOT_ORDER.indexOf(a.kind) - SLOT_ORDER.indexOf(b.kind) || a.index - b.index;
}

/** A charge loaded into a weapon, with the physical stack that holds it. */
export interface LoadedCharge {
  readonly ammunitionId: AmmunitionId;
  readonly quantity: number;
  /** `null` in a preview, which has no physical units behind it yet. */
  readonly stackId: EntityId | null;
}

export interface FittedSlotDescription {
  readonly slot: SlotRef;
  readonly moduleId: ModuleId;
  /** An offline module keeps its slot but draws nothing and does nothing. */
  readonly online: boolean;
  readonly charge: LoadedCharge | null;
  /** `null` in a preview. */
  readonly stackId: EntityId | null;
}

/** A whole fit, ordered by slot. */
export type FitDescription = readonly FittedSlotDescription[];

/**
 * One slot of a fitting draft (Technical Specification 10.2).
 *
 * The draft names definitions rather than physical stacks. Which unit is used
 * is a planner decision taken when the draft is previewed or committed, so a
 * purchase or a transfer while the draft is open cannot invalidate it.
 */
export interface PlannedSlot {
  readonly moduleId: ModuleId;
  readonly online: boolean;
  readonly ammunitionId: AmmunitionId | null;
}

/**
 * An open fitting draft (Functional Specification 8.4-8.5).
 *
 * It is authoritative campaign state: the player may close the game with a
 * draft open and find it waiting, and reverting restores the fit the ship had
 * when the draft was opened.
 */
export interface FittingDraft {
  readonly shipId: EntityId;
  /** The campaign revision the draft was opened at, for traceability. */
  readonly baseRevision: number;
  readonly slots: Readonly<Record<string, PlannedSlot>>;
}

/** Why a fit may not be undocked with (Functional Specification 8.4). */
export const FIT_VIOLATIONS = [
  'moduleUnknown',
  'ammunitionUnknown',
  'slotUnavailable',
  'slotKindMismatch',
  'hardpointUnavailable',
  'hardpointMismatch',
  'ammunitionMismatch',
  'chargeNotAccepted',
  'magazineExceeded',
  'powerExceeded',
  'processingExceeded',
] as const;

export type FitViolationCode = (typeof FIT_VIOLATIONS)[number];

/** Advice that does not make a fit invalid (Functional Specification 8.5). */
export const FIT_WARNINGS = [
  'noWeapon',
  'noAmmunition',
  'moduleOffline',
  'capacitorUnstable',
  'uncoveredDamageType',
] as const;

export type FitWarningCode = (typeof FIT_WARNINGS)[number];

export interface FitIssue<TCode extends string> {
  readonly code: TCode;
  /** The slot the issue belongs to, or `null` for a whole-fit issue. */
  readonly slot: SlotRef | null;
  /** Transport-safe detail for the explanation the interface shows. */
  readonly params: Readonly<Record<string, string | number | boolean>>;
}

export type FitViolation = FitIssue<FitViolationCode>;
export type FitWarning = FitIssue<FitWarningCode>;

/** An item the draft needs that the local hangar and cargo cannot supply. */
export interface MissingItem {
  readonly definitionId: string;
  readonly required: number;
  readonly available: number;
}
