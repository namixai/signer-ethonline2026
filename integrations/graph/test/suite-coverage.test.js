// Guards the glob in package.json against a silent coverage gap.
//
// `node --test test/` globs the directory on Node 26 and FAILS on Node 22, where `test`
// resolves as a module path — CI caught that on its first run, which is the whole reason
// the workflow exists. The portable form is `node --test test/*.test.js`, expanded by the
// shell into explicit paths.
//
// 🔴 But that form has its own blind spot: a suite placed in a SUBDIRECTORY is simply not
// run, and nothing says so. A test file that never executes is indistinguishable from one
// that passes. So this asserts the invariant the glob depends on.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, sep } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

function findSuites(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...findSuites(p));
    else if (e.name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

test('🔴 every suite lives where the glob can reach it', () => {
  const nested = findSuites(here)
    .map((p) => relative(here, p))
    // `sep`, а не '/': relative() возвращает '\\' на Windows, и обе проверки тогда
    // классифицируют вложенные наборы неверно — сторож проходит, а шаблон их не берёт.
    .filter((p) => p.includes(sep));

  assert.deepEqual(
    nested,
    [],
    `эти наборы лежат в подкаталогах и НЕ ЗАПУСКАЮТСЯ шаблоном test/*.test.js: ${nested.join(', ')}. ` +
      'Либо перенеси их наверх, либо расширь шаблон в package.json — молча они не выполняются.',
  );
});

test('the glob actually matched more than one file', () => {
  // A shell that failed to expand would pass a literal `test/*.test.js`, Node would find
  // nothing, and an empty run reports success. Cheap insurance against a zero-suite green.
  const top = findSuites(here).filter((p) => !relative(here, p).includes(sep));
  assert.ok(top.length >= 5, `наборов наверху: ${top.length}`);
});
