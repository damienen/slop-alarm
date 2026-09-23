# Notes for the Chrome Web Store reviewer

Thank you for reviewing Slop Alarm. This build has no server and no account: every check needs a user-supplied API key for TypeSafe or OpenRouter, sent directly from the browser to that provider.

**Owner action needed before submitting:** paste a temporary, limited-credit test key into this dashboard's reviewer notes field so the reviewer can exercise the check flow. Placeholder below; replace it with a real key scoped to a small credit limit, and revoke it after review.

Reviewer test key: `REVIEWER_TEST_KEY_PLACEHOLDER` (TypeSafe key, small credit limit, safe to revoke after review)

## 0. Set up the key

1. Install the extension and open its options page.
2. Paste the reviewer test key above into the API key field, choose TypeSafe as the provider, and click "Test key" to confirm it is accepted.

## 1. On-demand check (current page)

1. Visit any article-style page with a few paragraphs of text (a news article or blog post works well).
2. Click the Slop Alarm toolbar icon to open the popup, then click the check button. Alternatively, use the keyboard shortcut Alt+Shift+S.
3. The extension injects a content script into the current tab only (via `activeTab` and `scripting`), extracts the visible article text, and sends it, with the reviewer test key, directly to TypeSafe. A result appears in the popup and as an on-page card.

## 2. Selection check

1. On any page, select a paragraph or more of text (at least a few sentences; very short selections are reported as "not enough text" by design).
2. Right-click the selection and choose "Check selection for AI writing" from the context menu.
3. The extension sends only the selected text for scoring and shows the result.

## 3. Auto-scan (opt-in)

1. Open the extension's options page and turn on "Auto-scan".
2. Chrome will prompt for the optional `<all_urls>` host permission at this point, not before. This is intentional: the extension only requests broad host access once the user asks for the feature that needs it.
3. Browse to an eligible page (a public article page with at least a couple hundred words of body text, not webmail, online documents, banking-style hosts, or a page with a visible password or card field).
4. A small pill appears at the bottom right of the page only if the result looks likely AI-written (this is the "alarm" behavior: it stays quiet on pages that read as human-written). Click the pill to expand the full result card.
5. Turning auto-scan off in settings stops the content script from running on new pages.

## 4. Wrong-key error

1. In settings, replace the API key with an obviously invalid string (for example, a few random characters) and click "Test key", or run any check.
2. The extension reports that the provider rejected the key and points the user back to settings. No text is sent successfully, and no crash or silent failure occurs.

## Other notes

- The extension makes network requests only to `https://api.typesafe.ai/*` or `https://openrouter.ai/*`, whichever the user selected, using the user's own key. It contacts no Slop Alarm server, because none exists.
- No remote code is loaded or evaluated; all extension code ships inside the package.
- If a check is attempted with no key configured, the extension explains that a key is required and links to the settings page, rather than failing silently.
