import {
  DAMAGE_TYPES,
  type AmmunitionDefinition,
  type ContentRepository,
  type ModuleDefinition,
  type TradeableDefinition,
} from '@engine/ports';
import { InventoryError, type CampaignState } from '@engine/domain';
import type { ComparisonData, ComparisonDirection, ComparisonEntryData } from '@protocol';
import { deepFreeze } from '@shared';

import { itemDataOf } from './items';

/**
 * Comparing two catalog entries (Functional Specification 19.6).
 *
 * Differences are grouped by purpose, and each row states whether the left
 * value is better, worse, equal or simply different. A value whose meaning
 * depends on the situation - the range multiplier of a charge, the cycle time
 * of a weapon - is reported as neutral rather than dressed up as an
 * improvement.
 *
 * @implements FUNC-19.6
 */

/** Which way is better for a row, when either way is. */
type Preference = 'higher' | 'lower' | 'neutral';

interface Row {
  readonly key: string;
  readonly group: string;
  readonly preference: Preference;
  readonly value: (definition: TradeableDefinition) => number | null;
}

export function comparisonProjection(
  state: CampaignState,
  content: ContentRepository,
  definitionId: string,
  againstDefinitionId: string,
): ComparisonData {
  const left = content.tradeable(definitionId);
  const right = content.tradeable(againstDefinitionId);
  if (left === undefined || right === undefined) {
    throw new InventoryError('itemNotFound');
  }

  const rows = [...COMMON_ROWS, ...specificRows(content, left, right)];

  return deepFreeze({
    revision: state.revision,
    left: itemDataOf(left, content),
    right: itemDataOf(right, content),
    comparable: isComparable(content, left, right),
    entries: rows.flatMap((row) => entryOf(row, left, right)),
  });
}

/**
 * Two entries are comparable when the same rows mean the same thing for both:
 * modules of one category, or charges of one ammunition group.
 */
function isComparable(
  content: ContentRepository,
  left: TradeableDefinition,
  right: TradeableDefinition,
): boolean {
  const leftModule = content.module(left.id);
  const rightModule = content.module(right.id);
  if (leftModule !== undefined || rightModule !== undefined) {
    return leftModule !== undefined && rightModule !== undefined && leftModule.category === rightModule.category;
  }

  const leftCharge = content.ammunition(left.id);
  const rightCharge = content.ammunition(right.id);
  if (leftCharge !== undefined || rightCharge !== undefined) {
    return leftCharge !== undefined && rightCharge !== undefined && leftCharge.group === rightCharge.group;
  }

  return content.item(left.id) !== undefined && content.item(right.id) !== undefined;
}

const COMMON_ROWS: readonly Row[] = [
  {
    key: 'referenceValueCredits',
    group: 'value',
    preference: 'lower',
    value: (definition) => definition.referenceValueCredits,
  },
  {
    key: 'unitVolumeCubicDecimetres',
    group: 'value',
    preference: 'lower',
    value: (definition) => definition.volumeCubicDecimetres,
  },
];

function specificRows(
  content: ContentRepository,
  left: TradeableDefinition,
  right: TradeableDefinition,
): readonly Row[] {
  const modules = [content.module(left.id), content.module(right.id)];
  if (modules.some((module) => module !== undefined)) {
    return moduleRows(modules.filter((module): module is ModuleDefinition => module !== undefined));
  }

  const charges = [content.ammunition(left.id), content.ammunition(right.id)];
  if (charges.some((charge) => charge !== undefined)) {
    return AMMUNITION_ROWS;
  }

  return [];
}

function moduleRows(modules: readonly ModuleDefinition[]): readonly Row[] {
  const rows: Row[] = [
    { key: 'powerUse', group: 'fitting', preference: 'lower', value: moduleValue((module) => module.fitting.powerUse) },
    {
      key: 'processingUse',
      group: 'fitting',
      preference: 'lower',
      value: moduleValue((module) => module.fitting.processingUse),
    },
    {
      key: 'capacitorPerCycle',
      group: 'capacitor',
      preference: 'lower',
      value: moduleValue((module) => module.activation?.capacitorPerCycle ?? null),
    },
    {
      // A shorter cycle is more output and more drain at once, so which is
      // better depends on the fit rather than on the number.
      key: 'cycleSeconds',
      group: 'capacitor',
      preference: 'neutral',
      value: moduleValue((module) => module.activation?.cycleSeconds ?? null),
    },
  ];

  const categories = new Set(modules.map((module) => module.category));

  if (categories.has('turret')) {
    rows.push(
      turretRow('optimalRangeKm', 'offense', 'higher', (turret) => turret.optimalRangeKm),
      turretRow('falloffKm', 'offense', 'higher', (turret) => turret.falloffKm),
      turretRow('trackingRadiansPerSecond', 'offense', 'higher', (turret) => turret.trackingRadiansPerSecond),
      turretRow('damageMultiplier', 'offense', 'higher', (turret) => turret.damageMultiplier),
      turretRow('magazineSize', 'offense', 'higher', (turret) => turret.magazineSize),
      // A larger signature resolution tracks large targets better and small
      // ones worse, so it is not an improvement on its own.
      turretRow('signatureResolutionMetres', 'offense', 'neutral', (turret) => turret.signatureResolutionMetres),
    );
  }
  if (categories.has('propulsion')) {
    rows.push(
      {
        key: 'speedBonusFraction',
        group: 'movement',
        preference: 'higher',
        value: moduleValue((module) =>
          module.category === 'propulsion' ? module.propulsion.speedBonusFraction : null,
        ),
      },
      {
        key: 'signatureRadiusPenaltyFraction',
        group: 'movement',
        preference: 'lower',
        value: moduleValue((module) =>
          module.category === 'propulsion' ? module.propulsion.signatureRadiusPenaltyFraction : null,
        ),
      },
    );
  }
  if (categories.has('shieldBooster') || categories.has('armorRepairer')) {
    rows.push({
      key: 'repairHitPoints',
      group: 'defense',
      preference: 'higher',
      value: moduleValue((module) =>
        module.category === 'shieldBooster' || module.category === 'armorRepairer'
          ? module.repair.amountHitPoints
          : null,
      ),
    });
  }
  if (categories.has('resistancePlating')) {
    for (const damageType of DAMAGE_TYPES) {
      rows.push({
        key: `resistanceBonus.${damageType}`,
        group: 'defense',
        preference: 'higher',
        value: moduleValue((module) =>
          module.category === 'resistancePlating' ? module.resistance.bonuses[damageType] : null,
        ),
      });
    }
  }
  if (categories.has('capacitorBattery')) {
    rows.push(
      {
        key: 'capacitorCapacityBonus',
        group: 'capacitor',
        preference: 'higher',
        value: moduleValue((module) =>
          module.category === 'capacitorBattery' ? module.capacitorSupport.capacityBonus : null,
        ),
      },
      {
        key: 'capacitorRechargeBonusFraction',
        group: 'capacitor',
        preference: 'higher',
        value: moduleValue((module) =>
          module.category === 'capacitorBattery'
            ? module.capacitorSupport.rechargeBonusFraction
            : null,
        ),
      },
    );
  }

  return rows;
}

const AMMUNITION_ROWS: readonly Row[] = [
  ...DAMAGE_TYPES.map((damageType) => ({
    key: `damagePerShot.${damageType}`,
    group: 'offense',
    preference: 'higher' as const,
    value: chargeValue((charge) => charge.damagePerShot[damageType]),
  })),
  // Range and tracking multipliers trade against damage, so more is not
  // simply better (Functional Specification 19.6).
  {
    key: 'optimalRangeMultiplier',
    group: 'offense',
    preference: 'neutral',
    value: chargeValue((charge) => charge.optimalRangeMultiplier),
  },
  {
    key: 'falloffMultiplier',
    group: 'offense',
    preference: 'neutral',
    value: chargeValue((charge) => charge.falloffMultiplier),
  },
  {
    key: 'trackingMultiplier',
    group: 'offense',
    preference: 'neutral',
    value: chargeValue((charge) => charge.trackingMultiplier),
  },
];

function entryOf(
  row: Row,
  left: TradeableDefinition,
  right: TradeableDefinition,
): readonly ComparisonEntryData[] {
  const leftValue = row.value(left);
  const rightValue = row.value(right);
  if (leftValue === null && rightValue === null) {
    return [];
  }

  const difference = leftValue === null || rightValue === null ? null : leftValue - rightValue;

  return [
    {
      key: row.key,
      labelKey: `stat.${row.key}`,
      group: row.group,
      left: leftValue,
      right: rightValue,
      difference,
      direction: directionOf(row.preference, difference),
    },
  ];
}

function directionOf(preference: Preference, difference: number | null): ComparisonDirection {
  if (difference === null) {
    return 'neutral';
  }
  if (difference === 0) {
    return 'equal';
  }
  if (preference === 'neutral') {
    return 'neutral';
  }
  const higherIsBetter = preference === 'higher';
  return difference > 0 === higherIsBetter ? 'better' : 'worse';
}

function moduleValue(
  read: (module: ModuleDefinition) => number | null,
): (definition: TradeableDefinition) => number | null {
  return (definition) => {
    const module = definition as ModuleDefinition;
    return 'category' in definition && 'fitting' in definition ? read(module) : null;
  };
}

function chargeValue(
  read: (charge: AmmunitionDefinition) => number,
): (definition: TradeableDefinition) => number | null {
  return (definition) => ('group' in definition ? read(definition as AmmunitionDefinition) : null);
}

function turretRow(
  key: string,
  group: string,
  preference: Preference,
  read: (turret: Extract<ModuleDefinition, { category: 'turret' }>['turret']) => number,
): Row {
  return {
    key,
    group,
    preference,
    value: moduleValue((module) => (module.category === 'turret' ? read(module.turret) : null)),
  };
}
