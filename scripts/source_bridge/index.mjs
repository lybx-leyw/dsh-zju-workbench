#!/usr/bin/env node
/**
 * 真机探针的入口。
 *
 * 用法：
 *
 *     node scripts/source_bridge/index.mjs --root <repo/> --platform cc98
 *     node scripts/source_bridge/index.mjs --root <repo/> --platform cc98,zdbk --json
 *
 * 凭证**只从环境变量读**（由 `source-check.py` 用 `env` 传给子进程，不进命令行、
 * 不进 `ps`、不进 shell 历史）：
 *
 *     VERIFY_ZJU_USER / VERIFY_ZJU_PASS      浙大一卡通
 *     VERIFY_CC98_USER / VERIFY_CC98_PASS    CC98 自己的账号
 *     VERIFY_PTA_COOKIE                      拼题A Cookie
 *     VERIFY_XXT_COOKIE                      学习通 Cookie
 *
 * 输出：每条平台一行 `@@RESULT@@{json}`，便于 Python 侧流式解析。
 * 失败也走同一行格式（`ok:false` + `code`），**不让进程以异常退出** ——
 * 一条链路失败不该吞掉其它平台的结论。
 *
 * # 组织方式
 *
 * 一个域一个文件（`cc98.mjs` / `xzzd.mjs` / `zdbk.mjs` / `classroom.mjs` /
 * `pta.mjs` / `xxt.mjs`），共享 `_base.mjs` 的装配与协议适配。新增平台只需要
 * 加一个文件 + 在下面的 `PLATFORMS` 里登记一行。
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

import { setRoot, fail } from './_base.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/**
 * 平台注册表。
 *
 * `credential` 说明这条链路要哪一份凭证 —— 由入口据此判断"该不该跑"：
 * 没有对应凭证时**不启动探针**（启动会拿空账号去登真站点，报出来的
 * AUTH_REJECTED 看起来像"账号有问题"，而真实情况是"我们根本没问过"）。
 */
const PLATFORMS = {
  cc98: { module: './cc98.mjs', credential: 'cc98', label: 'CC98 论坛' },
  xzzd: { module: './xzzd.mjs', credential: 'zju', label: '学在浙大' },
  zdbk: { module: './zdbk.mjs', credential: 'zju', label: '教务系统' },
  classroom: { module: './classroom.mjs', credential: 'zju', label: '智云课堂' },
  pta: { module: './pta.mjs', credential: 'pta', label: '拼题A' },
  xxt: { module: './xxt.mjs', credential: 'xxt', label: '学习通' },
};

/** 环境变量 → 凭证。缺任何一半就当作"没提供"。 */
function credentialsFromEnv() {
  const zjuUser = process.env.VERIFY_ZJU_USER ?? '';
  const zjuPass = process.env.VERIFY_ZJU_PASS ?? '';
  const cc98User = process.env.VERIFY_CC98_USER ?? '';
  const cc98Pass = process.env.VERIFY_CC98_PASS ?? '';
  return {
    zju: zjuUser && zjuPass ? { username: zjuUser, password: zjuPass } : null,
    cc98: cc98User && cc98Pass ? { username: cc98User, password: cc98Pass } : null,
    pta: (process.env.VERIFY_PTA_COOKIE ?? '').trim() || null,
    xxt: (process.env.VERIFY_XXT_COOKIE ?? '').trim() || null,
  };
}

function parseArgs(argv) {
  const args = { root: null, platform: '', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--root') { args.root = argv[++i]; continue; }
    if (token === '--platform') { args.platform = argv[++i] ?? ''; continue; }
    if (token === '--json') { args.json = true; continue; }
  }
  return args;
}

const emit = (value) => process.stdout.write(`@@RESULT@@${JSON.stringify(value)}\n`);

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.root) {
    // 默认从本文件位置推：scripts/source_bridge/ → 仓库根
    args.root = path.resolve(HERE, '..', '..');
  }
  // 统一成**以分隔符结尾**的形式 —— 包路径的拼法是 `root + packages/...`
  const root = args.root.replace(/[\\/]+$/, '') + path.sep;
  setRoot(root);

  const names = (args.platform || 'cc98,xzzd,zdbk,classroom,pta,xxt')
    .split(',').map((s) => s.trim()).filter(Boolean);

  const unknown = names.filter((name) => !PLATFORMS[name]);
  if (unknown.length) {
    emit({ ok: false, code: 'UNKNOWN_PLATFORM', message: `未知平台：${unknown.join(', ')}。可用：${Object.keys(PLATFORMS).join(', ')}` });
    return 0;
  }

  const creds = credentialsFromEnv();
  // card 模块只 import 一次，各域文件共用
  const card = await import(pathToFileURL(path.join(root, 'packages', 'dsh-zhiyun-source-card', 'src', 'index.js')).href);

  for (const name of names) {
    const spec = PLATFORMS[name];
    const begin = Date.now();

    // 没有这条链路要的凭证 → 明确报 SKIP，**不启动探针**
    const credential = creds[spec.credential];
    if (!credential) {
      emit({
        platform: name,
        ok: false,
        skipped: true,
        code: 'NO_CREDENTIAL',
        message: `没有提供${spec.label}需要的凭证`,
        ms: Date.now() - begin,
      });
      continue;
    }

    try {
      const domain = await import(new URL(spec.module, import.meta.url).href);
      const dataDir = path.join(root, '.verify-scratch', 'source-check', 'live', name) + path.sep;
      const data = await domain.run({ account: credential, cookie: credential, dataDir, card });
      emit({ platform: name, ok: true, ms: Date.now() - begin, data });
    } catch (error) {
      // 一条链路失败不影响其它平台
      emit({ platform: name, ms: Date.now() - begin, ...fail(error) });
    }
  }

  return 0;
}

main().then((code) => {
  process.exitCode = code ?? 0;
}).catch((error) => {
  emit({ ok: false, code: error?.code ?? 'BRIDGE_ERROR', message: String(error?.message ?? error).slice(0, 400) });
  process.exitCode = 1;
});
