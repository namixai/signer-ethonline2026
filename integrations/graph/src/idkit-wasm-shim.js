// A `file:` fetch that serves exactly one file, and puts itself away afterwards.
//
// IDKit ships its WASM next to itself and loads it with
// `fetch(new URL("idkit_wasm_bg.wasm", import.meta.url))`. In a browser that is an HTTP
// URL; under Node it is `file:`, and Node's fetch answers "not implemented... yet..."
// with the file sitting right there on disk. So the import needs a shim.
//
// 🔴 THE FIRST VERSION OF THIS SHIM SERVED ANY `file:` URL AND NEVER UNINSTALLED ITSELF.
// Measured: `fetch("file:///etc/hosts")` returned 200 and the file's contents, and the
// override was still in place after the import that needed it had finished. Nothing in
// this repository asked for that, which is the point — a shim that outlives its reason is
// a capability sitting in the process for whatever runs next, and one that matches by
// scheme rather than by name is a file-read primitive wearing a network interface.
//
// So: an allow-list of exactly one resolved path, not a deny-list of bad ones, and a
// `restore` the caller is expected to call. Fails closed — if the wasm is not where we
// resolved it, the shim refuses and IDKit reports a plain load failure rather than
// silently reading something else.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

/**
 * Install a `file:` shim that serves ONLY IDKit's wasm.
 *
 * @param {object}   [opts]
 * @param {string}   [opts.wasmUrl]  href of the one file to serve; defaults to IDKit's.
 * @param {object}   [opts.target]   object carrying `fetch`; defaults to globalThis.
 * @returns {{ restore: () => void, allowed: string }}
 */
export function installIdkitWasmShim({ wasmUrl, target = globalThis } = {}) {
  const allowed = wasmUrl ?? new URL(
    '../node_modules/@worldcoin/idkit-core/dist/idkit_wasm_bg.wasm',
    import.meta.url,
  ).href;

  const previous = target.fetch;
  target.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input?.url ?? String(input);
    if (url.startsWith('file:')) {
      // Compared after URL normalisation, so `..` and percent-escapes in a crafted URL
      // cannot walk out of the allowed path and back to a different file.
      if (new URL(url).href !== allowed) {
        throw new Error(`refusing file: fetch outside the IDKit wasm — ${url}`);
      }
      if (!existsSync(new URL(allowed))) {
        throw new Error(`IDKit wasm not found at ${allowed}`);
      }
      return new Response(await readFile(new URL(allowed)));
    }
    return previous(input, init);
  };

  return { allowed, restore: () => { target.fetch = previous; } };
}
