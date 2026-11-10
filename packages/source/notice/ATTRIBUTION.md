# 第三方来源

本包移植自 [`dsh-zju-assistant`](https://github.com/Anchorite-no/dsh-zju-assistant)
（**GPL-3.0-only**，`LICENSE` 实文 35,149 B 已核）的 `core/zju/lib/notice/`。
本仓是 GPL-3.0-or-later，与上游兼容。

上游版本记录：npm `dsh-zju-assistant@0.1.8`；`main` @ `e59b81e1c254d979402f047c6fc8e43bf30b9713`。
根 `ATTRIBUTION.md` 的条目里记着「未复制其任何源码」——**本次改造改变了那个结论**：
本包是逐文件重写，属于「含实现移植」。根条目需要同步上移，那一步不在本包的改动范围内。

## 移植了什么

上游 `notice/` 共 13 个文件、约 1052 行 TypeScript（153.8 KB，含两份 JSON）。本包把它改写为
纯 JavaScript，拆成 `src/notice.js`（纯逻辑）与 `src/index.js`（宿主入口）。

| 上游文件 | 行数 | 本仓对应物 | 性质 |
| --- | --- | --- | --- |
| `index.ts` | 389 | `src/notice.js` 的 `NoticeSource` + `selectSources` / `mergeNotices` / `keywordTerms` / `listQuery` 等 | 编排逻辑重写 |
| `sources.ts` | 64 | `src/notice.js` 的 `SOURCES` | 数据表原样搬（逐条） |
| `article.ts` | 67 | `parseArticle` / `attachmentDetail` / `isAttachment` | 算法重写（DOM 库换了，见下） |
| `identity.ts` | 89 | `normalizeProfile` / `findCollege` / `abbreviates` / `catalogInfo` | **大幅裁剪**（见「丢弃」） |
| `read.ts` | 21 | `patiently` / `withTimeout` | 算法照搬（超时值也是上游的） |
| `types.ts` | 82 | 无对应文件（JSDoc 内联到各函数） | 类型声明，JS 里不适用 |
| `adapters/webplus.ts` | 149 | `parseList` / `parseItem` / `dateOf` / `articleId` / `listColumn` | 算法重写（DOM 库换了） |
| `adapters/zdbk.ts` | 146 | `listZdbk` / `zdbkRows` / `zdbkListPage` / `withFullTitles` / `detailUrl` | 算法重写（**不复用 `source/zdbk`**，见 README） |
| `adapters/kyjs.ts` | 25 | `kyjsNotice` | 算法照搬 |
| `hosts.json` | 627 | `data/hosts.json` | **逐字节副本**（SHA-256 校验一致） |
| `colleges.json` | 3113 | `data/colleges.json` | **逐字节副本**（SHA-256 校验一致） |
| `module.json` | — | `package.json` 的 `dsh.capability` | 元数据映射（`requires` 改了，见 README） |
| `cli.ts` | — | 无对应文件 | CLI 命令面由宿主插件提供，数据源不注册命令 |

## 做了哪些改动（必须记录，否则会被当成遗漏）

1. **HTML 解析层换掉了。** 上游用 `parse5`（完整的 HTML5 树构建算法）建 DOM 并 `serialize()`；
   本仓没有、也不为这个包新拉 `parse5` 依赖。改为自带一个容错解析器（`parseHtml`）。
   它保证「标签、属性、文本、父子关系」对规整 HTML 成立，但**畸形 HTML 的隐式闭合行为**
   与 HTML5 规范有差距。这一点写在 README 的「已知限制」里，不假装等价。

2. **身份推断全部移除。** 上游 `identity.ts` 会读个人档案、必要时从教务网课表读一次学院并落盘
   30 天（`data/notice/identity.json`）。本包**不做任何推断**：`level` / `college` 由调用方注入。
   理由：有副作用的身份推断不该藏在只读数据源里（D17）。`findCollege` / `abbreviates` / `catalogInfo`
   保留（纯函数，无副作用）。

3. **已读记录不落盘。** 上游 `notice new` 写 `data/notice/seen.json`；本包把算好的 `seen` 返回，
   由调用方通过 `setSeenStore({ load, save })` 持久化。

4. **教务适配器独立重写，不 import `source/zdbk`。** 上游 `requires` 里有 `zdbk`（借它的会话）。
   本仓「tier 1 不得依赖另一个 tier 1」，所以 jqGrid 列表与详情解析在本包里独立实现，
   只共用 tier 0 的 `Transport` 与 `login/cas`。

5. **`isInternalAddress` 修了上游的两个字面缺陷。** 上游正则
   `/(?:10|127|192.168|172.(?:1[6-9]|2d|3[01]))./`：点是未转义的（`192x168` 也会命中），
   `2d` 是从 `2[0-9]` 打错的（于是 `172.20`–`172.29` 全漏）。本仓按 RFC 1918 正确实现。

6. **`parseArticle` 的「正文之前的标题窗口」改用树关系。** 上游把文章窗口 `serialize()`
   成字符串后 `indexOf` 定位正文容器、再切片取标题；本仓用「窗口里不在正文容器内的元素」
   （`within()` 判定）。语义相同，少一次序列化。

7. **`fetchFollow` 落到 CAS 登录页时不再跟跳。** 上游 `perform(url, opts, true)` 会一直跟；
   本包把「落到 CAS」当成终点返回给 `get()`，由它做委托登录或抛 `AUTH_REQUIRED`。

## 未移植（明确丢弃，附理由）

| 上游 | 丢弃理由 |
| --- | --- |
| `identity.ts` 的 `levelOf()` / `identity()` | 读个人档案 + 从教务网读学院 + 落盘 30 天 —— 有副作用的身份推断，归集成层 |
| `index.ts` 的 `Session` 类 | 它管 WebVPN 上下文与 zdbk 会话的生命周期；本仓这两件事分别归 `source/http` 的出口与调用方注入的 `request` |
| `index.ts` 的 `listSources()` 里读已读记录的 `checkedAt` | 已读记录由调用方持有；服务面仍会把它回填进结果（`setSeenStore`） |
| `cli.ts` | 数据源不注册命令；命令面归宿主插件 |
| `module.json` 的 `provides`（四个 CLI 命令名） | 改成服务方法名（`notice.list` / `view` / `new` / `sources`），CLI 是另一层 |
| `read.ts` 的 `TransportError.detail["code"] === "ETIMEDOUT"` 判据 | 本仓的传输层用 `NoticeError` 的 `TIMEOUT` / `NETWORK` 两个码，按码重试（等价） |

## 许可

上游 GPL-3.0-only → 本仓 GPL-3.0-or-later：兼容（GPL-3.0-or-later 是 GPL-3.0-only 的超集方向，
且本仓整体已按 GPL-3.0-or-later 发布其它移植自同一上游的设计）。

**不要**把本包的代码往更宽松协议的包里搬。
