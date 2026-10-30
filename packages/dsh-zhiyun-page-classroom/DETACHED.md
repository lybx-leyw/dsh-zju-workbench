# 未接入：先放着吃灰（2026-10-30）

这个包**已经能跑**，但按决定**暂不接进 profile**。本文件是它的状态标记：
`tests/build-seeds.test.mjs` 与 `tests/css-order.test.mjs` 见到它会跳过
「有 client.jsx 就必须登记进 CLIENT_PACKAGES」的断言，壳的导航里也不会有「课堂」页。

## 要重新接进来时

1. 删掉本文件；
2. `scripts/build.mjs` 的 `CLIENT_PACKAGES` 加 `dsh-zhiyun-page-classroom`；
3. `packages/dsh-zhiyun-shell-workbench/src/model.js`：`NAV` 加
   `{ id: 'classroom', label: '课堂', icon: 'cap', hint: '…' }`，
   `RAIL_DEFAULT` 与 `FULL_BLEED_PAGES` 各加 `'classroom'`；
4. `profiles/zhiyun-bench/package.json` 的 bundles 加
   `dsh-zhiyun-host-openmaic`、`dsh-zhiyun-page-classroom`（**按本仓既有顺序**，
   放在 `page-docs` 之后、`page-feedback` 之前）；
5. `tests/profile.test.mjs:97` 与 `tests/css-order.test.mjs` 的清单各补一行。

## 重新接入前必须先解决的事

**PostgreSQL 目前是手工起的便携版**，不在宿主包的生命周期里。换台机器或重启后，
页面会如实报 `no-database` 并给出指引 —— 那是正确行为，但不是「开箱可用」。
要么把数据库拉进宿主包托管，要么在 README 里写清前置步骤。

另外，上游构建时**必须**带 `ALLOWED_FRAME_ANCESTORS`
（见 `packages/dsh-zhiyun-host-openmaic/README.md`）：它在 `next.config.ts` 的
`headers()` 里读，而 `headers()` 是构建期求值、写死进 `.next/routes-manifest.json`
的。少了它，iframe 一定被 CSP 拦，且运行时不报错、只表现为白屏。
