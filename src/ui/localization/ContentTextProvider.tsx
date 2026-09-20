import { useEffect, useMemo, useState, type JSX, type ReactNode } from 'react';

import type { ClientGateway } from '@gateway';
import { createLocalizer, type MessageCatalog } from '@shared';

import { catalogFor } from './catalog';
import { LocalizationContext, useLocalizationSettings } from './LocalizationProvider';

/**
 * Makes authored content text resolvable by the interface
 * (Technical Specification 6.1, 12.5).
 *
 * Projections carry message keys, and the key for an item's name, a hull's
 * description or a station's title is authored beside the content itself. The
 * interface may not read the content bundle - content is the engine's to read -
 * so it asks for the catalogue through the gateway and layers it under the
 * interface's own messages.
 *
 * Children render before the catalogue arrives. A content key resolved in that
 * window falls back to the key, exactly as a missing key does anywhere else,
 * and the surfaces that show content text appear only once a campaign is open.
 *
 * @implements TECH-12.5
 */

export interface ContentTextProviderProps {
  readonly gateway: ClientGateway;
  readonly children: ReactNode;
}

export function ContentTextProvider({
  gateway,
  children,
}: ContentTextProviderProps): JSX.Element {
  const settings = useLocalizationSettings();
  const [content, setContent] = useState<MessageCatalog | null>(null);

  useEffect(() => {
    let active = true;
    void gateway
      .request('content.messages', { locale: settings.locale })
      .then((response) => {
        if (active && response.ok) {
          setContent(response.data.messages);
        }
      })
      .catch(() => {
        // A catalogue that cannot be fetched leaves content keys unresolved,
        // which the localizer already reports. It must not blank the screen.
      });
    return () => {
      active = false;
    };
  }, [gateway, settings.locale]);

  const localizer = useMemo(() => {
    // Interface messages win, so a content pack can never redefine a control
    // label the interface owns.
    const catalog: MessageCatalog = {
      ...(content ?? {}),
      ...catalogFor(settings.locale),
    };
    return createLocalizer({
      locale: settings.locale,
      catalog,
      ...(settings.onIssue === undefined ? {} : { onIssue: settings.onIssue }),
    });
  }, [content, settings]);

  return (
    <LocalizationContext.Provider value={localizer}>{children}</LocalizationContext.Provider>
  );
}
