/**
 * React views, SVG renderers, input and accessibility
 * (Technical Specification 4.3, 12).
 */
export {
  ActionButton,
  ActionIcon,
  ACTIONS,
  ACTION_CATEGORIES,
  ACTION_ICONS,
  ACTION_MESSAGE_KEYS,
  actionById,
  defaultShortcuts,
  useActionRunner,
  useActionShortcuts,
} from './actions';
export type {
  ActionCategory,
  ActionDefinition,
  ActionIconName,
  ActionRunner,
} from './actions';
export { CampaignPanel } from './campaign/CampaignPanel';
export type { CampaignPanelProps } from './campaign/CampaignPanel';
export { GameRoot } from './campaign/GameRoot';
export type { GameRootProps } from './campaign/GameRoot';
export { useCampaignSession } from './campaign/useCampaignSession';
export type { CampaignSessionView } from './campaign/useCampaignSession';
export { Dialog } from './common/Dialog';
export type { DialogProps } from './common/Dialog';
export { AttributeExplanation, FormulaExplanation } from './common/Explanation';
export { ItemComparison, ItemSummary } from './common/ItemDetail';
export { formatSimulationDuration } from './format/duration';
export {
  formatCredits,
  formatDifference,
  formatDistanceKm,
  formatPercent,
  formatQuantity,
  formatSpeedKmPerSecond,
  formatStat,
  formatVolume,
} from './format/numbers';
export { CampaignFrame } from './frame/CampaignFrame';
export type { CampaignFrameProps } from './frame/CampaignFrame';
export { PlayScreen } from './frame/PlayScreen';
export type { PlayScreenProps } from './frame/PlayScreen';
export { useSimulationClock } from './frame/useSimulationClock';
export type { SimulationClock } from './frame/useSimulationClock';
export { StationScreen } from './station/StationScreen';
export type { StationScreenProps } from './station/StationScreen';
export { usePlayData } from './frame/usePlayData';
export type {
  CommandAnswer,
  PlayCommand,
  PlayData,
  PlayDataOptions,
  PlayProjections,
} from './frame/usePlayData';
export { DeparturePanel } from './station/DeparturePanel';
export type { DeparturePanelProps } from './station/DeparturePanel';
export { useTransactionPreview } from './station/useTransactionPreview';
export type { TransactionPreview } from './station/useTransactionPreview';
export {
  clampZoom,
  CommandBar,
  DEFAULT_PIXELS_PER_KM,
  framing,
  kilometresPerPixel,
  labelVisible,
  LABEL_MINIMUM_PIXELS_PER_KM,
  MAX_EXTRAPOLATION_MS,
  MAX_PIXELS_PER_KM,
  MIN_PIXELS_PER_KM,
  MINIMUM_HIT_DIAMETER_PX,
  ObjectList,
  offScreenMarker,
  panned,
  REDUCED_MOTION_QUERY,
  ringSpacingKm,
  screenToWorld,
  SelectedObjectPanel,
  SiteView,
  SPACE_VIEWPORT,
  SpaceScreen,
  TravelStatus,
  useCamera,
  usePrefersReducedMotion,
  useSiteMotion,
  worldToScreen,
  zoomedBy,
  ZOOM_STEP,
} from './space';
export type {
  Camera,
  CameraControl,
  CommandBarProps,
  ObjectListProps,
  OffScreenMarker,
  Point,
  SelectedObjectPanelProps,
  SiteMotionOptions,
  SitePositions,
  SiteViewProps,
  SpaceScreenProps,
  TravelStatusProps,
  Viewport,
} from './space';
export { AppShell } from './shell/AppShell';
export type { AppShellProps } from './shell/AppShell';
export { CompatibilityFailure } from './shell/CompatibilityFailure';
export type { CompatibilityFailureProps } from './shell/CompatibilityFailure';
export { useEngineStatus } from './shell/useEngineStatus';
export type { EngineStatus } from './shell/useEngineStatus';
export {
  catalogFor,
  CATALOGS,
  ContentTextProvider,
  DEFAULT_LOCALE,
  LocalizationProvider,
  useLocalizationSettings,
  useLocalizer,
  useTranslate,
} from './localization';
export type { ContentTextProviderProps, LocalizationProviderProps } from './localization';
export { GLOBAL_STYLES_HREF } from './styles/globalStyles';
