/// <reference lib="webworker" />
import { loadBundledContent } from '@adapters/content';
import { createEngineHost } from '@engine';

import { attachEngineHost, type MessageTargetLike } from './dispatcher';

/**
 * Engine worker entry point (Technical Specification 4.2).
 *
 * This module is loaded only inside the dedicated worker. The main thread
 * reaches it through the gateway and never imports it, so no engine code is
 * linked into the interface bundle.
 */
attachEngineHost(
  self as unknown as MessageTargetLike,
  createEngineHost({ content: loadBundledContent() }),
);
