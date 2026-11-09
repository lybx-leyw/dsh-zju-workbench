# packages/vendor — 会改对方代码的上游副本

这里放**别人写的、我们改过的**代码。

## 与 `packages/` 下其它目录的区别

| 位置 | 含义 |
| --- | --- |
| `packages/core/` `packages/source/` `packages/client/` | **本仓自己写的**逻辑 |
| `packages/vendor/` | **上游的代码 + 我们的修改** |

## 为什么单独放

因为「我们改了它的代码」这件事必须可见。

上游一旦被就地修改，就**不能再跟随上游升级**（`npm update` 会覆盖改动，
而重新 patch 一遍的成本随改动量线性增长）。所以这类代码要：

1. **单独隔离**，一眼能看出「这里不是我们写的」；
2. **记录改了什么**（每个 vendor 包自己写 `PATCHES.md`）；
3. **不参与**本仓的命名/结构约定 —— 我们无权要求上游代码遵守我们的规范。

## 豁免范围

`packages/vendor/` 下的包**不算本仓产品包**。判定在
`scripts/workspace-packages.mjs` 的 `isIsolated()`（`ISOLATED_GROUPS`），
效果是它们不会：

- 被加进 profile 的 `bundles` 清单；
- 被 `scripts/build.mjs` 当成本仓客户端包去构建；
- 被 `scripts/check-css-order.mjs` 要求遵守本仓的跨包层叠顺序；
- 被 `tests/plugins-page.test.mjs` 要求出现在本仓插件图里。

⚠️ 这个豁免是**位置判定**，不是包名判定。`packages/vendor/` 下无论包叫什么，
都会被隔离 —— 所以**不要**把本仓自己的包放进这个目录。

## 每个 vendor 包应该有什么

```
packages/vendor/<上游名>/
├── package.json      # name 用上游原名（不加本仓前缀）
├── PATCHES.md        # 必填：上游版本 + 改了哪些文件 + 为什么改
└── src/ …
```

`PATCHES.md` 是一份**代价清单**：它记录了我们偏离上游多少。偏离越多，
将来升级越贵。写的时候要诚实 —— 「顺手改了」也要写。
