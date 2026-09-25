import type { MessageKey } from '@shared';

/**
 * The central action registry (Technical Specification 12.3).
 *
 * One entry describes an action once: its stable id, its label, the icon that
 * stands for it, its default shortcut and the category a later settings screen
 * will remap it in. Buttons, command bars, menus and keyboard handling all
 * read the same entry, so two surfaces cannot offer the same action under
 * different names or disagree about whether it exists.
 *
 * Availability is not here. Whether an action can be taken right now is a rule,
 * and rules live in the engine: each surface pairs a registry entry with the
 * availability and unavailability reason a projection supplied.
 *
 * @implements TECH-12.3
 */

/** Remapping categories, so a settings screen can group shortcuts. */
export const ACTION_CATEGORIES = [
  'navigation',
  'station',
  'flight',
  'combat',
  'view',
  'campaign',
  'time',
] as const;

export type ActionCategory = (typeof ACTION_CATEGORIES)[number];

/**
 * The shared icon vocabulary. An icon is a name, not a glyph: the renderer
 * decides how to draw it, and a shape-plus-label treatment is what keeps the
 * interface readable without colour (Technical Specification 12.2).
 */
export const ACTION_ICONS = [
  'station',
  'market',
  'hangar',
  'fitting',
  'services',
  'ship',
  'buy',
  'sell',
  'transfer',
  'repair',
  'resupply',
  'insurance',
  'commit',
  'revert',
  'clear',
  'inspect',
  'compare',
  'departure',
  'approach',
  'orbit',
  'keepRange',
  'moveTo',
  'stop',
  'warp',
  'retreat',
  'dock',
  'lock',
  'unlock',
  'fire',
  'ceaseFire',
  'reload',
  'ammunition',
  'module',
  'loot',
  'zoomIn',
  'zoomOut',
  'centre',
  'ranges',
  'next',
  'previous',
  'play',
  'pause',
  'save',
  'close',
  'reset',
] as const;

export type ActionIcon = (typeof ACTION_ICONS)[number];

export interface ActionDefinition {
  readonly id: string;
  readonly labelKey: MessageKey;
  /** Longer text for a tooltip or a hub tile, when the label is not enough. */
  readonly descriptionKey: MessageKey | null;
  readonly icon: ActionIcon;
  /** Default shortcut as a lower-case `KeyboardEvent.key`, or `null`. */
  readonly shortcut: string | null;
  readonly category: ActionCategory;
}

/**
 * How many active modules a toggle shortcut can reach, by position in the
 * ship's fitted order. The number is a property of the keyboard, not of the
 * hull: a ship with fewer active modules leaves the rest unbound.
 */
export const MODULE_TOGGLE_COUNT = 4;

/** The action id of the toggle for the active module at one position. */
export function moduleToggleActionId(position: number): string {
  return `module.toggle.${String(position)}`;
}

/**
 * Every action the station and space surfaces offer.
 *
 * Shortcuts are single keys that do not collide, and none of them is a key a
 * text field or an activated control needs. Continuous key state never steers
 * anything: each shortcut issues one discrete action.
 */
export const ACTIONS: readonly ActionDefinition[] = [
  {
    id: 'station.hub',
    labelKey: 'action.station.hub',
    descriptionKey: 'action.station.hub.detail',
    icon: 'station',
    shortcut: 'h',
    category: 'navigation',
  },
  {
    id: 'station.market',
    labelKey: 'action.station.market',
    descriptionKey: 'action.station.market.detail',
    icon: 'market',
    shortcut: 'm',
    category: 'navigation',
  },
  {
    id: 'station.hangar',
    labelKey: 'action.station.hangar',
    descriptionKey: 'action.station.hangar.detail',
    icon: 'hangar',
    shortcut: 'g',
    category: 'navigation',
  },
  {
    id: 'station.fitting',
    labelKey: 'action.station.fitting',
    descriptionKey: 'action.station.fitting.detail',
    icon: 'fitting',
    shortcut: 'f',
    category: 'navigation',
  },
  {
    id: 'station.services',
    labelKey: 'action.station.services',
    descriptionKey: 'action.station.services.detail',
    icon: 'services',
    shortcut: 'r',
    category: 'navigation',
  },
  {
    id: 'station.ship',
    labelKey: 'action.station.ship',
    descriptionKey: 'action.station.ship.detail',
    icon: 'ship',
    shortcut: 'y',
    category: 'navigation',
  },
  {
    id: 'station.departure',
    labelKey: 'action.station.departure',
    descriptionKey: 'action.station.departure.detail',
    icon: 'departure',
    shortcut: 'u',
    category: 'navigation',
  },
  {
    id: 'market.buy',
    labelKey: 'action.market.buy',
    descriptionKey: null,
    icon: 'buy',
    shortcut: null,
    category: 'station',
  },
  {
    id: 'market.sell',
    labelKey: 'action.market.sell',
    descriptionKey: null,
    icon: 'sell',
    shortcut: null,
    category: 'station',
  },
  {
    id: 'inventory.transfer',
    labelKey: 'action.inventory.transfer',
    descriptionKey: null,
    icon: 'transfer',
    shortcut: null,
    category: 'station',
  },
  {
    id: 'item.inspect',
    labelKey: 'action.item.inspect',
    descriptionKey: null,
    icon: 'inspect',
    shortcut: null,
    category: 'station',
  },
  {
    id: 'item.compare',
    labelKey: 'action.item.compare',
    descriptionKey: null,
    icon: 'compare',
    shortcut: null,
    category: 'station',
  },
  {
    id: 'fitting.begin',
    labelKey: 'action.fitting.begin',
    descriptionKey: null,
    icon: 'fitting',
    shortcut: null,
    category: 'station',
  },
  {
    id: 'fitting.commit',
    labelKey: 'action.fitting.commit',
    descriptionKey: null,
    icon: 'commit',
    shortcut: null,
    category: 'station',
  },
  {
    id: 'fitting.revert',
    labelKey: 'action.fitting.revert',
    descriptionKey: null,
    icon: 'revert',
    shortcut: null,
    category: 'station',
  },
  {
    id: 'fitting.clear',
    labelKey: 'action.fitting.clear',
    descriptionKey: null,
    icon: 'clear',
    shortcut: null,
    category: 'station',
  },
  {
    id: 'repair.confirm',
    labelKey: 'action.repair',
    descriptionKey: 'action.repair.detail',
    icon: 'repair',
    shortcut: null,
    category: 'station',
  },
  {
    id: 'resupply.confirm',
    labelKey: 'action.resupply',
    descriptionKey: 'action.resupply.detail',
    icon: 'resupply',
    shortcut: null,
    category: 'station',
  },
  {
    id: 'insurance.confirm',
    labelKey: 'action.insurance',
    descriptionKey: 'action.insurance.detail',
    icon: 'insurance',
    shortcut: null,
    category: 'station',
  },
  {
    id: 'navigation.selectDestination',
    labelKey: 'action.navigation.selectDestination',
    descriptionKey: null,
    icon: 'departure',
    shortcut: null,
    category: 'flight',
  },
  {
    // The player's own wreck is chosen at the station the way an encounter
    // is (Functional Specification 5.4, 9.12); from space the warp control
    // reaches it, so it needs no action of its own there.
    id: 'navigation.selectBookmark',
    labelKey: 'action.navigation.selectBookmark',
    descriptionKey: null,
    icon: 'departure',
    shortcut: null,
    category: 'flight',
  },
  {
    id: 'ship.undock',
    labelKey: 'action.ship.undock',
    descriptionKey: 'action.ship.undock.detail',
    icon: 'departure',
    shortcut: null,
    category: 'flight',
  },
  {
    id: 'movement.approach',
    labelKey: 'action.movement.approach',
    descriptionKey: null,
    icon: 'approach',
    shortcut: 'a',
    category: 'flight',
  },
  {
    id: 'movement.orbit',
    labelKey: 'action.movement.orbit',
    descriptionKey: null,
    icon: 'orbit',
    shortcut: 'o',
    category: 'flight',
  },
  {
    id: 'movement.keepRange',
    labelKey: 'action.movement.keepRange',
    descriptionKey: null,
    icon: 'keepRange',
    shortcut: 'k',
    category: 'flight',
  },
  {
    id: 'movement.moveToPoint',
    labelKey: 'action.movement.moveToPoint',
    descriptionKey: null,
    icon: 'moveTo',
    shortcut: null,
    category: 'flight',
  },
  {
    id: 'movement.stop',
    labelKey: 'action.movement.stop',
    descriptionKey: null,
    icon: 'stop',
    shortcut: 's',
    category: 'flight',
  },
  {
    id: 'navigation.warp',
    labelKey: 'action.navigation.warp',
    descriptionKey: null,
    icon: 'warp',
    shortcut: 'w',
    category: 'flight',
  },
  {
    id: 'navigation.dock',
    labelKey: 'action.navigation.dock',
    descriptionKey: null,
    icon: 'dock',
    shortcut: 'd',
    category: 'flight',
  },
  {
    id: 'navigation.retreat',
    labelKey: 'action.navigation.retreat',
    descriptionKey: 'action.navigation.retreat.detail',
    icon: 'retreat',
    shortcut: 'x',
    category: 'flight',
  },
  {
    id: 'targeting.lock',
    labelKey: 'action.targeting.lock',
    descriptionKey: null,
    icon: 'lock',
    shortcut: 'l',
    category: 'combat',
  },
  {
    id: 'targeting.unlock',
    labelKey: 'action.targeting.unlock',
    descriptionKey: null,
    icon: 'unlock',
    shortcut: 'n',
    category: 'combat',
  },
  {
    id: 'weapons.fire',
    labelKey: 'action.weapons.fire',
    descriptionKey: 'action.weapons.fire.detail',
    icon: 'fire',
    shortcut: 'e',
    category: 'combat',
  },
  {
    id: 'weapons.cease',
    labelKey: 'action.weapons.cease',
    descriptionKey: null,
    icon: 'ceaseFire',
    shortcut: 'q',
    category: 'combat',
  },
  {
    id: 'weapons.reload',
    labelKey: 'action.weapons.reload',
    descriptionKey: null,
    icon: 'reload',
    shortcut: 'v',
    category: 'combat',
  },
  {
    id: 'weapon.activate',
    labelKey: 'action.weapon.activate',
    descriptionKey: null,
    icon: 'fire',
    shortcut: null,
    category: 'combat',
  },
  {
    id: 'weapon.deactivate',
    labelKey: 'action.weapon.deactivate',
    descriptionKey: null,
    icon: 'ceaseFire',
    shortcut: null,
    category: 'combat',
  },
  {
    id: 'weapon.reload',
    labelKey: 'action.weapon.reload',
    descriptionKey: null,
    icon: 'reload',
    shortcut: null,
    category: 'combat',
  },
  {
    id: 'weapon.changeAmmunition',
    labelKey: 'action.weapon.changeAmmunition',
    descriptionKey: null,
    icon: 'ammunition',
    shortcut: null,
    category: 'combat',
  },
  {
    id: 'module.activate',
    labelKey: 'action.module.activate',
    descriptionKey: null,
    icon: 'module',
    shortcut: null,
    category: 'combat',
  },
  {
    id: 'module.deactivate',
    labelKey: 'action.module.deactivate',
    descriptionKey: null,
    icon: 'module',
    shortcut: null,
    category: 'combat',
  },
  ...Array.from({ length: MODULE_TOGGLE_COUNT }, (_, index): ActionDefinition => ({
    id: moduleToggleActionId(index + 1),
    labelKey: 'action.module.toggle',
    descriptionKey: null,
    icon: 'module',
    shortcut: String(index + 1),
    category: 'combat',
  })),
  {
    id: 'loot.take',
    labelKey: 'action.loot.take',
    descriptionKey: null,
    icon: 'loot',
    shortcut: null,
    category: 'combat',
  },
  {
    id: 'loot.takeAll',
    labelKey: 'action.loot.takeAll',
    descriptionKey: null,
    icon: 'loot',
    shortcut: 't',
    category: 'combat',
  },
  {
    id: 'space.selectNext',
    labelKey: 'action.space.selectNext',
    descriptionKey: null,
    icon: 'next',
    shortcut: ']',
    category: 'view',
  },
  {
    id: 'space.selectPrevious',
    labelKey: 'action.space.selectPrevious',
    descriptionKey: null,
    icon: 'previous',
    shortcut: '[',
    category: 'view',
  },
  {
    id: 'space.ranges',
    labelKey: 'action.space.ranges',
    descriptionKey: null,
    icon: 'ranges',
    shortcut: 'b',
    category: 'view',
  },
  {
    id: 'space.zoomIn',
    labelKey: 'action.space.zoomIn',
    descriptionKey: null,
    icon: 'zoomIn',
    shortcut: '=',
    category: 'view',
  },
  {
    id: 'space.zoomOut',
    labelKey: 'action.space.zoomOut',
    descriptionKey: null,
    icon: 'zoomOut',
    shortcut: '-',
    category: 'view',
  },
  {
    id: 'space.centre',
    labelKey: 'action.space.centre',
    descriptionKey: null,
    icon: 'centre',
    shortcut: 'c',
    category: 'view',
  },
  {
    id: 'time.toggle',
    labelKey: 'action.time.toggle',
    descriptionKey: null,
    icon: 'play',
    shortcut: 'p',
    category: 'time',
  },
  {
    id: 'campaign.save',
    labelKey: 'action.campaign.save',
    descriptionKey: null,
    icon: 'save',
    shortcut: null,
    category: 'campaign',
  },
  {
    id: 'campaign.close',
    labelKey: 'action.campaign.close',
    descriptionKey: null,
    icon: 'close',
    shortcut: null,
    category: 'campaign',
  },
  {
    id: 'campaign.reset',
    labelKey: 'action.campaign.reset',
    descriptionKey: null,
    icon: 'reset',
    shortcut: null,
    category: 'campaign',
  },
];

const BY_ID = new Map(ACTIONS.map((action) => [action.id, action]));

export function actionById(id: string): ActionDefinition {
  const action = BY_ID.get(id);
  if (action === undefined) {
    throw new Error(`No action is registered under the id "${id}".`);
  }
  return action;
}

/** Default shortcut to action id, for the keyboard handler and a settings screen. */
export function defaultShortcuts(): ReadonlyMap<string, string> {
  const bindings = new Map<string, string>();
  for (const action of ACTIONS) {
    if (action.shortcut !== null) {
      bindings.set(action.shortcut, action.id);
    }
  }
  return bindings;
}

/** Every message key the registry can surface, for catalogue coverage checks. */
export const ACTION_MESSAGE_KEYS: readonly MessageKey[] = [
  ...new Set(
    ACTIONS.flatMap((action) =>
      action.descriptionKey === null ? [action.labelKey] : [action.labelKey, action.descriptionKey],
    ),
  ),
].sort();
