import type { JSX } from 'react';

import type { NotificationSeverityName } from '@protocol';

/**
 * A distinct shape per notification level, drawn beside its word, so urgency
 * never depends on colour alone (Functional Specification 19.7, 20;
 * Technical Specification 12.2).
 */
const PATHS: Readonly<Record<NotificationSeverityName, string>> = {
  // A warning triangle holding an exclamation mark.
  danger: 'M12 3L2 20h20zM12 9v5M12 17v.5',
  // A diamond holding an exclamation mark.
  warning: 'M12 3l9 9-9 9-9-9zM12 8v5M12 16v.5',
  // A five-pointed star.
  opportunity: 'M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.6 6.6 19.5l1.2-6-4.5-4.2 6.1-.7z',
  // A circle holding the letter i.
  informational: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.5',
};

export function SeverityIcon({
  severity,
  className,
}: {
  readonly severity: NotificationSeverityName;
  readonly className?: string | undefined;
}): JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-severity-icon={severity}
    >
      <path d={PATHS[severity]} />
    </svg>
  );
}
