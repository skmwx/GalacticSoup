import type { DisplayPreferences } from './preferences';

/**
 * Applies the display preferences to the document (Functional Specification
 * 20; Technical Specification 12.2, 12.3).
 *
 * Interface scale and text scale are the two independent CSS variables every
 * stylesheet sizes itself by. Contrast and motion are attributes on the root
 * element that the tokens read: `data-contrast="high"` or `"standard"` and
 * `data-motion="reduced"` or `"full"` override the browser's own
 * `prefers-contrast` and `prefers-reduced-motion`, and an absent attribute
 * follows them. A value at its default is removed rather than written, so the
 * stylesheet's own default stays in charge.
 *
 * @implements FUNC-20, TECH-12.2, TECH-12.3
 */
export function applyDisplayPreferences(root: HTMLElement, display: DisplayPreferences): void {
  setScale(root, '--gs-ui-scale', display.uiScale);
  setScale(root, '--gs-text-scale', display.textScale);
  setMode(root, 'data-contrast', display.contrast);
  setMode(root, 'data-motion', display.motion);
}

function setScale(root: HTMLElement, variable: string, value: number): void {
  if (value === 1) {
    root.style.removeProperty(variable);
  } else {
    root.style.setProperty(variable, String(value));
  }
}

function setMode(root: HTMLElement, attribute: string, value: string): void {
  if (value === 'system') {
    root.removeAttribute(attribute);
  } else {
    root.setAttribute(attribute, value);
  }
}
