# Privacy practices data disclosure

For the Chrome Web Store developer dashboard, "Privacy practices" tab.

## The core fact

Slop Alarm has no server and no account. The developer of Slop Alarm collects nothing: no text, no URLs, no analytics, no identifiers. There is nothing on our side to collect it with. When a user runs a check, the text they chose and their own API key are sent directly from their browser to the AI provider they configured (TypeSafe or OpenRouter), under that user's own account. That transfer is between the user and the provider they picked; it does not pass through us or get logged by us.

## Data collection

| Data type | Collected | Notes |
| --- | --- | --- |
| Personally identifiable information | No | We hold no accounts and no user records. |
| Health information | No | |
| Financial and payment information | No | We charge nothing and see no payment details. Any charges are between the user and their chosen provider. |
| Authentication information | Yes, stored locally only | The user's own API key for TypeSafe or OpenRouter is stored in `chrome.storage.local` on the user's device and sent only as the authorization header on requests to that provider. It is never sent to us, because there is no "us" in the request path. |
| Personal communications | No | |
| Location | No | |
| Web history | No | The extension never sends page URLs, page titles, or a record of sites visited, to us or to the provider. |
| User activity | No | We do not track clicks, scrolling, or other on-page behavior. |
| Website content | Yes, transferred to the user's chosen third-party provider, not to us | The text of a page or selection the user chooses to check, or, with auto-scan opted in, sampled article text from eligible pages, is transmitted to the AI provider the user selected and authenticated with their own key. This is the core input to the extension's single purpose. It is user-initiated (or opt-in, for auto-scan), necessary to produce the result the user asked for, and goes to a processor the user themselves picked and is billed by. Recommendation for the "Website content" checkbox: tick it, and use the note above to explain that the transfer is to the user-selected processor under the user's own account, not to us, and is necessary for the single purpose. |

## Certifications

- We do not sell or transfer user data to third parties. We are not in the data path at all: the only transfer is from the user's browser to the AI provider the user selected and authenticated with their own key, which is necessary to provide the extension's single purpose.
- We do not use or transfer user data for purposes unrelated to the extension's single purpose of estimating whether text was AI-written.
- We do not use or transfer user data to determine creditworthiness or for lending purposes.
