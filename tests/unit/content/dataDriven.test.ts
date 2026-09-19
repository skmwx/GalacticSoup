import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  DAMAGE_TYPES,
  DEFENSE_LAYERS,
  HARDPOINT_KINDS,
  MODULE_CATEGORIES,
  RULE_GROUPS,
  SLOT_KINDS,
} from '@engine';

import { REPO_ROOT } from '../../../config/aliases.mjs';
import { shippedContent } from '../../support/content.ts';

/**
 * Data-driven content (Technical Specification 6.1).
 *
 * Engine source may contain structural algorithms and truly structural
 * enumerations - the four damage types, the slot kinds, the defensive layers.
 * Everything the functional specification describes as a value belongs in
 * content, so an author can change balance without touching the engine.
 */

const content = shippedContent();

function sourceOf(relative: string): string {
  return readFileSync(path.join(REPO_ROOT, relative), 'utf8');
}

/** Strips comments so documentation of a rule is not read as a rule. */
function codeOf(relative: string): string {
  return sourceOf(relative)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

describe('structural enumerations', () => {
  it('declares the four damage types and three layers [TECH-6.1, FUNC-9.7]', () => {
    expect([...DAMAGE_TYPES]).toEqual(['electromagnetic', 'thermal', 'kinetic', 'explosive']);
    expect([...DEFENSE_LAYERS]).toEqual(['shield', 'armor', 'hull']);
  });

  it('gives every hull a resistance for every damage type on every layer [TECH-6.1]', () => {
    for (const hull of content.hulls()) {
      for (const layer of DEFENSE_LAYERS) {
        expect(Object.keys(hull.defenses[layer].resistances).sort(), `${hull.id}.${layer}`).toEqual(
          [...DAMAGE_TYPES].sort(),
        );
      }
    }
  });

  it('divides every shot among exactly the four damage types [TECH-6.1, FUNC-9.7]', () => {
    for (const charge of content.ammunitions()) {
      expect(Object.keys(charge.damagePerShot).sort(), charge.id).toEqual([...DAMAGE_TYPES].sort());
      expect(
        Object.values(charge.damagePerShot).reduce((total, value) => total + value, 0),
        charge.id,
      ).toBeGreaterThan(0);
    }
  });

  it('uses only declared slots, hardpoints and categories [TECH-6.1, FUNC-8.3]', () => {
    for (const module of content.modules()) {
      expect(SLOT_KINDS, module.id).toContain(module.slot);
      expect(MODULE_CATEGORIES, module.id).toContain(module.category);
      if (module.hardpoint !== undefined) {
        expect(HARDPOINT_KINDS, module.id).toContain(module.hardpoint);
      }
    }
    for (const hull of content.hulls()) {
      expect(Object.keys(hull.slots).sort()).toEqual([...SLOT_KINDS].sort());
      expect(Object.keys(hull.hardpoints).sort()).toEqual([...HARDPOINT_KINDS].sort());
    }
  });
});

describe('tunable values live in content', () => {
  it('supplies every rule group through the content port [TECH-6.1]', () => {
    for (const group of RULE_GROUPS) {
      expect(Object.keys(content.rules[group]).length, group).toBeGreaterThan(0);
    }
    expect(content.rules.combat.resistanceMaximum).toBe(0.9);
    expect(content.rules.time.timeRates).toEqual([1]);
  });

  it('keeps balance numbers out of the port declarations [TECH-6.1]', () => {
    for (const file of [
      'src/engine/ports/content/rules.ts',
      'src/engine/ports/content/definitions.ts',
    ]) {
      const numericLiterals = codeOf(file).match(/(?<![\w.])\d+(\.\d+)?(?![\w.])/g) ?? [];

      expect(numericLiterals, file).toEqual([]);
    }
  });

  it('keeps authored text out of definitions, which carry keys only [TECH-6.1, TECH-12.5]', () => {
    for (const hull of content.hulls()) {
      expect(hull.nameKey.startsWith('content.'), hull.id).toBe(true);
      expect(content.message(content.defaultLocale, hull.nameKey), hull.id).toBeTruthy();
    }
    for (const encounter of content.encounters()) {
      for (const key of [encounter.nameKey, encounter.descriptionKey, encounter.rewardSummaryKey]) {
        expect(content.message(content.defaultLocale, key), encounter.id).toBeTruthy();
      }
    }
  });
});
