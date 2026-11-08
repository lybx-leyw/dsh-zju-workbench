# 授权（Licensing）

本仓库的授权按**包**划分，不是整仓一刀切。

## 规则

| 范围 | 协议 |
| --- | --- |
| 所有**非 vendor 包** | **GPL-3.0-or-later** |
| `packages/core/parser` | **MIT**（包内独立声明的例外） |
| `packages/vendor/*` | 各自上游协议（见包内 `LICENSE`） |

**判据是「包内是否自带协议」**：

- 包目录下有 `LICENSE` / `COPYING` 文件，且 `package.json` 声明了 `license`
  —— 以包内声明为准，不受本文件影响。
- 其余非 vendor 包一律视为 **GPLv3（GNU General Public License v3.0 or later）**，
  全文见仓库根 [LICENSE](LICENSE)。

## 引用本项目的人需要知道什么

如果你引用、修改、或以任何方式分发本仓库中**按 GPLv3 授权**的包，你需要遵守 GPLv3，
其中包括（但不限于）：

- 分发二进制/目标代码时，必须同时提供**完整对应源码**；
- 基于这些代码的衍生作品，分发时也必须以 GPLv3 授权；
- 保留版权声明与协议文本；
- 不得附加额外限制。

完整的权利与义务以根目录 [LICENSE](LICENSE) 的 GPLv3 全文为准，上面的概括不能替代它。

## 例外清单

### `packages/core/parser` —— MIT

该包独立以 MIT 协议开源，不适用上表的 GPLv3 规则。使用时按 MIT 条款：
保留版权声明与许可声明即可，无源码开放义务、可闭源衍生。

### `packages/vendor/pages` —— MIT

包名 `@lybx-leyw/dsh-pages`。上游为 DSH 页面框架，本仓 vendored 后按 MIT 分发。
版权：lybx-leyw and zju-workbench contributors。

### `packages/vendor/paper-reader` —— MIT

包名 `@ggboy123/dsh-paper-reader`。上游论文阅读器，MIT 协议。
版权：GGboya。本仓对它的改动记录在包内 `PATCHES.md`。

## 上游归属

部分包 vendored 了采用 MIT 协议的第三方代码，这些归属记录在各自的
`ATTRIBUTION.md` 里，**不影响上面按包划分的协议**：

| 包 | 上游 | 上游协议 |
| --- | --- | --- |
| `packages/core/classroom-*`（10 个） | OpenMAIC（`@openmaic/dsl` / `geometry` / `renderer`，以及 `app/api/*` 路由） | MIT |
| `packages/source/campus` | 校园数据接入，含第三方接口形态 | 见包内 ATTRIBUTION |
| `packages/source/webvpn` | — | 见包内 ATTRIBUTION |
| `packages/core/quiz` | 题模参考 | 见包内 ATTRIBUTION |

换句话说：**这些包整体仍是 GPLv3**，只是其中来自 MIT 上游的部分保留了
原作者的署名与 MIT 条款（MIT 与 GPLv3 兼容，可以这样组合）。

## 为什么是 GPLv3

本项目是面向校园场景的开放工具，选择 GPLv3 的意图是：使用者可以自由使用、
修改、再分发，但**改动必须回流**，避免有人拿这套东西做出闭源的商业版本
再反过来限制学生。

## 关于「or later」

`GPL-3.0-or-later` 表示你可以按 GPLv3，也可以按自由软件基金会后续发布的
更新版本使用。若你希望锁定为 GPLv3 本身，以 `GPL-3.0-only` 为准 ——
就本项目当前意图而言，两者都可以接受。

## 联系方式

协议相关问题请开 issue。
