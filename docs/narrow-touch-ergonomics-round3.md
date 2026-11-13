# 窄屏工效学：第三轮（横屏刘海、键盘、CI 空转）

> 第一轮（[`narrow-css-overrides.md`](narrow-css-overrides.md)）解决**看不看得见**；
> 第二轮（[`narrow-touch-ergonomics-round2.md`](narrow-touch-ergonomics-round2.md)）
> 解决**手指按下去怎么样**。这一轮解决**屏幕的物理形状与输入法**，外加一件与代码
> 无关但更值得先说的事：**这个仓库的 CI 从来没跑过**。

---

## 0. 先说 CI：`CI passed 0/0` 是真的什么都没跑

PR #70 上出现过一条 `CI passed 0/0`。核实结果：

| 检查 | 结果 |
| --- | --- |
| 仓库里有没有 `.github/` | **没有** |
| `commits/<sha>/check-runs` | `total_count = 0` |
| `commits/<sha>/status` | `state = pending`，`statuses` 为空 |
| 分支保护 / required checks | HTTP 404（未配置） |

`0/0` 不是「全部通过」，是**一个检查都没有**。任何人把这句话读成「CI 绿了」都会
得出错误结论 —— 包括我自己在第二轮结束时也差点这么理解。

**所以这一轮不假装有 CI。** 补一条会在第一天就红的工作流，等于把「没有检查」
换成「有检查但永远红」，两者的信息量是一样的，后者还更消耗注意力。真正的前提是
先把基线弄绿 —— 而基线现在是红的：

| 套件 | 结果 | 与本次改动的关系 |
| --- | --- | --- |
| `tests/repo/**`（profile 相关） | 7 失败 / 131 | **无关**：7 条全在 `profile*.test.mjs`；在 `main`（`07a535c`）的干净检出里同样失败 |
| `tests/client/page-quiz/*` | 3 失败 / 73 | **无关**：指向 `page-quiz/src/style.css:1554` 的 10px 字号等既有问题，本分支未改该文件 |

本分支改动的文件里，**没有一个**属于这两处失败的成因（`git diff --name-only`
可核对）。所以 CI 这件事记为一条**需要人来定的**待办，而不是我能在本轮单方面
解决的 —— 见 §3。

---

## 1. 这一轮的缺口

### T8 · 横屏时刘海盖住整条导轨

第二轮给导轨补了**底边**安全区，但只补了底边。而 `viewport-fit=cover` 下
**横屏时刘海跑到左边**：

| | 导轨 x | 第一个按钮 x | 刘海占左侧 | 结果 |
| --- | --- | --- | --- | --- |
| 844×390（iPhone 横屏） | 0 | **7** | ≈47px | 十个按钮**全部**在刘海底下 |

安全区普查也印证了：改前全站 `safe-area-inset-left` 与 `-right` 的出现次数都是
**0**，只有 `top` 4 次、`bottom` 3 次。

**改法**：四条边都取 `max(原内边距, env(...))`。用 `max()` 而不是相加 —— 没有
安全区的设备取到的仍是原值，不会凭空多出空白。

**机制验证**（headless 里 `env()` 恒为 0，量不出真实差异）：另注入
`padding-left: max(6.375px, 47px)` 模拟左刘海，实测第一个按钮 `x: 7 → 29`
（位移 22px，即 47 − 6.375 的一半取整后的可见位移）—— 确认这条机制真的会把
按钮推离刘海，而不是写了一条不生效的规则。

### T9 · 手机上搜索框的回车键写着「换行」

三处筛选框（文档 / 笔记 / 论文）都是 `<input type="search">`，但**一个键盘提示
属性都没写**：

| 属性 | 改前 | 改后 |
| --- | --- | --- |
| `enterkeyhint` | 无 → 键盘显示「换行」 | `search` → 显示「搜索」 |
| `autocapitalize` | 无 → 英文首字母被自动大写 | `none` |
| `autocorrect` | 无 | `off` |
| `spellcheck` | 无 | `false` |

后果不是「不好看」：这个框按回车**不换行**、只会收起键盘，而键帽上写着「换行」——
用户会被这个键帽误导；中英混排时英文关键词被自动首字母大写，于是搜不到。
实测改后三处都是 `enterkeyhint=search / autocapitalize=none / autocorrect=off /
spellcheck=false`，字号仍是第二轮定下的 16px。

### T10 · 旋转后不重新判断「是不是手机」

第二轮的文档页把 `navOpen` 初值绑在视口宽度上（手机收起、桌面展开），但那是
`useState` 的**初始值**。竖屏转横屏后 `innerWidth` 从 390 变成 844，目录的
浮层/并排形态会跟着 CSS 断点变，而 `navOpen` 不会重新判断。

实测 390 → 844 → 390 来回转：`nav=false`（浮层已收起）、`overflowX` 全程为 0、
导轨溢出为 0 —— **没有观察到实际故障**。所以这一条记为**已知边界**而不是缺陷：
断点切换时状态不重算，但当前的所有路径都落在「要么本来就该收起、要么用户已经
手动设过」上。真要处理，得让 `navOpen` 记住「用户是否手动改过」，那是行为变更，
不在本轮授权内。

---

## 2. 验证

改后同一实例实测（390×844 与 844×390，`(pointer: coarse)`）：

```text
安全区          left 1 / right 1 / top 5 / bottom 3   （改前 left 0 / right 0）
左刘海机制      padding-left max(6.375px, 47px) → 第一个按钮 x: 7 → 29
搜索框键盘      enterkeyhint=search, autocapitalize=none, autocorrect=off, spellcheck=false
桌面 1440       padding 12.75px 6.375px（不变）、导轨溢出 0
```

回归：`pages-default` 65/65、`ui-shared` 30/30、`page-paper` 98/98、
`page-planning` 10/10、`page-study` 220/220、`page-planning+quiz` 中 75/78
（3 条与本次无关的既有失败，见 §0）。

---

## 3. 需要人决定的两件事

这两件都不是「再改几行 CSS」能解决的，而且都超出本轮授权：

### 3.1 CI 要不要接、接哪些

现在仓库**没有任何 CI**。接之前得先决定：

1. 那 7 条 profile 失败是修掉、还是先标 `skip`（它们测的是 profile 初始化，
   与本产品功能无关，但红着就没人看 CI 了）；
2. 3 条 quiz 字号/颜色失败同理（`page-quiz/src/style.css:1554` 的 10px 中文
   确实低于 legibility floor，是**真问题**，但改它属于另一件事）；
3. 浏览器类测试（`docs-scroll-keys`、`paper-tree-keys` 等）要装 Playwright
   与宿主，跑一次几分钟 —— 是放进 PR 检查还是只做夜间。

我倾向于：**先接「纯 Node、不装浏览器、不依赖宿主」的那一批**（`tests/repo`、
`tests/client/*` 里读源码的那些），把基线修绿再接，而不是先接一条红的工作流。

### 3.2 旋转时要不要重算断点状态

见 T10。当前没有观察到故障，但这是「碰巧都对」而不是「设计上对」。
要处理需要给 `navOpen` 加一个「用户是否手动改过」的标记 —— 属于行为变更。

---

## 4. 复现

```bash
# 起实例后
node scripts/narrow-touch-audit.mjs "<带 token 的地址>"   # 第二轮的属性普查
node .runtime/probe/round3-verify.mjs "<带 token 的地址>"  # 本轮的四面安全区 + 键盘提示
```
