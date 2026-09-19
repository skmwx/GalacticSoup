/**
 * Localization primitives (Technical Specification 12.5).
 *
 * All player-visible text is addressed by a stable key and rendered with named
 * parameters. Rules, content and protocol payloads carry keys and parameters,
 * never rendered English.
 */

/** A stable, namespaced message key such as `shell.engine.ready`. */
export type MessageKey = string;

/** Values that may be substituted into a message template. */
export type MessageParamValue = string | number | boolean;

/** Named parameters for a message template. */
export type MessageParams = Readonly<Record<string, MessageParamValue>>;

/** A single locale's key -> template map. */
export type MessageCatalog = Readonly<Record<MessageKey, string>>;

/** Everything that can go wrong while resolving a message. */
export type LocalizationIssue =
  | { readonly kind: 'missing-key'; readonly locale: string; readonly key: MessageKey }
  | {
      readonly kind: 'missing-parameter';
      readonly locale: string;
      readonly key: MessageKey;
      readonly parameter: string;
    }
  | {
      readonly kind: 'unused-parameter';
      readonly locale: string;
      readonly key: MessageKey;
      readonly parameter: string;
    };

/** Receives issues so development and tests can fail loudly on bad text. */
export type LocalizationIssueHandler = (issue: LocalizationIssue) => void;
