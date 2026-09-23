/**
 * `jsdom` ships no types and `@types/jsdom` is not part of this workspace's dependency set.
 * A minimal ambient declaration is enough for how the test suite uses it (constructing a window
 * and reading `.document`).
 */
declare module 'jsdom' {
  export class JSDOM {
    constructor(html?: string, options?: { url?: string; [key: string]: unknown });
    window: Window & typeof globalThis;
  }
}
