# ATTRIBUTION

本包为**候选骨架**，尚未实现任何功能。以下为**计划借鉴**的来源声明（CONTRIBUTING 3.3）。

## 上游

| 项 | 值 |
| --- | --- |
| 项目 | `marioMLLL/ecnu-timetable-calendar` |
| 仓库 | <https://github.com/marioMLLL/ecnu-timetable-calendar> |
| 参考版本 | `1.9.1`（`package.json.version`） |
| 许可证 | MIT（仓库 `LICENSE` 为完整 MIT 正文，Copyright (c) 2026 marioMLLL） |
| 上游 GitHub `license.spdx_id` | `MIT` |

## 借鉴范围

| 文件 | 借鉴内容 | 方式 |
| --- | --- | --- |
| `lib/schedule-core.js` | `normalizeText()` —— 全角归一（`～—－至` → `~`、全角括号 / 逗号 → 半角、`\u00a0`、空白折叠） | 纯函数移植，保留 MIT 声明 |
| `lib/schedule-core.js` | `parseWeekSpec()` —— 「第X周」剥离、逗号切段、单双周 `parity`、区间展开、上限封顶 | 纯函数移植，保留 MIT 声明 |
| `popup.js` | `.ics` 属性写法：`VALARM`（`TRIGGER:-PT{n}M` + `ACTION:DISPLAY`）、`VTIMEZONE`（`TZID` 标准块）、`TRANSP:OPAQUE` | **仅借鉴思路**，独立重写 |

## 明确不借鉴

`content.js`、`api-hook.js`、`manifest.json`、`popup.html`、`popup.css`、`mobile/`、`vendor/`。

理由：这些是华东师大专属的浏览器扩展外壳、校方接口挂钩与品牌 UI，
与浙江大学课表面板无对应关系；搬运它们属于「简单集成」，违背本仓「强化式集成」原则。

## MIT 许可声明（移植时须随文件保留）

```text
MIT License

Copyright (c) 2026 marioMLLL

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
