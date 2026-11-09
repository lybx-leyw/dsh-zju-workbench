# `zju-assistant` 的 vendor 记录

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | https://github.com/Anchorite-no/dsh-zju-assistant |
| commit | `e59b81e1c254d979402f047c6fc8e43bf30b9713`（2026-11-05，`Prepare 0.1.8`） |
| 工作区包 | `dsh-zju-assistant-workspace` 0.1.8 |
| 插件包 | `dsh-zju-campus` 0.1.8 |
| 协议 | **GPL-3.0-only**（保留上游原声明，不改成本仓默认的 `-or-later`） |

## 引入方式：整仓原样

保留上游的完整内部结构，**不做拆分、不改文件名**：

```
packages/vendor/zju-assistant/
├── core/          # 7 个子包：chat / dingtalk / initialize / learn / skills / wechat / weread / zju
├── plugin/        # 插件本体（dsh-zju-campus），含 host/ client/ bundle/ locale/ skill/
├── scripts/       # 上游自己的 setup / security 检查
├── package.json   # workspace 根
└── package-lock.json
```

## 为什么是整仓，不是单个插件包

它不是「一个包」，而是一个**自带 workspace 的独立项目**：

- `plugin/` 依赖 `core/*` 那 6 个子包（`zju` / `weread` / `dingtalk` / `wechat` / `chat` / `learn` / `skills`）；
- 自己有构建链（`plugin/build.mjs`）、打包（`pack-mcp` 风格的 `pack-plugin`）、
  以及一套 `npm run verify` 测试；
- 有独立的 `package-lock.json` 与 `engines` 约束（`node >=24.18.0 <25`）。

只取 `plugin/` 会得到一个跑不起来的半截包。

## 我们的改动

**目前为零。** 原样拷贝，一个字节没动。

按 `packages/vendor/README.md` 的约定，`PATCHES.md` 是一份**代价清单**：
它记录我们偏离上游多少，偏离越多将来升级越贵。所以这份文件在第一次真正改动
上游代码时必须更新 —— 写清改了哪个文件、为什么改、能不能用上游配置替代。

## 它不参与本仓约定

按 `scripts/workspace-packages.mjs` 的 `isIsolated()`（`ISOLATED_GROUPS` 含 `vendor`），
`packages/vendor/` 下的包不会被：

- 加进 profile 的 `bundles`；
- 当成本仓客户端包去构建（它有**自己的** `plugin/build.mjs`）；
- 要求遵守本仓的跨包 CSS 层叠顺序；
- 要求出现在插件依赖图里。

所以要启用它，得按它自己的流程走：读 `packages/vendor/zju-assistant/README.md`，
在那边 `npm install` + `npm run build`，再把它产出的插件包装进 profile。

## 升级方式

```powershell
# 1. 取新版本
git clone --depth 1 https://github.com/Anchorite-no/dsh-zju-assistant.git /tmp/upstream

# 2. 对比（确认我们没改过的东西能无痛替换）
diff -r --exclude=node_modules /tmp/upstream packages/vendor/zju-assistant

# 3. 若我们改过，按本文件的「我们的改动」逐条重放；
#    没改过则直接整体替换，并更新本文件顶部的 commit。

# 4. 更新本文件顶部的 commit 与版本。
```

## 注意

它的 `engines` 要求 `node >=24.18.0 <25`，而本仓根 `package.json` 写的是
`^22.19.0 || >=24.0.0`。两者在 24.x 上有交集，但**本仓没有强制要求 24.18+** ——
将来若要真正构建它，先确认本机 node 版本落在它的区间里。
