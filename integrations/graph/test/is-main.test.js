import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { isMain } from '../src/is-main.js';

test('🔴 paths that percent-encode still match — the naive form fails here', () => {
  for (const p of ['/tmp/ok/x.js', '/tmp/My Projects/x.js', '/tmp/100%/x.js', '/tmp/a#b/x.js', '/tmp/энклав/x.js']) {
    const url = pathToFileURL(p).href;
    assert.equal(isMain(url, p), true, p);
    // And the form this replaced would have got these wrong:
    if (p !== '/tmp/ok/x.js') assert.notEqual(url, `file://${p}`, `наивный вид совпал на ${p}`);
  }
});

test('a different file is not main', () => {
  assert.equal(isMain(pathToFileURL('/tmp/a.js').href, '/tmp/b.js'), false);
});

test('missing or malformed input answers false instead of throwing', () => {
  for (const [u, a] of [[undefined, '/tmp/a.js'], [null, '/tmp/a.js'], ['file:///tmp/a.js', undefined], ['file:///tmp/a.js', ''], [42, '/tmp/a.js']]) {
    assert.equal(isMain(u, a), false, `${String(u)} / ${String(a)}`);
  }
});
