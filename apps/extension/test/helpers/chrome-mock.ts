/** Minimal chrome.* mock covering what background/state.ts, badge.ts and (for the whole module,
 * listener registration included) background/index.ts touch in tests. */
import { vi } from 'vitest';

export function createChromeMock() {
  const localStore = new Map<string, unknown>();
  const sessionStore = new Map<string, unknown>();

  return {
    runtime: {
      getManifest: () => ({ version: '1.2.3' }) as chrome.runtime.ManifestV3,
      sendMessage: vi.fn(async () => undefined),
      openOptionsPage: vi.fn(async () => undefined),
      getURL: (path: string) => `chrome-extension://test-id/${path}`,
      onMessage: { addListener: vi.fn() },
      onInstalled: { addListener: vi.fn() },
      onStartup: { addListener: vi.fn() },
      lastError: undefined as chrome.runtime.LastError | undefined,
    },
    storage: {
      local: {
        get: vi.fn(async (keys?: string | string[]) => {
          if (!keys) return Object.fromEntries(localStore);
          const arr = Array.isArray(keys) ? keys : [keys];
          const out: Record<string, unknown> = {};
          for (const k of arr) if (localStore.has(k)) out[k] = localStore.get(k);
          return out;
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) localStore.set(k, v);
        }),
        remove: vi.fn(async (keys: string | string[]) => {
          const arr = Array.isArray(keys) ? keys : [keys];
          for (const k of arr) localStore.delete(k);
        }),
      },
      session: {
        get: vi.fn(async (key: string) => {
          const out: Record<string, unknown> = {};
          if (sessionStore.has(key)) out[key] = sessionStore.get(key);
          return out;
        }),
        set: vi.fn(async (obj: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(obj)) sessionStore.set(k, v);
        }),
        remove: vi.fn(async (key: string) => {
          sessionStore.delete(key);
        }),
        clear: vi.fn(async () => {
          sessionStore.clear();
        }),
      },
    },
    action: {
      setBadgeText: vi.fn(async () => undefined),
      setBadgeBackgroundColor: vi.fn(async () => undefined),
    },
    permissions: {
      contains: vi.fn(async () => false),
      request: vi.fn(async () => true),
      remove: vi.fn(async () => true),
    },
    scripting: {
      executeScript: vi.fn(async () => []),
      registerContentScripts: vi.fn(async () => undefined),
      unregisterContentScripts: vi.fn(async () => undefined),
      getRegisteredContentScripts: vi.fn(async () => []),
    },
    tabs: {
      query: vi.fn(async (_query?: unknown) => [] as Array<{ id?: number; url?: string }>),
      get: vi.fn(async (_tabId?: number) => undefined as { id?: number; url?: string } | undefined),
      sendMessage: vi.fn(async (_tabId?: number, _message?: unknown) => undefined as unknown),
      create: vi.fn(async (_props?: unknown) => ({ id: 1 })),
      onRemoved: { addListener: vi.fn() },
      onUpdated: { addListener: vi.fn() },
    },
    contextMenus: {
      create: vi.fn(),
      removeAll: vi.fn((cb?: () => void) => cb?.()),
      onClicked: { addListener: vi.fn() },
    },
    commands: {
      onCommand: { addListener: vi.fn() },
    },
  };
}
