// Артефакт обязан описывать запрос, на который получен ответ.
//
// `verified` без пресета и без флага legacy — исход, который нельзя воспроизвести: оба
// решают, КАКОЕ доказательство считается приемлемым, поэтому один и тот же rp_id с одним
// и тем же действием отвечает по-разному под разными их значениями. Запись без них
// сообщает результат опыта, умалчивая условия.
//
// 🔴 ЭТО РАСТЯЖКА НА ИСХОДНИК, и она здесь не от хорошей жизни. Поведенческая проверка
// требует ответа моста, то есть человека с телефоном, — офлайн его нет. Растяжка кусается
// на снятии правки и не кусается на переименовании соседней переменной; это меньше, чем
// хотелось бы, и написано прямо, чтобы следующий читатель не принял её за большее.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../scripts/world-proof.mjs', import.meta.url), 'utf8');

test('the recorded shape names the preset and the legacy flag', () => {
  const m = SRC.match(/const requestShape = \(\) => \(\{([\s\S]*?)\}\);/);
  assert.ok(m, 'requestShape не найден — артефакт собирается где-то ещё');
  for (const field of ['rp_id', 'action', 'environment', 'preset', 'allow_legacy_proofs']) {
    assert.match(m[1], new RegExp(`\\b${field}\\b`), `в артефакте нет поля ${field}`);
  }
});

test('both answers carry it, not just the happy one', () => {
  // not_verified тоже описывает ответ World и тоже должен быть воспроизводим: «отказал»
  // без условий опыта — такое же незаконченное утверждение, как «принял».
  for (const outcome of ['verified', 'not_verified']) {
    const line = SRC.split('\n').find((l) => l.includes(`outcome: '${outcome}'`));
    assert.ok(line, `исход ${outcome} исчез из скрипта`);
    assert.match(line, /\.\.\.requestShape\(\)/, `исход ${outcome} собирается мимо requestShape`);
  }
});

test('the request and the artifact read one constant, so they cannot drift apart', () => {
  // Литерал в запросе и литерал в записи — два источника одной правды, и расходятся они
  // молча: запись говорит одно, World спрашивали про другое.
  // 🔴 Эта проверка сначала искала константу ГДЕ УГОДНО в файле и была зелёной при
  // сломанной правке: она находила её в артефакте, а в запросе к IDKit оставался литерал
  // `true`. Поймано фальсификацией — мутация не применилась, потому что правка запроса
  // тоже не применилась. Поэтому теперь перебираются ВСЕ вхождения, а не любое одно.
  const uses = SRC.split('\n').filter((l) => /allow_legacy_proofs\s*:/.test(l));
  assert.ok(uses.length >= 2, `ожидались запрос и артефакт, найдено ${uses.length}`);
  for (const line of uses) {
    assert.match(line, /allow_legacy_proofs\s*:\s*ALLOW_LEGACY_PROOFS\b/,
      `флаг задан литералом, а не общей константой: ${line.trim()}`);
  }
  assert.match(SRC, /const ALLOW_LEGACY_PROOFS =/, 'общей константы нет');
});
