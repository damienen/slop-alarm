/**
 * Auto-scan runs only with the optional `<all_urls>` host permission, requested from a user
 * gesture in the popup/options/onboarding page (never from the background). This module keeps the
 * dynamic content-script registration ("slop-alarm-auto") in sync with that permission and with
 * `settings.autoScan`, and is re-synced on startup and onInstalled.
 */
import { getSettings } from './state.js';

const AUTO_SCRIPT_ID = 'slop-alarm-auto';
const ALL_URLS = '<all_urls>';

export async function hasAutoScanPermission(): Promise<boolean> {
  return chrome.permissions.contains({ origins: [ALL_URLS] });
}

export async function removeAutoScanPermission(): Promise<void> {
  try {
    await chrome.permissions.remove({ origins: [ALL_URLS] });
  } catch {
    // ignore
  }
}

async function isRegistered(): Promise<boolean> {
  const scripts = await chrome.scripting.getRegisteredContentScripts({ ids: [AUTO_SCRIPT_ID] });
  return scripts.length > 0;
}

export async function registerAutoScanScript(): Promise<void> {
  if (await isRegistered()) return;
  await chrome.scripting.registerContentScripts([
    {
      id: AUTO_SCRIPT_ID,
      js: ['content.js'],
      matches: ['http://*/*', 'https://*/*'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    },
  ]);
}

export async function unregisterAutoScanScript(): Promise<void> {
  if (!(await isRegistered())) return;
  await chrome.scripting.unregisterContentScripts({ ids: [AUTO_SCRIPT_ID] });
}

/** Keeps the dynamic content-script registration in sync with settings and the granted permission. */
export async function syncAutoScan(): Promise<void> {
  const settings = await getSettings();
  const granted = await hasAutoScanPermission();
  if (settings.autoScan && granted) {
    await registerAutoScanScript();
  } else {
    await unregisterAutoScanScript();
  }
}
