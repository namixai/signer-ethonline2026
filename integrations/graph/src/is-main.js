// Was this module run directly, or imported?
//
// 🔴 THE OBVIOUS FORM IS WRONG: `import.meta.url === `file://${process.argv[1]}``.
// `import.meta.url` is a percent-encoded URL, while argv[1] is a raw path, so the two
// disagree the moment the path contains a space, `%`, `#`, `?` or anything non-ASCII:
//
//     /tmp/My Projects/x.js  →  file:///tmp/My%20Projects/x.js
//
// The comparison then quietly returns false and the entry point does NOTHING — no output,
// no error, exit 0. For the drift watchers that is the worst possible shape: `npm run
// drift` would report success while never having checked anything, which is precisely the
// "a blind watchdog looks alive" failure those files exist to prevent.
//
// It works today only because our checkout path happens to be plain ASCII.

import { pathToFileURL } from 'node:url';

export function isMain(importMetaUrl, argv1 = process.argv[1]) {
  if (typeof importMetaUrl !== 'string' || !argv1) return false;
  try {
    return importMetaUrl === pathToFileURL(argv1).href;
  } catch {
    // A path we cannot turn into a URL is not a match — and must not throw at import time.
    return false;
  }
}
