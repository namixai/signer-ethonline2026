// The collector must survive a multi-byte character split across chunk boundaries.
// Importing this module must not spawn anything — that is asserted implicitly by the
// test suite completing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCollector } from '../scripts/record-cast.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const feed = (chunks) => {
  const out = [];
  const c = createCollector((t) => out.push(t));
  for (const ch of chunks) c.write(ch);
  c.end();
  return out.join('');
};

test('🔴 a Cyrillic word split mid-character survives — chunk.toString() would mangle it', () => {
  const word = 'энклав отказал';
  const b = Buffer.from(word, 'utf8');
  for (let cut = 1; cut < b.length; cut++) {
    assert.equal(feed([b.subarray(0, cut), b.subarray(cut)]), word, `разрез на байте ${cut}`);
  }
  // And the defect it guards against is real, not hypothetical:
  const cut = 5;
  assert.notEqual(b.subarray(0, cut).toString() + b.subarray(cut).toString(), word);
});

test('three-byte box-drawing characters survive every split', () => {
  const line = '─'.repeat(12); // 3 bytes each — the walkthrough is full of these
  const b = Buffer.from(line, 'utf8');
  for (let cut = 1; cut < b.length; cut++) {
    assert.equal(feed([b.subarray(0, cut), b.subarray(cut)]), line, `разрез на байте ${cut}`);
  }
});

test('an incomplete trailing sequence is flushed on end, not dropped', () => {
  const b = Buffer.from('да', 'utf8');
  const out = [];
  const c = createCollector((t) => out.push(t));
  c.write(b.subarray(0, b.length - 1)); // last character left half-written
  const beforeEnd = out.join('');
  c.end();
  assert.ok(beforeEnd.length < 'да'.length, 'the half character must be held back, not emitted broken');
  assert.ok(out.join('').length > beforeEnd.length, 'and released on end');
});

test('empty writes produce no events', () => {
  const out = [];
  const c = createCollector((t) => out.push(t));
  c.write(Buffer.alloc(0));
  c.end();
  assert.equal(out.length, 0);
});

test('🔴 the committed cast still describes the CURRENT walkthrough', () => {
  // The checked-in recording had drifted to the old seven-step WETH walkthrough while the
  // code had moved to eight steps with ONDO, the snapshot and the gate. A judge pressing
  // play saw something the code no longer does, and nothing said so.
  //
  // This does not re-run the demo (that costs three minutes); it asserts the markers that
  // must appear, so a walkthrough change without a re-record goes red here.
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'demo.cast'), 'utf8');
  const lines = src.trim().split('\n');
  const text = lines.slice(1).map((l) => JSON.parse(l)[2]).join('');

  const frames = (text.match(/─{72}/g) || []).length / 2;
  assert.equal(frames, 8, `в записи ${frames} кадров, в проходе 8 — перезапиши: npm run demo:cast`);

  for (const marker of ['ONDO', 'снимок собран', 'НЕ ПОЛУЧАЕТ ПОДПИСЬ', 'Граница']) {
    assert.ok(text.includes(marker), `запись не содержит «${marker}» — она отстала от кода`);
  }
  assert.ok(!text.includes('WETH'), 'запись всё ещё показывает прежний символ');
  assert.ok(!text.includes('�'), 'в записи символы замены — разрез многобайтового символа');

  const duration = JSON.parse(lines[lines.length - 1])[0];
  assert.ok(duration > 120 && duration < 240, `длительность ${duration.toFixed(0)} с вне окна 2–4 мин`);
});
