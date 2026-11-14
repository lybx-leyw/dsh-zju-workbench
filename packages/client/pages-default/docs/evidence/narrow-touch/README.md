# 窄屏工效学：改动前后对照

同一台实例（DSH `0.2.2-rc.1` + `dsh-pocket@2.12.0` 已装配）、同一份 profile、
同一账号、同一视口与主题。`before-*` 是改动前的构建，`after-*` 是本次改动后的构建。

复现环境：Chromium（Playwright 自带），移动档 `isMobile: true, hasTouch: true`。
读数在 `artifacts/narrow-ergonomics/{before,after}/measurements.json` 里，
由同一个脚本 `scripts/narrow-audit.mjs` 两次取证生成（见仓库
`docs/narrow-css-overrides.md` §5）。

**逐项清单与工效学判定见 [`docs/narrow-css-overrides.md`](../../../../../../docs/narrow-css-overrides.md)。**

## 1. 手机 390×844：账户 / 设置入口被搬到视口外

搬移规则的前提是「侧栏是一个常驻列」。抽屉态下宿主给侧栏
`transform: translateX(-280px)` 做开合动画 —— `transform` 会让祖先成为
`position: fixed` 的**包含块**，于是 `left: 6px` 变成「相对那条 −280 的浮层再左移」。

| | 抽屉关着 | 抽屉打开 |
| --- | --- | --- |
| 改前 | `[-223, 757, 37, 37]`（被 `left:6px` 缩成 37 宽并推出视口） | `[57, 757, 37, 37]`（`transform` 归零才碰巧在视口内） |
| 改后 | `[-221, 798, 264, 40]`（宿主原生位置，在抽屉里） | `[59, 798, 264, 40]`（264 宽整行「账号菜单」） |

桌面 1440 改前改后都是 `[6, 813, 37, 37]`。

- `before-drawer-open.png` / `after-drawer-open.png`

## 2. 手机 390×844：文档页目录「永远打不开」

窄屏样式表原本是 `.zwd-nav { display: none }`，而导轨鲸鱼按 `navOpen` 文案翻转 ——
于是手机上的目录**永远不显示**，按钮还自相矛盾（写着「收起」但没东西可收）。

| | `.zwd-nav` rect | 可见 | 鲸鱼文案 |
| --- | --- | --- | --- |
| 改前（点鲸鱼后） | `[0, 0, 0, 0]` | ✗ | 展开文档目录 |
| 改后（点鲸鱼后） | `[51, 42, 258, 802]` | ✓ | 收起文档目录 |

- `before-docs.png` / `after-docs.png`（初始态：改前目录消失且文案矛盾，改后正文满宽）
- `before-docs-whale.png` / `after-docs-whale.png`（点鲸鱼：改前仍不出现，改后浮层出现）
- `before-dark-docs-whale.png` / `after-dark-docs-whale.png`（深色同场景）
- `before-1440-docs.png` / `after-1440-docs.png`（桌面回归对照：目录仍是常驻 229 px 一栏）

## 3. 手机：触摸命中区

只在 `(pointer: coarse)` 生效；图形一个像素不动，只放大透明 `::after`。
所以这一条**没有视觉差异**，差异在命中区读数：

| 目标 | 图形 | 改前命中区 | 改后命中区 |
| --- | --- | --- | --- |
| 鲸鱼（收起 / 展开侧栏） | 23×17 | 24×18 | **44×45** |
| 导轨导航项 | 37×37 | 36×37 | **50×43** |
| 笔记顶栏 | 30×30 | 30×30 | **33×42** |
| 笔记栏头 | 26×26 | 26×26 | **28×44** |
| 论文栏头 | 26×26 | 26×26 | **28×42** |

读数口径：从按钮中心向四方向逐像素外扩，直到 `elementFromPoint` 不再命中它。

## 4. 手机 390×844：笔记页 / 论文页两栏竖着叠（上一轮已修，本轮回归复测）

| | 改前 | 改后 |
| --- | --- | --- |
| 笔记正文 | `[241, 400]`（右端 641，被裁） | `[51, 307]` |
| 论文落地页 | `[241, 84]`（竖排字） | `[51, 307]` |

- `before-notes.png` / `after-notes.png`
- `before-paper.png` / `after-paper.png`

## 5. 桌面 1440×900（回归对照）

本轮所有改动都带「窄屏 / 粗指针」前提，桌面必须逐像素不变：

| | 主页 | 文档页目录 |
| --- | --- | --- |
| 改前 | 导轨 51、内容列 `[51, 1389]` | 常驻 229 px、默认展开 |
| 改后 | 同左 | 同左 |

- `before-1440-home.png` / `after-1440-home.png`
- `before-1440-docs.png` / `after-1440-docs.png`
