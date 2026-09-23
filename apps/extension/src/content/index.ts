/**
 * Content script entry point. Bundled as an IIFE (see build.mjs) and loaded two ways: on demand
 * via chrome.scripting.executeScript, or automatically via chrome.scripting.registerContentScripts
 * when auto-scan is on. Idempotent: a page that somehow gets the script injected twice is a no-op
 * the second time. Does no work until a message arrives or auto-scan eligibility passes.
 */
import { LIMITS, SCORING, chunkBlocks, sampleChunks, truncateChars } from '@slop-alarm/core';
import type { DetectChunk } from '@slop-alarm/core';
import { extractBlocks } from './extract.js';
import type { ExtractedBlock } from './extract.js';
import { isEligibleForAutoScan } from './eligibility.js';
import { applyHighlight, clearHighlight } from './highlight.js';
import { SlopAlarmUI } from './ui.js';
import type { UICallbacks } from './ui.js';
import type { ExtractResponse, ToBackground, ToContent } from '../background/messages.js';
import type { PublicSettings, TabResult } from '../background/state.js';

interface SlopAlarmWindow {
  __slopAlarm?: boolean;
}

(function main() {
  const w = window as unknown as SlopAlarmWindow;
  if (w.__slopAlarm) return;
  w.__slopAlarm = true;

  let ui: SlopAlarmUI | undefined;
  let settings: PublicSettings = { provider: 'typesafe', autoScan: false, alwaysShowPill: false, highlight: false, excludedHosts: [], autoScanDailyLimit: 100 };
  let lastBlocks: ExtractedBlock[] = [];
  let lastChunkBlockIndexes = new Map<string, number[]>();
  let lastState: TabResult | undefined;
  const scannedUrls = new Set<string>();
  let lastHref = location.href;
  let debounceTimer: number | undefined;

  function sendToBackground<T = unknown>(msg: ToBackground): Promise<T> {
    return chrome.runtime.sendMessage(msg) as Promise<T>;
  }

  function reapplyHighlight(): void {
    clearHighlight(document);
    if (!lastState?.detect) return;
    for (const chunk of lastState.detect.result.chunks) {
      if (chunk.probability !== null && chunk.probability >= SCORING.bands.ai) {
        const idxs = lastChunkBlockIndexes.get(chunk.id) ?? [];
        const elements = idxs.map((i) => lastBlocks[i]?.element).filter((e): e is Element => !!e);
        applyHighlight(elements);
      }
    }
  }

  function ensureUI(): SlopAlarmUI {
    if (!ui) {
      const callbacks: UICallbacks = {
        onToggleHighlight: (enabled) => {
          settings = { ...settings, highlight: enabled };
          void sendToBackground({ type: 'popup/updateSettings', patch: { highlight: enabled } });
          if (enabled) reapplyHighlight();
          else clearHighlight(document);
        },
        onExcludeSite: () => {
          void sendToBackground({ type: 'content/excludeSite', host: location.hostname });
          ui?.hidePill();
          clearHighlight(document);
        },
        onClose: () => {
          clearHighlight(document);
        },
        onOpenSettings: () => {
          void sendToBackground({ type: 'content/openOptions' });
        },
        onRetry: () => {
          void sendToBackground({ type: 'content/retryCheck' });
        },
      };
      ui = new SlopAlarmUI(callbacks, settings.highlight);
    }
    return ui;
  }

  function handleExtract(): ExtractResponse {
    const blocks = extractBlocks(document);
    lastBlocks = blocks;
    const chunks = chunkBlocks(blocks.map((b) => b.text));
    lastChunkBlockIndexes = new Map(chunks.map((c) => [c.id, c.blockIndexes]));
    const sampled = sampleChunks(chunks, LIMITS.maxChunks.page);
    if (sampled.length === 0) return { ok: false, reason: 'too_short' };
    const detectChunks: DetectChunk[] = sampled.map((c) => ({ id: c.id, text: truncateChars(c.text) }));
    return { ok: true, chunks: detectChunks };
  }

  function handleShowResult(state: TabResult, isAuto: boolean): void {
    lastState = state;
    const instance = ensureUI();
    if (state.status === 'checking') {
      instance.renderChecking();
      return;
    }
    instance.renderState(state, { auto: isAuto, showPillAlways: settings.alwaysShowPill });
    if (!isAuto) instance.expandCard();
    if (settings.highlight && state.detect) reapplyHighlight();
    else clearHighlight(document);
  }

  chrome.runtime.onMessage.addListener((message: ToContent, _sender, sendResponse) => {
    switch (message.type) {
      case 'extract':
        sendResponse(handleExtract());
        return false;
      case 'showResult':
        handleShowResult(message.state, message.isAuto);
        return false;
      case 'settingsUpdated':
        settings = message.settings;
        if (!settings.highlight) clearHighlight(document);
        return false;
      default:
        return false;
    }
  });

  async function maybeAutoScan(): Promise<void> {
    if (!settings.autoScan) return;
    const href = location.href;
    if (scannedUrls.has(href)) return;

    const blocks = extractBlocks(document);
    const eligible = isEligibleForAutoScan({
      isTopFrame: window.top === window.self,
      protocol: location.protocol,
      hostname: location.hostname,
      blockTexts: blocks.map((b) => b.text),
      excludedHosts: settings.excludedHosts,
      doc: document,
    });
    if (!eligible) return;

    scannedUrls.add(href);
    lastBlocks = blocks;
    const chunks = chunkBlocks(blocks.map((b) => b.text));
    lastChunkBlockIndexes = new Map(chunks.map((c) => [c.id, c.blockIndexes]));
    const sampled = sampleChunks(chunks, LIMITS.maxChunks.auto);
    if (sampled.length === 0) return;
    const detectChunks: DetectChunk[] = sampled.map((c) => ({ id: c.id, text: truncateChars(c.text) }));
    await sendToBackground({ type: 'content/autoResult', chunks: detectChunks, url: href });
  }

  function startSpaWatch(): void {
    window.setInterval(() => {
      if (location.href === lastHref) return;
      lastHref = location.href;
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => void maybeAutoScan(), 1000);
    }, 1500);
  }

  async function init(): Promise<void> {
    try {
      settings = await sendToBackground<PublicSettings>({ type: 'content/getSettings' });
    } catch {
      // Background unreachable (e.g. the extension was just reloaded): keep defaults, stay quiet.
      return;
    }
    if (settings.autoScan) {
      void maybeAutoScan();
      startSpaWatch();
    }
  }

  void init();
})();
