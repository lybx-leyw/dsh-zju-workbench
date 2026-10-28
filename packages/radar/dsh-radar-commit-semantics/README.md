# dsh-radar-commit-semantics —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成（**2026-10-29 · r97 · 06 时 · B 组**），
> **仅用于人工评审**。`src/index.js` 的 `apply()` 被调用即抛错，
> `src/upstream.js` 的三个 TODO 全部只有规格、没有实现。
> 本包**没有**写进 `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles`。

**类型：B 类（其他 JS 项目）。** 无 `cordis.patch.yml`、不 insert、不注册路由 ——
它是一组纯函数，不是插件；`apply()` 只为「误挂载时立刻失败」而存在。

**集成方式：强化式集成**（不是全新）。三判据逐条成立，见下。

| 项 | 值 |
| --- | --- |
| 上游 | `northword/tiny-conventional-commits-parser` |
| 锁版 | **`0.1.0`**（写完死；npm `dist-tags.latest` = `0.1.0`，历史上只有 `0.0.1` / `0.1.0`） |
| 许可证 | MIT ✅（仓库 `package.json` + GitHub `spdx_id` 两处一致） |
| 体量 | ★2 · 4 个源文件 · 约 **5.2 KB** · **零传递依赖** |
| 语言 | TypeScript（产物为 `dist/index.mjs`，ESM only） |

---

## 为什么是「强化式集成」

| 判据 | 是否成立 | 依据 |
| --- | --- | --- |
| ① 仍是同一个面板 | ✅ | 不新增导航项、不新增插槽、不注册路由。输出只喂给**已有**的两处文案：插件页的发布记录、雷达基线告警的口径 |
| ② 功能仍相似正交 | ✅ | 仍是「把提交信息写成一句人话」。变化只在前缀切分粒度：`fix:` 一刀切 → type / scope / breaking / 引用 四元组。不加版本号计算、不生成 CHANGELOG |
| ③ 底层多调了更优质实现 | ✅（**部分**） | 本仓 **零** conventional-commit 解析（`grep -rniE "conventional\|BREAKING CHANGE\|breaking "` 在 `packages/dsh-zhiyun-*` 与 `scripts/` 下命中 **0**）。但「更优质」只在上游**已打磨的正则覆盖度**上成立，而它在 breaking 判定上有**明确缺陷**（见下），本包必须在其之上改正 —— **判据③的落点是「改正一处」，不是「整体更强」** |

---

## 不能照抄上游的三处（沙箱内读 `src/parse.ts` 原文所得）

### P0-1 · 正则两端都没锚 + 类型不归一

上游：

```js
const ConventionalCommitRegex
  = /(?<emoji>:.+:|(\uD83C[\uDF00-\uDFFF])|…)?( *)(?<type>[a-z]+)(\((?<scope>.+)\))?(?<breaking>!)?: (?<description>.+)/i
```

- 无 `^` 无 `$`，`description` 是 `.+`（贪婪、不跨行）。
- `i` 旗标让 `[a-z]+` 也能吃 `Fix`，但**捕获到的仍是 `Fix`**，不做归一。

**沙箱实测**（2026-10-29，Node 22.13.0）：

| 输入 | 上游结果 | 问题 |
| --- | --- | --- |
| `我顺手 fix 了导出: 这个真绝` | `null` | 中文前导字符挡掉了 —— **不会误命中，此前的担心不成立** |
| `Fix: 大写仍命中` | `type: 'Fix'` | ❌ **类型未归一**，下游 `type === 'feat'` 全等比较会漏掉一整类 |
| `feat(ui)!: 换掉旧布局` | `type:'feat', breaking:'!'` | 正常 |

本包做法：`^…$` 双锚 + `type.toLowerCase()`，不再调用上游的 `parseRawCommit`（它按 `|` 切字段）。

### P0-2 · `isBreaking` 认全文而不是 footer（最硬的一条）

上游：

```js
const BreakingRE = /breaking[ -]changes?:/i
const hasBreakingBody = BreakingRE.test(body)   // 全文 test
```

后果：正文写「**本提交不构成 breaking change:**」同样命中 —— **否定句被判成破坏性变更**。
一旦下游据此升 major，版本号就被一句否定句毁掉。

本包做法（`upstream.js` 的 `TODO-C`）：只扫 **footer 段**，且该行以否定词开头时判 false。

> **这条是本包相对上游的全部增量价值。** 评审若认为「既然要改，不如全自己写」，
> 应直接判骨架**作废**，而不是「降级成照抄上游」。

### P1 · 引用去重只按 value、不按 type

`some(i => i.value === m[1])`：`(#12)` 先入队成 `pull-request`，`#12` 的 issue 扫描就被挡掉。

**沙箱实测**：`fix(core): 修好了回滚 (#128)`

| 扫描顺序 | 结果 |
| --- | --- |
| 上游顺序（先 PR 后 Issue） | `[{type:'pull-request', value:'#128'}]` ✅ |
| 反过来（先 Issue 后 PR） | `[{type:'issue', value:'#128'}]` ❌ 同一个编号变成了 Issue |

**结果对，靠的是扫描顺序**。本包的输出里 `type` 必须参与去重键。

### P1 · `parseRawCommit` 按 `|` 切字段

提交信息里出现 `|`（表格、管道、数学符号）会把正文切碎。本包自己填结构化入参，绕开它。

---

## 评审必须先回答的三个问题

1. **值不值得锁版引入一个 5.2 KB 的依赖？**
   上游 4 个文件里只有 `parse.ts` 有用（`git.ts` 是 `git log` 子进程封装，本包不用）。
   若只看「正则覆盖度」，自写约 40 行即可不劣于上游；
   真正的增量是 **P0-2 的 footer-only breaking 判定**（上游**明确更差**）。
   → **若结论是「自写」，本骨架作废**（`registry.md` 标 `rejected`），不要留下一个只为「锁版而锁版」的包。
2. **这两处文案到底会不会被用户看到？**
   若插件页与基线告警的文案**本来就不展示提交语义**，那么本包就是「重复且无增益」，
   三判据的第②条不成立 —— 也必须作废。**这是本轮未能验证的一格**（见 `docs/ecosystem-radar/2026-10-29-06.md` §4）。
3. **`0.1.0` 的 `@types` 与 ESM 产物是否可直接被宿主的构建吃掉？**
   `exports` 只有 `"."` → `./dist/index.mjs`，**没有 `require` 分支**；
   宿主若走 CJS 打包会 `ERR_PACKAGE_PATH_NOT_EXPORTED`。

---

## 明确不做

- 不做 `git log` 子进程（输入由调用方给）。
- 不生成 CHANGELOG、不算 semver 增量（那属 `semantic-release/*` 那一类上游的职责）。
- **不写测试**（skill 硬边界：radar 包内不得有 `test/` / `*.test.*`）。
