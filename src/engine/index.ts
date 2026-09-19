/**
 * Public engine API.
 *
 * The engine is headless: it runs in the worker in production and directly in
 * tests, and depends on no DOM, React, storage or network facility
 * (Technical Specification 2, 4.1, 16).
 */
export { createEngineHost, ENGINE_VERSION } from '@engine/application';
export type { EngineHost, EngineHostOptions } from '@engine/application';
