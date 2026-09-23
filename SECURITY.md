# Security policy

## Reporting a vulnerability

Please report security issues through GitHub's private vulnerability reporting, not a public
issue:

https://github.com/damienen/slop-alarm/security/advisories/new

This lets us look into a report before it is visible to anyone else.

## Scope

This covers the Slop Alarm Chrome extension (`apps/extension`), the shared core package
(`packages/core`), and the static site (`apps/site/public`).

## What this project guarantees

- There is no server. Slop Alarm never runs any backend of its own.
- Your API key is stored only in `chrome.storage.local`, on your own device.
- The key is never sent to content scripts or to any page you visit. It is only ever attached as
  the `Authorization` header on a request to the provider you chose (TypeSafe or OpenRouter).
- The page's URL and title are never sent anywhere.

If you find a way any of these guarantees does not hold, that is exactly the kind of thing to
report privately using the link above.
