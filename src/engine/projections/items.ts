import type { ContentRepository, TradeableDefinition } from '@engine/ports';
import type { ItemData } from '@protocol';

/**
 * The view model of one tradeable definition (Technical Specification 7.3).
 *
 * Stacks, fitted slots, market rows and comparisons all describe the same
 * thing, so they describe it the same way.
 */
export function itemDataOf(
  definition: TradeableDefinition,
  content: ContentRepository,
): ItemData {
  return {
    definitionId: definition.id,
    nameKey: definition.nameKey,
    descriptionKey: definition.descriptionKey,
    referenceValueCredits: definition.referenceValueCredits,
    unitVolumeCubicDecimetres: definition.volumeCubicDecimetres,
    kind:
      content.module(definition.id) !== undefined
        ? 'module'
        : content.ammunition(definition.id) !== undefined
          ? 'ammunition'
          : 'item',
  };
}
