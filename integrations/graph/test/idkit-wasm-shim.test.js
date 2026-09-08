// Что шим ОТКАЗЫВАЕТСЯ делать, и что он убирает за собой.
//
// Первая версия подменяла fetch по схеме — «любой file:» — и оставалась установленной
// навсегда. Замер до правки: fetch("file:///etc/hosts") вернул 200 и содержимое файла,
// а подмена продолжала стоять после импорта, ради которого её ставили. Оба теста ниже
// покраснеют, если вернуть любую из этих двух половин.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { installIdkitWasmShim } from '../src/idkit-wasm-shim.js';

test('the shim serves the one wasm it was installed for', async () => {
  const target = { fetch: async () => { throw new Error('should not reach the real fetch'); } };
  const { allowed, restore } = installIdkitWasmShim({ target });
  assert.ok(existsSync(new URL(allowed)), `wasm не найден по ${allowed}`);
  const res = await target.fetch(allowed);
  const buf = new Uint8Array(await res.arrayBuffer());
  // 0x00 61 73 6d — сигнатура wasm. Проверяем, что отдали именно модуль, а не «что-то».
  assert.deepEqual([...buf.slice(0, 4)], [0x00, 0x61, 0x73, 0x6d]);
  restore();
});

test('every other file: URL is refused, not served', async () => {
  const target = { fetch: async () => { throw new Error('should not reach the real fetch'); } };
  const { allowed, restore } = installIdkitWasmShim({ target });
  const outside = [
    'file:///etc/hosts',
    'file:///etc/passwd',
    // Тот же каталог, другой файл: схема и путь почти совпадают, и это ровно тот случай,
    // на котором совпадение по префиксу вместо точного равенства прошло бы.
    new URL('./package.json', new URL(allowed)).href,
    // Обход через `..`: URL нормализуется до другого файла, и сравнение уже после этого.
    new URL('../dist/../dist/../../../etc/hosts', new URL(allowed)).href,
  ];
  for (const url of outside) {
    await assert.rejects(() => target.fetch(url), /refusing file: fetch/, `обслужен: ${url}`);
  }
  restore();
});

test('http(s) requests are passed through untouched', async () => {
  let seen = null;
  const target = { fetch: async (u) => { seen = u; return new Response('ok'); } };
  const { restore } = installIdkitWasmShim({ target });
  await target.fetch('https://example.invalid/x');
  assert.equal(seen, 'https://example.invalid/x');
  restore();
});

test('restore puts the original fetch back', async () => {
  const original = async () => new Response('original');
  const target = { fetch: original };
  const { restore } = installIdkitWasmShim({ target });
  assert.notEqual(target.fetch, original, 'шим не встал — остальные проверки ничего не значат');
  restore();
  assert.equal(target.fetch, original, 'шим пережил restore и остался висеть в процессе');
});
