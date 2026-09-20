/// <reference lib="webworker" />
import { loadBundledContent } from '@adapters/content';
import { createIndexedDbSaveStore } from '@adapters/persistence';
import { createEngineHost } from '@engine';

import { attachEngineHost, type MessageTargetLike } from './dispatcher';

/**
 * Engine worker entry point (Technical Specification 4.2).
 *
 * This module is loaded only inside the dedicated worker. The main thread
 * reaches it through the gateway and never imports it, so no engine code is
 * linked into the interface bundle.
 *
 * The worker is also where the engine's adapters are composed: the compiled
 * content bundle and the IndexedDB save store. Both are reached only through
 * their ports, so the engine still knows neither.
 */
attachEngineHost(
  self as unknown as MessageTargetLike,
  createEngineHost({
    content: loadBundledContent(),
    saves: createIndexedDbSaveStore(),
  }),
);
