import { describe, expect, it } from 'vitest';

import { GATEWAY_MESSAGE_KEYS } from '@gateway';
import {
  GUIDANCE_STEP_STATUS_NAMES,
  NOTIFICATION_CATEGORY_NAMES,
  NOTIFICATION_SEVERITY_NAMES,
  PROTOCOL_MESSAGE_KEYS,
} from '@protocol';
import { createLocalizer, formatMessage } from '@shared';
import {
  ACTION_MESSAGE_KEYS,
  AUDIO_CHANNEL_NAMES,
  catalogFor,
  CATALOGS,
  COMBAT_LOG_FILTERS,
  DEFAULT_LOCALE,
} from '@ui';
import {
  ACTIVE_MODULE_STOP_REASONS,
  ENCOUNTER_STATUSES,
  LOCK_STATUSES,
  lockTime,
  TURRET_LIMITING_FACTORS,
  turretAccuracy,
  WEAPON_STOP_REASONS,
} from '@engine/domain';
import { DAMAGE_TYPES, DEFENSE_LAYERS } from '@engine/ports';
import { combatProjection } from '@engine/projections';

import { combatFixture } from '../../support/combat.ts';
import { shippedContent } from '../../support/content.ts';

/**
 * Every operand key a combat formula trace can carry: the two pure formulas,
 * and the capacitor and repair traces the tactical projection builds.
 */
function combatOperandKeys(): readonly string[] {
  const rules = shippedContent().rules.combat;
  const fixture = combatFixture();
  const combat = combatProjection(fixture.draft, fixture.content);
  const traces = [
    lockTime({ scanResolution: 100, targetSignatureMetres: 40 }, rules).trace,
    turretAccuracy(
      {
        optimalRangeKm: 1,
        falloffKm: 1,
        trackingRadiansPerSecond: 1,
        signatureResolutionMetres: 40,
        targetSignatureMetres: 40,
        rangeKm: 1,
        angularVelocityRadiansPerSecond: 0,
      },
      rules,
    ).trace,
    ...(combat.capacitor === null ? [] : [combat.capacitor.enduranceTrace]),
    ...combat.modules
      .filter((module) => module.effect.kind === 'repair')
      .map((module) => module.effect.trace),
  ];
  return [...new Set(traces.flatMap((trace) => trace.operands.map((operand) => operand.key)))];
}

/**
 * Rules and contracts carry message keys; only the catalogue carries text
 * (Technical Specification 12.5). Every key the engine or gateway can produce
 * must therefore exist in the shipped catalogue.
 */
const catalog = catalogFor(DEFAULT_LOCALE);

describe('message catalogue', () => {
  it.each(PROTOCOL_MESSAGE_KEYS)('covers the protocol key %s [TECH-5.4, TECH-12.5]', (key) => {
    expect(Object.prototype.hasOwnProperty.call(catalog, key)).toBe(true);
  });

  it.each(GATEWAY_MESSAGE_KEYS)('covers the gateway key %s [TECH-12.5]', (key) => {
    expect(Object.prototype.hasOwnProperty.call(catalog, key)).toBe(true);
  });

  it('covers the shell and compatibility surfaces [TECH-12.1, TECH-12.5]', () => {
    const required = [
      'app.title',
      'app.tagline',
      'shell.engine.connecting',
      'shell.engine.ready',
      'shell.engine.transport',
      'shell.engine.version',
      'shell.engine.protocolVersion',
      'shell.engine.requestTypes',
      'shell.engine.requestTypeCount',
      'shell.transport.worker',
      'shell.transport.port',
      'shell.transport.direct',
      'shell.diagnostics.sectionLabel',
      'shell.status.label',
      'shell.content.version',
      'shell.content.definitions',
      'shell.content.definitionCount',
      'compatibility.heading',
      'compatibility.detail',
      'compatibility.advice',
    ];

    const missing = required.filter((key) => !createLocalizer({ locale: 'en', catalog }).has(key));
    expect(missing).toEqual([]);
  });

  it.each(ACTION_MESSAGE_KEYS)('covers the action key %s [TECH-12.3, TECH-12.5]', (key) => {
    expect(Object.prototype.hasOwnProperty.call(catalog, key)).toBe(true);
  });

  /**
   * Keys the space view builds from a projected value cannot be found by
   * reading the source for literals, so every member of each family is listed
   * here (Technical Specification 12.5).
   */
  it('covers every key the space view composes at runtime [TECH-12.5, FUNC-19.2]', () => {
    const required = [
      ...['ship', 'station'].map((kind) => `space.kind.${kind}`),
      ...['approach', 'orbit', 'keepRange', 'moveToPoint', 'stop'].map(
        (kind) => `space.order.${kind}`,
      ),
      ...['aligning', 'preparing', 'transit'].map((phase) => `space.travel.warp.${phase}`),
      ...['approaching', 'preparing'].map((phase) => `space.travel.dock.${phase}`),
    ];

    const missing = required.filter((key) => !createLocalizer({ locale: 'en', catalog }).has(key));
    expect(missing).toEqual([]);
  });

  /**
   * The combat surfaces compose keys from projected vocabularies: attitudes,
   * roles, limiting factors, lock states, stop reasons, log filters and the
   * operands of every combat formula trace (Technical Specification 12.5).
   */
  it('covers every key the combat surfaces compose at runtime [TECH-12.5, FUNC-19.3, FUNC-19.6]', () => {
    const required = [
      'space.kind.wreck',
      ...['own', 'hostile', 'neutral'].map((attitude) => `tactical.attitude.${attitude}`),
      ...Object.keys(shippedContent().rules.combat.npcRoles).map((role) => `role.${role}`),
      ...TURRET_LIMITING_FACTORS.map((factor) => `tactical.limiting.${factor}`),
      ...LOCK_STATUSES.map((status) => `combat.lock.${status}`),
      ...LOCK_STATUSES.map((status) => `tactical.hostileLock.${status}`),
      ...LOCK_STATUSES.map((status) => `tactical.targetingYou.${status}`),
      ...[...WEAPON_STOP_REASONS, ...ACTIVE_MODULE_STOP_REASONS].map((reason) => `combat.stop.${reason}`),
      ...COMBAT_LOG_FILTERS.map((filter) => `tactical.log.filter.${filter}`),
      ...ENCOUNTER_STATUSES.filter((status) => status !== 'active').map((status) => `sortie.${status}`),
      ...DEFENSE_LAYERS.map((layer) => `layer.${layer}`),
      ...DAMAGE_TYPES.map((type) => `damage.${type}`),
      'combat.formula.hitChance',
      'combat.formula.lockTime',
      'combat.formula.capacitorEndurance',
      'combat.formula.repairRate',
      ...combatOperandKeys().map((key) => `operand.${key}`),
    ];

    const missing = required.filter((key) => !createLocalizer({ locale: 'en', catalog }).has(key));
    expect(missing).toEqual([]);
  });

  /**
   * The guidance and notification surfaces compose keys from projected
   * vocabularies: levels, categories, step states, audio channels and the
   * capacitor recharge explanation (Technical Specification 12.5).
   */
  it('covers every key the guidance and notification surfaces compose at runtime [TECH-12.5, FUNC-3.2, FUNC-19.7]', () => {
    const required = [
      ...NOTIFICATION_SEVERITY_NAMES.map((level) => `notifications.level.${level}`),
      ...NOTIFICATION_CATEGORY_NAMES.map((category) => `notifications.category.${category}`),
      ...GUIDANCE_STEP_STATUS_NAMES.map((status) => `guidance.status.${status}`),
      ...AUDIO_CHANNEL_NAMES.map((channel) => `notifications.settings.channel.${channel}`),
      'guidance.surface.space',
      'guidance.alreadyHidden',
      'guidance.alreadyShown',
      'combat.formula.capacitorRecharge',
      'operand.capacity',
      'operand.charge',
      'operand.rechargeSeconds',
    ];

    const missing = required.filter((key) => !createLocalizer({ locale: 'en', catalog }).has(key));
    expect(missing).toEqual([]);
  });

  it('has no empty or whitespace-only message [TECH-12.5]', () => {
    const empty = Object.entries(catalog)
      .filter(([, template]) => template.trim().length === 0)
      .map(([key]) => key);

    expect(empty).toEqual([]);
  });

  it('uses only well-formed placeholders [TECH-12.5]', () => {
    const malformed = Object.entries(catalog)
      .filter(([, template]) => {
        const rendered = formatMessage(template, {}).text;
        const braces = rendered.replace(/\{[A-Za-z][A-Za-z0-9_]*\}/g, '');
        return braces.includes('{') || braces.includes('}');
      })
      .map(([key]) => key);

    expect(malformed).toEqual([]);
  });

  it('ships exactly the locales it declares [TECH-12.5]', () => {
    expect(Object.keys(CATALOGS)).toEqual([DEFAULT_LOCALE]);
  });
});
