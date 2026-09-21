import type { LootTableDefinition } from '@engine/ports';

import { drawChance, drawIntegerInRange, type MutableRandomStreams } from '../random/streams';

import type { RolledLootEntry } from './types';

/**
 * Rolling the contents of one wreck (Functional Specification 9.11).
 *
 * Authored entries are resolved in their authored order, each with exactly one
 * chance draw and, when it succeeds, exactly one quantity draw. Both come from
 * the `loot` stream, so a combat roll can never shift what a wreck holds and a
 * replay of the same encounter produces the same wreck.
 *
 * A failed chance still consumes its draw: skipping it would make the stream
 * depend on earlier outcomes and break replay.
 *
 * @implements FUNC-9.11, TECH-9.4
 */
export function rollLoot(
  table: LootTableDefinition,
  streams: MutableRandomStreams,
): readonly RolledLootEntry[] {
  const rolled: RolledLootEntry[] = [];
  for (const entry of table.entries) {
    if (drawChance(streams, 'loot', entry.chance).outcome !== 1) continue;
    const quantity =
      entry.quantityMinimum === entry.quantityMaximum
        ? entry.quantityMinimum
        : drawIntegerInRange(streams, 'loot', entry.quantityMinimum, entry.quantityMaximum).outcome;
    if (quantity > 0) rolled.push({ definitionId: entry.itemId, quantity });
  }
  return rolled;
}

/** Every definition a table can drop, in stable order, for the disclosed summary. */
export function possibleLoot(table: LootTableDefinition): readonly string[] {
  return [...new Set(table.entries.map((entry) => entry.itemId))].sort();
}
