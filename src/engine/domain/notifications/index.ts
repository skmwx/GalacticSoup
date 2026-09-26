/**
 * Semantic notifications and the bounded event history
 * (Functional Specification 19.7, 20; Technical Specification 12.4).
 */
export {
  forgetSiteNotifications,
  groupKeyOf,
  MAX_SUBJECTS,
  raisedThisSite,
  raiseNotification,
} from './history';
export type { NotificationRaise } from './history';
export { startingNotifications } from './start';
export {
  NOTIFICATION_HISTORY_LIMIT,
  NOTIFICATION_SITE_MEMORY_LIMIT,
} from './types';
export type { NotificationParamValue, NotificationRecord, NotificationState } from './types';
export { isNotificationState, validateNotifications } from './validation';
