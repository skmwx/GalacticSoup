import { stacksIn, type CampaignState, type LossRecord } from '@engine/domain';
import type { ContentRepository } from '@engine/ports';
import type { FormulaTraceData, LossData, LossReportData } from '@protocol';
import { deepFreeze } from '@shared';

/**
 * The loss report view (Functional Specification 9.12, 19.6, 20;
 * Technical Specification 7.3, 10.3).
 *
 * The record was frozen when the ship was destroyed; this adds the names it
 * is shown by, the formula behind the insurance payout, and the wreck's
 * current state - still there or expired, how long it has left, how much is
 * still in it - so the station can say what the player may still recover.
 *
 * @implements FUNC-9.12, FUNC-19.6, FUNC-20, TECH-7.3, TECH-10.3, MVP-AC-08, MVP-AC-10
 */
export function lossReportProjection(state: CampaignState, content: ContentRepository): LossReportData {
  const loss = state.recovery.lastLoss;
  return deepFreeze({
    revision: state.revision,
    simulationTimeMs: state.time.simulationTimeMs,
    losses: state.recovery.losses,
    report: loss === null ? null : lossData(state, content, loss),
  });
}

function lossData(state: CampaignState, content: ContentRepository, loss: LossRecord): LossData {
  const site = content.system(loss.systemId)?.sites.find((entry) => entry.id === loss.siteId);
  const encounter = loss.encounterId === null ? undefined : content.encounter(loss.encounterId);
  const station = content.station(loss.recoveryStationId);
  const wreck = state.encounter.wrecks[loss.wreckId];
  const present = wreck !== undefined;
  return {
    lossId: loss.lossId,
    shipId: loss.shipId,
    hullId: loss.hullId,
    hullNameKey: content.hull(loss.hullId)?.nameKey ?? '',
    destroyedAtMs: loss.destroyedAtMs,
    systemId: loss.systemId,
    siteId: loss.siteId,
    siteNameKey: site?.nameKey ?? '',
    encounterId: loss.encounterId,
    encounterNameKey: encounter?.nameKey ?? null,
    recoveryStationId: loss.recoveryStationId,
    recoveryStationNameKey: station?.nameKey ?? '',
    wreck: {
      wreckId: loss.wreckId,
      present,
      expiresAtMs: loss.wreckExpiresAtMs,
      remainingSeconds: present
        ? Math.max(0, (loss.wreckExpiresAtMs - state.time.simulationTimeMs) / 1000)
        : 0,
      itemCount: present ? stacksIn(state.assets, wreck.inventoryId).length : 0,
      selected: state.navigation.selectedBookmarkId === loss.wreckId,
    },
    incoming: loss.incoming.map((source) => ({
      sourceId: source.sourceId,
      nameKey: source.nameKey,
      hits: source.hits,
      firstAtMs: source.firstAtMs,
      lastAtMs: source.lastAtMs,
      rawDamage: { ...source.rawDamage },
      appliedDamage: { ...source.appliedDamage },
      layerDamage: { ...source.layerDamage },
      appliedTotal: total(source.appliedDamage),
    })),
    totalAppliedDamage: loss.incoming.reduce((sum, source) => sum + total(source.appliedDamage), 0),
    finalDamage: loss.finalDamage === null ? null : {
      sourceId: loss.finalDamage.sourceId,
      nameKey: loss.finalDamage.nameKey,
      slotKey: loss.finalDamage.slotKey,
      hits: loss.finalDamage.hits,
      atMs: loss.finalDamage.atMs,
      rawDamage: { ...loss.finalDamage.rawDamage },
      appliedDamage: { ...loss.finalDamage.appliedDamage },
      appliedTotal: total(loss.finalDamage.appliedDamage),
    },
    disablingEffects: loss.disablingEffects.map((effect) => ({
      kind: effect.kind,
      slot: { kind: effect.slot.kind, index: effect.slot.index },
      moduleId: effect.moduleId,
      moduleNameKey: content.module(effect.moduleId)?.nameKey ?? '',
    })),
    items: loss.items.map((item) => ({
      definitionId: item.definitionId,
      nameKey: content.tradeable(item.definitionId)?.nameKey ?? '',
      quantity: item.quantity,
      origin: item.origin,
      survived: item.survived,
      recoveryGrant: item.recoveryGrant,
    })),
    insurance: {
      coverage: loss.insurance.coverage,
      hullReferenceValueCredits: loss.insurance.hullReferenceValueCredits,
      payoutFraction: loss.insurance.payoutFraction,
      payoutCredits: loss.insurance.payoutCredits,
      enhancedConsumed: loss.insurance.enhancedConsumed,
      recoveryGrantHull: loss.insurance.recoveryGrantHull,
      trace: insuranceTrace(loss),
    },
    recovery: {
      outcome: loss.recovery.outcome,
      activeShipId: loss.recovery.activeShipId,
      creditsAfter: loss.recovery.creditsAfter,
      starterReferenceValueCredits: loss.recovery.starterReferenceValueCredits,
    },
  };
}

/** The payout with its operands substituted (Functional Specification 19.6). */
function insuranceTrace(loss: LossRecord): FormulaTraceData {
  const insurance = loss.insurance;
  return {
    formulaKey: insurance.recoveryGrantHull ? 'insurance.payoutRecoveryGrant' : 'insurance.payout',
    operands: [
      { key: 'hullReferenceValueCredits', value: insurance.hullReferenceValueCredits },
      { key: 'payoutFraction', value: insurance.payoutFraction },
    ],
    unroundedResult: insurance.recoveryGrantHull
      ? 0
      : insurance.hullReferenceValueCredits * insurance.payoutFraction,
    displayResult: insurance.payoutCredits,
  };
}

function total(profile: Readonly<Record<string, number>>): number {
  return Math.round(Object.values(profile).reduce((sum, value) => sum + value, 0) * 1e6) / 1e6;
}

