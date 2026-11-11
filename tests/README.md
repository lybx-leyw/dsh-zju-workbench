# 测试目录

测试按**被测代码所在的包**分层存放，与 `packages/` 的目录结构一一对应：

```text
tests/
  core/<包名>/       packages/core/<包名> 的测试
  client/<包名>/     packages/client/<包名> 的测试
  source/<包名>/     packages/source/<包名> 的测试
  tool/<包名>/       packages/tool/<包名> 的测试
  apps/desktop/      apps/desktop 的测试
  scripts/           scripts/（基准台、评测脚本、构建守卫）的测试
  repo/              跨包的分层守卫与仓库级契约（不含单个包的实现细节）
  deploy/            deploy/ 下服务的测试
  python/            deploy/ 与 robot/ 的 Python 契约测试
  fixtures/          共享夹具
  support/ helpers/  共享测试工具
```

## 新增测试放在哪

放在被测包的目录下，文件名 `<主题>.test.mjs`：

```bash
# 测 packages/core/parser/src/tree.js
tests/core/parser/tree.test.mjs
```

只有**跨包**的守卫（分层边界、发布身份、i18n 字典完整性、CSS 顺序等）才放
`tests/repo/`。一个包内部的规则不要放进去 —— 那样定位时又要跨目录找。

## 运行

```bash
npm test                       # 全部 JS/TS 测试
npm run test:python            # 全部 Python 测试
node --test "tests/core/parser/**/*.test.mjs"    # 单个包
node --test tests/core/parser/parser.test.mjs    # 单个文件
```

`npm test` 用 `tests/**/*.test.mjs` 递归匹配，新增包目录不需要改 `package.json`。

## 依赖

- 需要 `npm ci` 装好依赖（**不要用 `npm install`**，见 [AGENTS.md](../docs/contributing/AGENTS.md)）。
- 一部分测试需要真实的 DSH 宿主（`.runtime/dsh-<版本>`，先跑 `node scripts/profile.mjs init`）
  与 Playwright 浏览器。缺这些时相关测试会自己 `skip` 或给出明确的失败原因，
  而不是静默变绿。
