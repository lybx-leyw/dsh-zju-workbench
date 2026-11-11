import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

/**
 * `dsh-pages` 两个内建页的名字必须覆盖成 8 种语言。
 *
 * # 为什么在 profile 的 config 里覆盖，而不是改上游包
 *
 * `dsh-pages` 是锁版本的上游依赖（`node_modules` 里的发布包）。改它的源码
 * 会在下次 `npm install` 时消失，也不该被本仓修改。
 *
 * 它自己留了口子：`registerPage()` 接受 `LocalizedText`，而 `apply(ctx, config)`
 * 的 config 里有 `homeLabel` / `managerLabel` 两个字段。默认值只有 `{ en, zh }`
 * —— 切到日/德/俄时会回退成英文（`resolveText` 的回退链终止于 `en`）。
 *
 * 所以正解是：**在 profile 的 patch 里给这两个字段传八种语言**。
 *
 * # 这条测试守什么
 *
 * 守的是「别再退回两种语言」。上游若升版改了字段名，这条会红 —— 那正是
 * 该有人去看一眼的时候。
 */

const root = fileURLToPath(new URL('../..', import.meta.url));
const LOCK = JSON.parse(readFileSync(path.join(root, 'runtime.lock.json'), 'utf8'));
const PATCH = path.join(root, 'profiles', LOCK.profile, 'cordis.patch.yml');
const LANGS = ['zh', 'en', 'ja', 'es', 'fr', 'de', 'ru', 'pt'];

test('dsh-pages 的 homeLabel / managerLabel 覆盖成 8 种语言', () => {
  const doc = yaml.load(readFileSync(PATCH, 'utf8'));
  const entry = doc.find(item => item?.id === 'dsh-pages');
  assert.ok(entry !== undefined, 'profile patch 里找不到 dsh-pages 配置项');

  for (const field of ['homeLabel', 'managerLabel']) {
    const value = entry.config?.[field];
    assert.ok(value !== undefined, `${field} 没有配置 —— 会退回上游的 { en, zh }，其它语言显示英文`);
    assert.equal(typeof value, 'object', `${field} 必须是 LocalizedText 对象（纯字符串就不跟随语言了）`);
    for (const lang of LANGS) {
      assert.equal(typeof value[lang], 'string', `${field} 缺 ${lang}`);
      assert.ok(value[lang].length > 0, `${field}.${lang} 是空的`);
    }
  }
});

test('dsh-pages 的其它 config 字段保持原样', () => {
  // 这两个 label 是新增项，不该顺手改掉既有行为。
  const doc = yaml.load(readFileSync(PATCH, 'utf8'));
  const cfg = doc.find(item => item?.id === 'dsh-pages')?.config ?? {};
  assert.equal(cfg.homePage, 'home');
  assert.equal(cfg.managerPage, 'pages');
  assert.equal(cfg.pageSlot, 'page.content');
  assert.equal(cfg.classPrefix, 'zy-workbench');
  assert.equal(cfg.defaultRailWidth, 51);
});
