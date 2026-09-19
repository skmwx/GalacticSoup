import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { GLOBAL_STYLES_HREF } from '@ui';

import { AppRoot } from './AppRoot';
import { connectEngine } from './engineConnection';

/**
 * Browser entry point (Technical Specification 3.1, 4.2).
 */
void GLOBAL_STYLES_HREF;

const container = document.getElementById('root');
if (container === null) {
  throw new Error('The application root element is missing from the document.');
}

createRoot(container).render(
  <StrictMode>
    <AppRoot connection={connectEngine()} />
  </StrictMode>,
);
