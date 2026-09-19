/**
 * Test-only gateways that host the engine in the current process.
 *
 * Production code must not import this package; the architecture check enforces
 * that so engine modules stay out of the interface bundle.
 */
export { createChannelGateway } from './channelGateway';
export type { ChannelGateway, ChannelGatewayOptions } from './channelGateway';
export { createDirectGateway } from './directGateway';
export type { DirectGatewayOptions } from './directGateway';
