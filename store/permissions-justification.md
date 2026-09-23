# Permissions justification

For the Chrome Web Store developer dashboard, "Permissions justification" fields.

## Single purpose

Slop Alarm's single purpose is to estimate whether text on a web page or a selected passage was written by AI, and to show the user the specific writing habits behind that estimate. There is no Slop Alarm server. Every permission below exists to support that one purpose: reading the text the user asks about, sending it directly from the browser to the AI provider the user configured with their own API key, and showing the result on the page or in the popup.

## storage

Slop Alarm uses `chrome.storage.local` to keep the user's settings (auto-scan on or off, highlighting preference), the user's own API key for TypeSafe or OpenRouter, the list of sites the user has excluded from auto-scan, a cache of scores keyed by a hash of the checked text, and the daily auto-scan usage counter. Everything here lives only on the user's device. Without this permission the extension could not remember a pasted key or an exclusion list between sessions, and would have to re-check the same text every time to show a result.

## activeTab

Used when the user explicitly asks for a check, by clicking the toolbar button or pressing the keyboard shortcut. `activeTab` lets the extension inject the content script into the current tab at that moment only, extract the visible article text, and send it for scoring. It does not give the extension standing access to every tab, only the one the user acted on.

## scripting

Used together with `activeTab` to inject the content script (`chrome.scripting.executeScript`) that extracts page text for an on-demand check, and, once the user opts into auto-scan, to register the content script for eligible pages going forward (`chrome.scripting.registerContentScripts`). Without it the extension cannot read the text the user wants checked.

## contextMenus

Adds the "Check selection for AI writing" item to the right-click menu, so a user can check a specific passage without checking the whole page. This is one of the three ways to run a check described in the listing.

## Host permissions: api.typesafe.ai and openrouter.ai

Slop Alarm needs to call the AI provider the user picked, directly from the service worker, using the user's own API key. These two origins, `https://api.typesafe.ai/*` and `https://openrouter.ai/*`, are declared as required host permissions so the extension can send a check to whichever provider the user configured, without prompting separately for each one. No other host is contacted by the extension itself; there is no Slop Alarm backend to call.

## Optional host permission: `<all_urls>`

This is requested only when the user explicitly turns on auto-scan in settings, using `chrome.permissions.request`. It is not requested at install time and is not required to use on-demand or selection checks. It is needed because auto-scan has to run its eligibility check and text extraction on whatever page the user is currently browsing, which could be any site. If the user later turns auto-scan off, the extension stops using the grant; the user can also revoke it from Chrome's own extension permissions UI at any time.

## Remote code

None. All JavaScript that runs (service worker, content script, popup, options page) is bundled at build time and shipped inside the extension package. The extension calls the provider's API only to exchange data (JSON requests and responses), never to fetch or `eval` code.
