import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * **设置分区守卫**：每个 source 包都要有自己的设置 UI，且**双语**。
 *
 * # 为什么需要它
 *
 * 拆包之后，配置项散在各处：一卡通账号在 `login`，PTA 与学习通的 Cookie 原先
 * 只能通过终端命令或环境变量输入，用户在界面上根本找不到。没有一条约束盯着
 * 「这个包有没有设置入口」，于是漏了就一直是漏的。
 *
 * # 双语的判定口径（刻意宽松但可执行）
 *
 * 不要求逐字翻译（那需要人工审措辞），只要求：
 *   - 分区标题能跟随语言（`sectionLabel()` 或 `registerText` 二者之一）；
 *   - 存在 `en` 条目 —— 空字典不算。
 *
 * 这条守卫拦的是「忘了写英文」和「新建包忘了接设置」，不是翻译质量。
 */

const root = fileURLToPath(new URL('..', import.meta.url));
const SOURCE_ROOT = path.join(root, 'packages', 'source');

/**
 * 没有设置分区的包，以及**为什么**。
 *
 * 白名单必须给理由：一个只有名字的白名单，下次有人想加包时无从判断该不该加。
 *
 * `netproxy` **不在**这里 —— 它有「网络代理」分区。虽然它的标题走内联
 * `sectionLabel` 而不是 `registerText`，但那是实现方式差异，不是「没有分区」。
 */
const NO_SETTINGS = new Map([
  ['webvpn', '纯库：只有协议与策略函数，没有任何用户可配置项，也不该有'],
  ['http', '纯库 + 出口服务：传输层与 zhiyunEgress，用户没有可配置项'],
  // 下面两个**原本有**设置分区，但里面只有一个状态读数、没有可配置项，
  // 于是撤掉了：那份状态已并入「浙大统一身份认证」分区的「这份凭据的用途」
  // 卡片 —— 三者共用同一份 CAS 凭据，状态放一起才形成「填了什么 → 换来了什么」
  // 的因果闭环。留两个只能看状态的分区，用户会看到同一件事出现两处。
  ['classroom', '状态已并入统一身份认证分区；本包无用户可配置项'],
  ['zdbk', '状态已并入统一身份认证分区；本包无用户可配置项'],
  // 研究生教务网与 zdbk 同类：只走 CAS、没有任何用户可配置项，
  // 状态读数并入统一身份认证分区的那张「这份凭据的用途」卡片。
  // 硬造一个只显示状态的设置页，会让同一件事在设置里出现两处。
  ['yjsy', '状态已并入统一身份认证分区；本包无用户可配置项'],
  // 查老师无需登录、也没有可配置项；索引刷新是动作，不是配置。
  ['chalaoshi', '无需登录、无用户可配置项；索引刷新走服务动作而不是设置'],
  // 电子图书按 IP 认证：校外经 WebVPN，没有账号要填、也没有可配置项。
  ['ebook', '按 IP 认证、无用户可配置项；校外经 WebVPN'],
  ['xuezai', '与 zdbk/classroom 同口径：走「浙大一卡通」的 CAS 凭据，状态并入那个分区，本包不另占一格'],
  ['sztz', '凭据由集成层注入、本包无用户可配置项；校外经 WebVPN'],
  ['wechat-chat', '独立 agent skill、无客户端半边也无可配置项；纯本机只读，不联网'],
  ['dingtalk-chat', '独立 agent skill、无客户端半边也无可配置项；数据位置走 --data-dir'],
  ['weread', '独立 agent skill、无设置分区；凭据是微信读书扫码登录，不进本仓凭据体系'],
  // 通知是纯读的来源表 + 正文解析：统一身份认证由集成层注入（本包只在落到
  // CAS 登录页时请它做一次该站的委托登录），没有账号要填、也没有可配置项。
  ['notice', '统一身份认证由集成层注入、本包无用户可配置项；站点多在校内，经 WebVPN'],
  // 体艺有两个面（场馆平台 / 体艺 App），登录与学号都由集成层注入，
  // 本包没有任何用户可配置项；两个主机判 public，校外能直连。
  ['tyys', '凭据与学号由集成层注入、本包无用户可配置项；场馆与 App 均判 public，校外可直连'],
]);

function packages() {
  const out = [];
  for (const entry of readdirSync(SOURCE_ROOT, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(SOURCE_ROOT, entry.name);
    const manifestPath = path.join(dir, 'package.json');
    if (!existsSync(manifestPath)) continue;
    out.push({ dir, name: entry.name, manifest: JSON.parse(readFileSync(manifestPath, 'utf8')) });
  }
  return out;
}

/** 读一个包的客户端源码（没有则 null）。 */
function clientSource(dir) {
  const file = path.join(dir, 'src', 'client.jsx');
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

test('除白名单外，每个 source 包都有客户端半边并注册 settings.section', () => {
  const problems = [];
  for (const { dir, name, manifest } of packages()) {
    if (NO_SETTINGS.has(name)) continue;
    const source = clientSource(dir);
    if (source === null) { problems.push(`${name}: 没有 src/client.jsx`); continue; }
    if (!source.includes('settings.section')) problems.push(`${name}: client.jsx 没有注册 settings.section`);
    if (manifest.dsh?.client === undefined) problems.push(`${name}: package.json 缺 dsh.client`);
    if (manifest.exports?.['./client'] === undefined) problems.push(`${name}: package.json 缺 exports["./client"]`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('白名单里的包必须真的没有设置分区（防止白名单腐烂）', () => {
  const problems = [];
  for (const name of NO_SETTINGS.keys()) {
    const pkg = packages().find(p => p.name === name);
    assert.ok(pkg !== undefined, `白名单里的 ${name} 不存在了`);
    const source = clientSource(pkg.dir);
    if (source !== null && source.includes('settings.section')) {
      problems.push(`${name} 已经有设置分区了，请从 NO_SETTINGS 白名单里移出`);
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('每个设置分区都做了双语（标题跟随语言 + 存在 en 条目）', () => {
  const problems = [];
  for (const { dir, name } of packages()) {
    if (NO_SETTINGS.has(name)) continue;
    const source = clientSource(dir);
    if (source === null || !source.includes('settings.section')) continue;

    const hasI18nHook = source.includes('registerText(') || source.includes('function sectionLabel');
    if (!hasI18nHook) { problems.push(`${name}: 标题没有跟随语言（既无 registerText 也无 sectionLabel）`); continue; }

    // 存在英文条目：`en:` 后面必须跟着对象内容，不接受空对象
    const enBlock = /\ben:\s*\{([\s\S]*?)\n\s*\}/.exec(source);
    if (enBlock === null) { problems.push(`${name}: 找不到 en 字典`); continue; }
    const hasEntries = /\w+\s*:/.test(enBlock[1]);
    if (!hasEntries) problems.push(`${name}: en 字典是空的`);
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});

test('netproxy 的分区标题也跟随语言', () => {
  const source = clientSource(path.join(SOURCE_ROOT, 'netproxy'));
  assert.ok(source !== null);
  // netproxy 现在与其它包走**同一套** i18n：registerText + text.t('section')。
  // 早先它有个内联的 sectionLabel(ctx)，读 locale.language（不存在的字段），
  // 于是永远走兜底分支 —— 标题恒为中文而界面是英文。这条测试钉住
  // 「不许再退回自己判语言」。
  assert.ok(source.includes('registerText('), 'netproxy 必须用 registerText 注册字典');
  assert.ok(/label:\s*\(\)\s*=>\s*text\.t\('section'\)/.test(source), "netproxy 的 label 必须用 text.t('section')");
  assert.ok(!source.includes('function sectionLabel'), 'netproxy 不该再自己判语言');
});

test('设置分区的 order 不重复（重复会让排序不确定）', () => {
  const seen = new Map();
  const problems = [];
  for (const { dir, name } of packages()) {
    const source = clientSource(dir);
    if (source === null) continue;
    for (const match of source.matchAll(/order:\s*(\d+)/g)) {
      const order = Number(match[1]);
      // 一个包里可能有两个 order（分区 + 内部项），只在同一 order 值且都出现在
      // settings.section 注册里才算冲突；这里用简单启发：只统计 id 紧跟 order 的。
      if (!/settings\.section/.test(source)) continue;
      if (seen.has(order)) {
        problems.push(`order ${order} 被 ${seen.get(order)} 与 ${name} 同时使用`);
      } else {
        seen.set(order, name);
      }
      break; // 每个包只看第一个 order
    }
  }
  assert.deepEqual(problems, [], problems.join('\n'));
});
