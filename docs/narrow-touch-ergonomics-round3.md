# 窄屏工效学：第三轮（横屏刘海、键盘、CI 空转）

> 第一轮（[`narrow-css-overrides.md`](narrow-css-overrides.md)）解决**看不看得见**；
> 第二轮（[`narrow-touch-ergonomics-round2.md`](narrow-touch-ergonomics-round2.md)）
> 解决**手指按下去怎么样**。这一轮解决**屏幕的物理形状与输入法**，外加一件与代码
> 无关但更值得先说的事：**这个仓库的 CI 从来没跑过**。

---

## 0. 先说 CI：`CI passed 0/0` 是真的什么都没跑

> **本轮已处置（第四节）**：清空了能清的既有失败，并接上了一条不装浏览器的
> 工作流。下面这段保留为当时的证据与判断依据。

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

其中 3.1 已由用户授权处置；3.2 仍属行为变更，留给后续：

### 3.1 CI 要不要接、接哪些 —— **已处置，见 §4**

用户已授权由我决定（「CI 不一定要接，你可以自己决定。如果要接的话就先把既有
失败清空」）。结论：接，范围收在「不装 Playwright」。既有失败逐条清掉，
过程与依据见 §4。

### 3.2 旋转时要不要重算断点状态

见 T10。当前没有观察到故障，但这是「碰巧都对」而不是「设计上对」。
要处理需要给 `navOpen` 加一个「用户是否手动改过」的标记 —— 属于行为变更。

### 3.3 Node 22 的测试运行器不稳定（CI 暂时只跑 Node 24）

`engines` 声明 `^22.19.0 || >=24.0.0`，但同一套代码在两条线上表现不同：

| | `--test-concurrency=1` | 再加 `isolation=none` |
| --- | --- | --- |
| Node 24 | fail 0 / cancelled 0 | fail 0 / cancelled 0 |
| Node 22.19 | fail 0 / **cancelled 80** | fail 0 / **cancelled 1160–1446** |

被取消的用例报 `failureType: 'cancelledByParent'` /
`Promise resolution is still pending but the event loop has already resolved`，
**不计入 `fail`** —— 只看失败数会以为全绿，实际有几百个用例根本没跑。

没有任何一个开关能同时稳住两条线（`isolation=none` 在 24 上变好、在 22 上变坏）。
所以 CI 现在只跑 Node 24；「Node 22 到底怎么收敛」留成待办：要么逐个定位那批
依赖定时器的用例，要么接受「CI 只验证一条线」并在 `engines` 里写清楚。

---

## 4. CI：清空既有失败，接一条不装浏览器的工作流

用户说「CI 不一定要接，你可以自己决定。如果要接的话就先把既有失败清空」。
决定：**接**，范围收在「不装 Playwright」这一档。为接它而清掉的既有失败如下。

### 4.1 清掉的失败（全部是测试自身的缺陷，不是被测代码的问题）

| # | 失败 | 根因 | 处置 |
| --- | --- | --- | --- |
| 1 | `profile.test.mjs` 7 条 | 用例第一步就 `locateHost()`，没有宿主时直接抛错 | 加 `requireHost(t)` 守卫，没有宿主时 `t.skip` 并写明原因（同一文件里另两条早就是这么做的） |
| 2 | `docs-scroll-keys.test.mjs` 构建失败 | 桩里漏了 `useRegisterPageSidebar`，而 `client.jsx` 早就 import 了它 | 补进桩 |
| 3 | `docs-scroll-keys.test.mjs` `maxScroll=0` | 夹具忘了写 `body[data-zw]` —— 整份 `style.css` 的作用域前缀，少了它一条规则都不生效 | 夹具补上该属性（真机里由外壳写在 body 上） |
| 4 | `quiz-page-contract.test.mjs` 字号 | `page-quiz` 里「必选」徽标 `font-size: 10px` | **这是真问题**：repo-profile §1 明写「9–10px 一律禁止用于中文」。抬到 `--zw-fs-meta`（11px） |
| 5 | `quiz-page-contract.test.mjs` 硬编码色值 | 12 处 `#b91c1c` / `#c2410c` / `#fca5a5` / `#fdba74` / `#fff` / `#10141a` | 新增两个语义 token `--zw-danger` / `--zw-on-accent`（明暗各一套），替掉全部硬编码 |
| 6 | `quiz-page-contract.test.mjs` 同名顶层选择器 | `.zws-qz-notice` / `.zws-qz-explanation` / `.zws-qz-feedback` 各出现两次，靠「后写的赢」 | 合并成一条，属性和并后按**实际渲染**取值 |

第 4、5、6 条是**真的**在产品代码里：10px 中文读不清、12 处颜色不跟主题走、
三条规则改第一处不生效。它们不是「测试太严」，是本轮清单正好覆盖的那类问题。

新增 token 的对比度实测（脚本算，不是估）：

```text
浅色  danger/bg 6.03:1   danger/surface 6.47:1   #fff on accent 8.79:1
深色  danger/bg 9.01:1   danger/surface 8.02:1   #10141a on accent 9.54:1
```

### 4.2 接上的工作流

`.github/workflows/tests.yml`，两个 Node 版本（22.19 / 24，与 `engines` 的两条线对齐）
× 四步：`npm ci` → 链接工作区 → `check:css` → 装验证过的宿主 → 跑**不 import
playwright** 的全部用例。

排除浏览器用例用的是「源码里有没有 `from 'playwright'`」而不是文件名清单 ——
清单会漂，而漂掉的表现是 CI 卡在一个用例上直到超时，比干脆失败更难查。

**接上之后 CI 立刻抓到三件事**（这正是它存在的理由 —— 此前这些问题一条都
不会被人看见）：

| 次序 | 症状 | 根因 | 处置 |
| --- | --- | --- | --- |
| 1 | `install` 步直接失败 | `npm ci` 缺 `--legacy-peer-deps`：`@deepseek-ai/cordis` 是各包的 **peerDependency**，npm 7+ 的 `ci` 判定锁文件不同步 | 加 flag（与 AGENTS.md「依赖坏了怎么修」同口径） |
| 2 | `pass 4560 / fail 1 / cancelled 83` | 把 324 个文件（4685 用例）一次性喂给**一个** `node --test` 进程，事件循环提前收尾，83 个用例被取消 | 按 `tests/<层>` 分批，每批独立进程 |
| 3 | `Cannot find module '@deepseek-ai/cordis'` | 没装宿主。装了之后同一套用例从 4476 通过变成 4560 通过 | 工作流显式装 `preferredHostVersion` |

第 2 条特别值得记下来：表面是「fail 1」，看起来像一个孤立的坏用例；实际是
**跑法错了** —— 只看失败数会把排查方向带偏。

**本地的验证缺口**：这台开发机只有 1.8 GB 内存，`npm install` 装宿主那步被
OOM killer 杀掉（EXIT=137，dmesg 是 `oom-kill … task=npm`），所以那一步在本机
跑不了。但它在 GitHub runner 上是**成功**的 —— 这反过来也证明了本机是内存不够，
不是命令写错。分批跑法已在本地按同一脚本验证：

```text
tests/repo    129 用例  119 通过  0 失败  0 cancelled  10 skip
tests/client  605 用例  598 通过  0 失败  0 cancelled   7 skip
```

### 4.3 仍然不接的部分

浏览器类用例（12 个文件）。它们要装 Playwright + Chromium（约 300 MB），
单次启动十几秒。要不要进 PR 检查、还是只做夜间，是产品决策；本轮不擅自决定。

---

## 5. 复现

```bash
# 起实例后
node scripts/narrow-touch-audit.mjs "<带 token 的地址>"   # 第二轮的属性普查
node .runtime/probe/round3-verify.mjs "<带 token 的地址>"  # 本轮的四面安全区 + 键盘提示
```
