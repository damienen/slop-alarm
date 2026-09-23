/**
 * Accessibility behaviour of the on-page card: every control must be keyboard reachable with
 * visible focus, and the card must have role="dialog" and an aria-live verdict. Reaches into the
 * instance's closed shadow root via the private field the class keeps a direct reference to
 * (bypassing the "closed" *external* discovery restriction, which is exactly what a real screen
 * reader / the browser's own focus model does from inside the page too).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SlopAlarmUI } from '../src/content/ui.js';
import type { UICallbacks } from '../src/content/ui.js';
import type { TabResult } from '../src/background/state.js';

function resultState(): TabResult {
  return {
    status: 'result',
    mode: 'page',
    fetchedAt: Date.now(),
    detect: {
      result: {
        probability: 0.82,
        verdict: 'likely_ai',
        confidence: 'medium',
        mixed: false,
        words: 300,
        chunks: [],
        tells: [],
      },
      failedChunks: 0,
    },
  };
}

function keyErrorState(): TabResult {
  return { status: 'key_error', mode: 'page', fetchedAt: Date.now(), errorCode: 'invalid_key', errorMessage: 'The provider rejected your API key. Check it in settings.' };
}

function makeUI(): { ui: SlopAlarmUI; shadow: ShadowRoot; callbacks: UICallbacks; closed: boolean[]; opened: string[] } {
  const closed: boolean[] = [];
  const opened: string[] = [];
  const callbacks: UICallbacks = {
    onToggleHighlight: () => undefined,
    onExcludeSite: () => undefined,
    onClose: () => closed.push(true),
    onOpenSettings: () => opened.push('settings'),
    onRetry: () => opened.push('retry'),
  };
  const ui = new SlopAlarmUI(callbacks, false);
  // The class keeps its ShadowRoot reference in a private field; this is the same object
  // `attachShadow` returned, so reading it is legitimate even though the mode is "closed".
  const shadow = (ui as unknown as { shadow: ShadowRoot }).shadow;
  return { ui, shadow, callbacks, closed, opened };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('on-page card accessibility', () => {
  it('the verdict heading is aria-live="polite" for a result', () => {
    const { ui, shadow } = makeUI();
    ui.renderState(resultState(), { auto: false, showPillAlways: false });
    const heading = shadow.querySelector('.card h2');
    expect(heading?.getAttribute('aria-live')).toBe('polite');
  });

  it('the heading is also aria-live="polite" for a non-result message (e.g. a key error)', () => {
    const { ui, shadow } = makeUI();
    ui.renderState(keyErrorState(), { auto: false, showPillAlways: false });
    const heading = shadow.querySelector('.card h2');
    expect(heading?.getAttribute('aria-live')).toBe('polite');
  });

  it('a key error shows an "Open settings" action that calls onOpenSettings', () => {
    const { ui, shadow, opened } = makeUI();
    ui.renderState(keyErrorState(), { auto: false, showPillAlways: false });
    const btn = shadow.querySelector<HTMLButtonElement>('#slop-action');
    expect(btn?.textContent).toBe('Open settings');
    btn?.click();
    expect(opened).toEqual(['settings']);
  });

  it('opening the card from a keyboard action (expandCard) moves focus into it', () => {
    const { ui, shadow } = makeUI();
    ui.renderState(resultState(), { auto: false, showPillAlways: false });
    ui.expandCard();
    const closeBtn = shadow.querySelector('.card .close');
    expect(shadow.activeElement).toBe(closeBtn);
  });

  it('Escape closes an open card', () => {
    const { ui, shadow } = makeUI();
    ui.renderState(resultState(), { auto: false, showPillAlways: false });
    ui.expandCard();
    const card = shadow.querySelector('.card') as HTMLElement;
    expect(card.hidden).toBe(false);

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true });
    (shadow.activeElement as HTMLElement)?.dispatchEvent(event);

    expect(card.hidden).toBe(true);
  });

  it('closing the card (Escape or the close button) returns focus to the pill', () => {
    const { ui, shadow, closed } = makeUI();
    ui.renderState(resultState(), { auto: false, showPillAlways: false });
    ui.expandCard();

    const closeBtn = shadow.querySelector('.card .close') as HTMLButtonElement;
    closeBtn.click();

    const pill = shadow.querySelector('.pill');
    expect(shadow.activeElement).toBe(pill);
    expect(closed).toEqual([true]);
  });

  it('the card has role="dialog"', () => {
    const { shadow } = makeUI();
    const card = shadow.querySelector('.card');
    expect(card?.getAttribute('role')).toBe('dialog');
  });
});
