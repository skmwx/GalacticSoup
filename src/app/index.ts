/**
 * Application bootstrap and top-level routing
 * (Technical Specification 4.3).
 *
 * The browser entry module `main.tsx` is not re-exported: importing it renders
 * the application into the current document.
 */
export { AppRoot } from './AppRoot';
export type { AppRootProps } from './AppRoot';
export { connectEngine } from './engineConnection';
export type { EngineConnection } from './engineConnection';
