/**
 * The action registry and the controls that consume it
 * (Technical Specification 12.3).
 */
export { ActionButton } from './ActionButton';
export type { ActionButtonProps } from './ActionButton';
export { ActionIcon } from './ActionIcon';
export type { ActionIconProps } from './ActionIcon';
export {
  ACTIONS,
  ACTION_CATEGORIES,
  ACTION_ICONS,
  ACTION_MESSAGE_KEYS,
  actionById,
  defaultShortcuts,
  MODULE_TOGGLE_COUNT,
  moduleToggleActionId,
} from './registry';
export { commandAvailability } from './availability';
export type { CommandAvailability } from './availability';
export type { ActionCategory, ActionDefinition, ActionIcon as ActionIconName } from './registry';
export { useActionRunner } from './useActionRunner';
export {
  assignKey,
  isBindableKey,
  isRemappableAction,
  keyLabel,
  normaliseKey,
  REMAPPABLE_ACTIONS,
  resolveBindings,
  shortcutParameterName,
  shortcutParameters,
} from './bindings';
export type { BindingOverrides, KeyAssignment, ResolvedBindings } from './bindings';
export {
  SHORTCUT_CAPTURE_ATTRIBUTE,
  SHORTCUT_NOTICE_MS,
  ShortcutNotice,
  ShortcutProvider,
  useActionShortcuts,
  useBinding,
  useBindings,
  useShortcutNotice,
} from './shortcuts';
export type { ShortcutHandlers, ShortcutNoticeData, ShortcutOutcome } from './shortcuts';
export type { ActionRunner } from './useActionRunner';
