# Slop Alarm - Chrome Web Store listing

## Extension name (max 75 chars)

Slop Alarm - AI Writing Detector

(32 characters)

## Short description (max 132 chars)

Free AI writing check. Bring your own TypeSafe or OpenRouter key. No account, no server, no subscription. (105 characters)

## Category

Productivity

## Language

English (United States)

## Detailed description

**Requires your own API key.** Slop Alarm has no server and no account. To check text you need a free API key from TypeSafe (console.typesafe.ai/keys) or OpenRouter (openrouter.ai/keys). The extension sends text directly from your browser to that provider, and the provider bills your own account for the model calls it makes, typically a fraction of a cent per check.

Slop Alarm reads a page or a selection you choose and tells you whether it was likely written by AI. You get a verdict, a confidence level, and the specific writing habits behind the call.

**Three ways to check**
- Click the toolbar button to check the page you're on, or press Alt+Shift+S.
- Select any passage and use "Check selection for AI writing" from the right-click menu.
- Turn on auto-scan (opt-in) and Slop Alarm quietly checks pages as you browse, only showing a pill when it thinks something is likely AI-written. It stays quiet on pages that read as human, skips pages with password or card fields, webmail, online documents, banking-style hosts, and local addresses, honors your exclusion list, and has a daily limit (100 by default) so it cannot run up a bill.

**What it looks for**

Slop Alarm groups its findings into five habits: staged emphasis ("it's not X, it's Y" contrasts and dramatic closers), rhythm by rule (ideas forced into threes, dash-heavy clauses), inflated language (stock words like "delve", unnamed experts), decorative formatting (bold-every-bullet, emoji section markers), and chatbot leftovers (phrases like "I hope this helps"). This taxonomy follows Wikipedia's guide to signs of AI writing and the open-source humanizer project.

**How it works**

The text you choose to check, and your API key as the request's authorization header, go directly from your browser to the provider you picked, TypeSafe or OpenRouter, which runs the Jev decision model and returns a verdict, a confidence level, and the tells it found. We never send the page URL, the page title, or your browsing history, and the developer of Slop Alarm never receives your text at all. Read the full privacy policy at the link in the extension settings.

**Accuracy, honestly**

This is an estimate, not proof, and it can be wrong in both directions. On the developer's test set (44 human texts, 48 AI texts), no human text was flagged as likely AI, and about six in ten AI texts were flagged, with the rest mostly reading "unclear". That test set is small, so the real false-positive rate could be several percent, and all its AI texts came from one model family. Short text, edited AI text, AI text written to sound casual, and formal or non-native English writing are hard cases. It is tuned and tested on English. When the signals disagree, Slop Alarm says "unclear" instead of forcing a call. Never use a result as the sole basis to accuse someone of using AI.

**Cost**

Slop Alarm charges nothing. Your provider bills your own account directly, at roughly $0.00008 per 250 words, so about a hundred page checks cost around one cent.

## Screenshot concepts (1280x800)

1. **Key setup screen.** The extension's settings page with the API key field, a link to console.typesafe.ai/keys and openrouter.ai/keys, and the "Test key" button.
   Caption: "Paste in your own TypeSafe or OpenRouter key. Nothing to sign up for with us."

2. **On-page pill and expanded card on a news article.** Shows the closed-pill state bottom-right and, in a callout, the expanded card with verdict "Likely AI", 82%, and two tells listed.
   Caption: "A quiet pill appears only when something looks off. Click it for the full breakdown."

3. **Popup with the check button on a blog post.** Shows the extension popup mid-check, then the result.
   Caption: "Check the page you're on with one click, or press Alt+Shift+S."

4. **Right-click context menu showing "Check selection for AI writing."**
   Caption: "Select any passage and check just that text."

5. **Settings screen showing auto-scan toggle, exclusion list, and daily limit.**
   Caption: "Auto-scan is opt-in, skips sensitive pages by default, and has a daily limit so it can't run up a bill."

## Small promo tile (440x280)

Ink background (#14110F), the siren mark centered-left, wordmark "Slop Alarm" in paper (#FBF7F0) to the right, small line beneath in muted grey: "Free. Bring your own key." No screenshot content, no browser chrome, high contrast for the small size.
