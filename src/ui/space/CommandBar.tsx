import { useEffect, useRef, useState, type JSX, type KeyboardEvent as ReactKeyboardEvent } from 'react';

import type { CombatData, SiteData, SiteObjectData } from '@protocol';

import {
  ActionButton,
  commandAvailability as availability,
  useActionShortcuts,
  type ActionRunner,
  type CommandAvailability as Availability,
} from '../actions';
import { formatDistanceKm } from '../format/numbers';
import { useLocalizer, useTranslate } from '../localization';
import type { PlayData } from '../frame/usePlayData';
import { DestinationChooser } from './DestinationChooser';
import { ObjectList } from './ObjectList';
import styles from './Space.module.css';

/**
 * The Navigation panel beneath the radar (Functional Specification 7.1,
 * 9.2, 19.2; Technical Specification 12.3; MVP review 02).
 *
 * Two views share it, and only the one that matters now is shown:
 *
 * - **Warp** - where to go: the system's station, its encounter sites and the
 *   player's own wrecks, each with its briefing, the arrival distance and the
 *   warp or dock that reaches it.
 * - **Local** - what to do here: the range the orders use, Approach, Orbit,
 *   Keep range and Stop, locking the selected object, and the list of what is
 *   in the site, which is where targets are chosen. Each entry shows the
 *   player's lock on it and whether it has locked the player.
 *
 * Arriving in a site picks the view: a station's site opens on Warp, any other
 * site on Local. The player's own choice holds until the next arrival.
 * Both views stay mounted while hidden, so their keyboard shortcuts work
 * whichever is showing and a chosen destination is not forgotten.
 *
 * Every control pairs a registry entry with the availability the engine
 * projected for it, so nothing here decides whether an order is legal. An
 * order that cannot be given now stays visible and says why, and the ranges
 * and arrival distances it offers are the authored ones the projection
 * carries rather than numbers chosen by the interface. A course to a point
 * in the site is set from the radar's point menu, not from here.
 *
 * @implements FUNC-7.1, FUNC-7.2, FUNC-7.3, FUNC-7.4, FUNC-9.2, FUNC-19.2, FUNC-5.4, FUNC-9.12, TECH-12.3, MVP-AC-03, MVP-AC-08
 */

export interface CommandBarProps {
  readonly data: PlayData;
  readonly site: SiteData;
  readonly combat: CombatData | null;
  readonly objects: readonly SiteObjectData[];
  readonly selected: SiteObjectData | null;
  readonly runner: ActionRunner;
  /** The clock the engine last answered with, for a wreck's countdown. */
  readonly simulationTimeMs: number;
  /**
   * The distance range orders use. The screen holds it, because the context
   * menu gives the same orders at the same distance.
   */
  readonly rangeKm: number;
  onRangeChange(rangeKm: number): void;
  onSelect(objectId: string): void;
  /** Opens the contextual commands of one object, anchored to its list entry. */
  onContextMenu(objectId: string, anchor: Element): void;
}

export type NavigationView = 'warp' | 'local';

const VIEWS: readonly NavigationView[] = ['warp', 'local'];

const NO_SELECTION: Availability = { available: false, unavailableReason: 'shortcut.noSelection' };

export function CommandBar({
  data,
  site,
  combat,
  objects,
  selected,
  runner,
  simulationTimeMs,
  rangeKm,
  onRangeChange,
  onSelect,
  onContextMenu,
}: CommandBarProps): JSX.Element {
  const translate = useTranslate();
  const { locale } = useLocalizer();
  const presets = site.rangePresetsKm;
  const runtime = site.site;

  // The view a site opens on: Warp at a station's site, where the next step
  // is leaving, and Local anywhere else, where the ship came to do something.
  // It is chosen again on each arrival, never mid-site, so a change within
  // the site keeps the player's own choice.
  const arrivalView: NavigationView =
    runtime === null || runtime.objects.some((object) => object.kind === 'station') ? 'warp' : 'local';
  const siteInstanceId = runtime?.instanceId ?? null;
  const [view, setView] = useState<NavigationView>(arrivalView);
  const arrivedAt = useRef(siteInstanceId);
  useEffect(() => {
    if (arrivedAt.current === siteInstanceId) return;
    arrivedAt.current = siteInstanceId;
    setView(arrivalView);
  }, [siteInstanceId, arrivalView]);

  const tabs = useRef<Partial<Record<NavigationView, HTMLButtonElement | null>>>({});
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>): void => {
    const index = VIEWS.indexOf(view);
    const next =
      event.key === 'ArrowRight' ? VIEWS[(index + 1) % VIEWS.length]
      : event.key === 'ArrowLeft' ? VIEWS[(index - 1 + VIEWS.length) % VIEWS.length]
      : event.key === 'Home' ? VIEWS[0]
      : event.key === 'End' ? VIEWS[VIEWS.length - 1]
      : undefined;
    if (next === undefined) return;
    event.preventDefault();
    setView(next);
    tabs.current[next]?.focus();
  };

  const siteCommand = (command: string): Availability => availability(site.commands, command);
  const targetCommand = (command: string): Availability =>
    selected === null ? NO_SELECTION : availability(selected.commands, command);

  const order = async (
    command: 'movement.approach' | 'movement.orbit' | 'movement.keepRange',
  ): Promise<void> => {
    if (selected === null) {
      return;
    }
    await data.send(command, { targetId: selected.id, distanceKm: rangeKm });
  };

  // A movement order needs a selected object; without one the key says so.
  // Stop is an emergency control and always goes to the engine, whose
  // answer is shown like any other refusal.
  const orderShortcut = (
    command: 'movement.approach' | 'movement.orbit' | 'movement.keepRange',
  ): string | undefined => {
    if (selected === null) return 'shortcut.noSelection';
    const state = targetCommand(command);
    if (!state.available) return state.unavailableReason ?? 'shortcut.unavailable';
    runner.run(command, () => order(command));
    return undefined;
  };

  useActionShortcuts({
    'movement.approach': () => orderShortcut('movement.approach'),
    'movement.orbit': () => orderShortcut('movement.orbit'),
    'movement.keepRange': () => orderShortcut('movement.keepRange'),
    'movement.stop': () => {
      runner.run('movement.stop', async () => {
        await data.send('movement.stop', {});
      });
    },
  });

  const lock = targetCommand('targeting.lock');
  const locks = combat?.locks ?? [];
  // A lock held or in progress on the selection is released here; its own
  // projected availability says whether it can be.
  const selectedLock = selected === null ? null : (locks.find((entry) => entry.targetId === selected.id) ?? null);
  const unlock = selectedLock === null ? null : availability(selectedLock.commands, 'targeting.unlock');

  return (
    <section
      className={styles['commands']}
      aria-labelledby="commands-heading"
      data-panel="navigation"
      data-navigation-view={view}
      tabIndex={0}
    >
      <h3 id="commands-heading" className={styles['panelHeading']}>
        {translate('space.commands.heading')}
      </h3>

      <div className={styles['navTabs']} role="tablist" aria-label={translate('space.commands.heading')}>
        {VIEWS.map((candidate) => (
          <button
            key={candidate}
            ref={(element) => {
              tabs.current[candidate] = element;
            }}
            type="button"
            role="tab"
            id={`navigation-tab-${candidate}`}
            className={styles['navTab']}
            aria-selected={view === candidate}
            aria-controls={`navigation-view-${candidate}`}
            tabIndex={view === candidate ? 0 : -1}
            data-navigation-tab={candidate}
            onClick={() => {
              setView(candidate);
            }}
            onKeyDown={onTabKeyDown}
          >
            {translate(`space.commands.view.${candidate}`)}
          </button>
        ))}
      </div>

      <div
        id="navigation-view-warp"
        role="tabpanel"
        aria-labelledby="navigation-tab-warp"
        className={styles['navView']}
        hidden={view !== 'warp'}
      >
        <DestinationChooser data={data} site={site} runner={runner} simulationTimeMs={simulationTimeMs} />
      </div>

      <div
        id="navigation-view-local"
        role="tabpanel"
        aria-labelledby="navigation-tab-local"
        className={styles['navView']}
        hidden={view !== 'local'}
      >
        <div className={styles['commandRow']}>
          <label className={styles['field']}>
            {translate('space.commands.range')}
            <select
              value={String(rangeKm)}
              onChange={(event) => {
                onRangeChange(Number(event.target.value));
              }}
            >
              {presets.map((preset) => (
                <option key={preset} value={String(preset)}>
                  {translate('space.distance', { distance: formatDistanceKm(preset, locale) })}
                </option>
              ))}
            </select>
          </label>
          <ActionButton
            actionId="movement.approach"
            runner={runner}
            available={targetCommand('movement.approach').available}
            unavailableReason={targetCommand('movement.approach').unavailableReason}
            onRun={() => order('movement.approach')}
          />
          <ActionButton
            actionId="movement.orbit"
            runner={runner}
            available={targetCommand('movement.orbit').available}
            unavailableReason={targetCommand('movement.orbit').unavailableReason}
            onRun={() => order('movement.orbit')}
          />
          <ActionButton
            actionId="movement.keepRange"
            runner={runner}
            available={targetCommand('movement.keepRange').available}
            unavailableReason={targetCommand('movement.keepRange').unavailableReason}
            onRun={() => order('movement.keepRange')}
          />
          <ActionButton
            actionId="movement.stop"
            runner={runner}
            available={siteCommand('movement.stop').available}
            unavailableReason={siteCommand('movement.stop').unavailableReason}
            onRun={async () => {
              await data.send('movement.stop', {});
            }}
          />
          {unlock !== null && selected !== null ? (
            <ActionButton
              actionId="targeting.unlock"
              runner={runner}
              available={unlock.available}
              unavailableReason={unlock.unavailableReason}
              onRun={async () => {
                await data.send('targeting.unlock', { targetId: selected.id });
              }}
            />
          ) : (
            <ActionButton
              actionId="targeting.lock"
              runner={runner}
              variant="primary"
              available={lock.available}
              unavailableReason={lock.unavailableReason}
              onRun={async () => {
                if (selected !== null) await data.send('targeting.lock', { targetId: selected.id });
              }}
            />
          )}
        </div>
        {combat === null || combat.shipId === null ? null : (
          <p className={styles['muted']} data-lock-summary={locks.length}>
            {translate('tactical.locks.summary', {
              held: locks.length,
              maximum: combat.maxLockedTargets,
              range: formatDistanceKm(combat.maxLockRangeKm, locale),
            })}
          </p>
        )}
        <ObjectList
          objects={objects}
          combat={combat}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
          onContextMenu={onContextMenu}
        />
      </div>
    </section>
  );
}
