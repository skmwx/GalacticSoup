import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClientGateway } from '@gateway';
import type {
  EngineError,
  RequestPayload,
  TransactionPreviewData,
} from '@protocol';

import type { StationData } from './useStationData';

/**
 * Preview and confirmation for one economic action
 * (Technical Specification 7.4; Functional Specification 19.5).
 *
 * The engine calculates the preview and binds it to the state it was
 * calculated from. This asks for it, keeps the returned token untouched and
 * hands it straight back on confirmation. It never recalculates a total.
 *
 * When the engine answers `STALE_PREVIEW` it supplies the replacement, which
 * is shown in place of the old figures and must be confirmed again - the
 * player is never charged a price they were not shown.
 *
 * @implements TECH-7.4, FUNC-19.5, FUNC-22.4
 */

export type PreviewRequest =
  | 'market.previewBuy'
  | 'market.previewSell'
  | 'repair.preview'
  | 'resupply.preview'
  | 'insurance.preview';

export type ConfirmCommand =
  | 'market.confirmBuy'
  | 'market.confirmSell'
  | 'repair.confirm'
  | 'resupply.confirm'
  | 'insurance.confirm';

export interface TransactionPreview {
  readonly preview: TransactionPreviewData | null;
  readonly loading: boolean;
  readonly error: EngineError | null;
  /** True when the last confirmation was refused because the state moved. */
  readonly replaced: boolean;
  /** Confirms the shown preview. Resolves true when the engine committed. */
  confirm(): Promise<boolean>;
  reload(): void;
}

export interface TransactionPreviewOptions<TType extends PreviewRequest> {
  readonly gateway: ClientGateway;
  readonly station: StationData;
  readonly type: TType;
  readonly confirmType: ConfirmCommand;
  /** Null suspends the preview, for a dialog that is not open. */
  readonly payload: RequestPayload<TType> | null;
}

export function useTransactionPreview<TType extends PreviewRequest>(
  options: TransactionPreviewOptions<TType>,
): TransactionPreview {
  const { gateway, station, type, confirmType, payload } = options;
  const [preview, setPreview] = useState<TransactionPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<EngineError | null>(null);
  const [replaced, setReplaced] = useState(false);
  const [reloads, setReloads] = useState(0);
  const mounted = useRef(true);

  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  // The payload is rebuilt on every render, so the request is keyed by its
  // value rather than its identity: an unchanged payload must not re-request,
  // because a fresh token would be bound to state the player has not seen.
  const key = payload === null ? null : JSON.stringify(payload);
  const assetsRevision = station.assets?.revision ?? 0;
  const latestPayload = useRef(payload);
  latestPayload.current = payload;

  useEffect(() => {
    const current = latestPayload.current;
    if (current === null) {
      setPreview(null);
      setError(null);
      setReplaced(false);
      return undefined;
    }
    let active = true;
    setLoading(true);
    void gateway
      .request(type, current)
      .then((response) => {
        if (!active) {
          return;
        }
        setLoading(false);
        if (response.ok) {
          setPreview(response.data);
          setError(null);
        } else {
          setPreview(null);
          setError(response.error);
        }
      })
      .catch(() => {
        if (active) {
          setLoading(false);
          setPreview(null);
        }
      });
    return () => {
      active = false;
    };
  }, [gateway, type, key, reloads, assetsRevision]);

  const confirm = useCallback(async (): Promise<boolean> => {
    const token = preview?.token ?? null;
    if (token === null) {
      return false;
    }
    setError(null);
    const answer = await station.send(confirmType, { token });
    if (!mounted.current) {
      return answer.ok;
    }
    if (answer.ok) {
      setReplaced(false);
      return true;
    }
    // A stale preview carries its replacement, which is shown instead of the
    // figures that expired and must be confirmed again.
    if (answer.error?.code === 'STALE_PREVIEW' && answer.error.replacementPreview !== undefined) {
      setPreview(answer.error.replacementPreview);
      setReplaced(true);
    } else {
      setReplaced(false);
    }
    return false;
  }, [preview, station, confirmType]);

  const reload = useCallback(() => {
    setReloads((count) => count + 1);
  }, []);

  return { preview, loading, error, replaced, confirm, reload };
}
