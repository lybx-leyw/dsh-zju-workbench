# dsh-radar-campus-zone —— 候选骨架

> ## ⚠ 候选骨架：**未评审 · 未接入 profile · 不可直接使用**
>
> 本目录由 `dsh-ecosystem-radar` 自动生成，**仅用于人工评审**。
> 这不是一个可用插件：`src/index.js` 是空实现，`TODO` 未落实。
> **请勿**把它加入任何 profile，**请勿**在真实环境挂载。
> 评审通过后才可继续实现；驳回则整目录删除。

---

## 上游

| 项 | 值 |
| --- | --- |
| 仓库 | [0x000005/better-zdbk](https://github.com/0x000005/better-zdbk) |
| 名称 | **ZJU 选课网页增强**（`@name` 原样） |
| 许可证 | **MIT** ✅（GitHub `license.spdx_id = MIT`；根目录有 `LICENSE`，1060 B） |
| 作者 | 上游 `package.json` 无；用户脚本头 `@author HZR` |
| Stars | ★3（fork 0，**建仓与唯一一次 push 同日：2026-09-15**） |
| 语言 | JavaScript |
| 规模 | 仓库**只有 3 个文件**：`LICENSE` / `README.md`（35 B，几乎为空）/ `zdbk.user.js`（**661 KB**，8706 行） |
| 形态 | **不是 DSH 插件**，也**未发布到 npm** —— 单文件油猴脚本（B 类，只能「能力提取」） |
| 运行位置 | `@match *://zdbk.zju.edu.cn/jwglxt/xsxk*`，`@run-at document-start` |

## 集成方式

**B 类 · 能力提取 + 封装**（无上游 DSH 依赖，也没有 npm 包可锁版）。

> **强化式集成**，不是「全新功能」。
> 本包不新增面板，只给「今天」页（`dsh-zhiyun-page-today`）**已有的课表行**
> 补一层「这行地点字符串属于哪个校区」的语义。

### 只取这一层

| 取 | 不取 |
| --- | --- |
| 地点字符串 → 校区归属（`isCampusMismatch` 的判定口径） | 整站 UI 改写：课程卡片重排、主题色板、列宽拖拽、批量展开 |
| 校区别名表 `campusAliases`（`紫金港 ⊃ 银泉`） | 「隐藏冲突课程 / 隐藏余量不足课程」—— 依赖 zdbk 页面 `td` class 与列序 |
| 「本节次是否都在本校区之外」的**聚合**思路 | 页面注入、`unsafeWindow`、`GM_getValue/GM_setValue` 持久化 |

理由：后者全是 **对 zdbk 选课页的 DomPatch**；本仓课表来自 `dsh-zhiyun-omni` 的**接口层**
（`payload.schedule`），没有可 patch 的页面。搬进来等于在本仓重建一个选课页 —— **重复且无增益**。

## 强化了哪个现有功能

**「今天」页的课表行** —— `packages/dsh-zhiyun-page-today/src/client.jsx`：

```js
function place(entry) {
  return [entry.roomName, entry.teacherName].filter(Boolean).join(' · ');
}
```

地点是 `roomName` **原文**。本仓侧没有任何校区归属：

- `packages/dsh-zhiyun-omni/src/platforms/zdbk/parse.ts` 只有 `location: rawLocation || null`；
- 全仓 `紫金港 / 玉泉 / 西溪 / 华家池 / 海宁 / 舟山` 只在 `PERIOD_TIMES` 的注释「紫金港常规作息」里出现过一次；
- `AGENTS.md` 所述「学校/校区/楼栋」尚无数据层。

**强化式集成三条同时成立：**

1. **仍是同一个面板** —— 消费者仍是「今天」页，`place(entry)` 多解析出一个校区标签，不新增插槽。
2. **功能仍相似正交** —— 现有是「把课表折成 现在 / 接下来 / 已结束」；新增的是同一行的地点语义（要不要赶路）。
3. **底层多调了更优质实现** —— 上游已有「校区 ↔ 楼栋别名 + 全部节次在外」的显式判定，本仓为 0。

## 已知风险（评审必须逐条裁决）

1. **★3、单日 push、README 35 字节** —— 这是一个**刚建的个人脚本**，没有 users、没有 issue、没有后续迭代。
   许可证 MIT 明确 ✅，但「经过检验」谈不上。**是否值得为一条别名映射引入上游，存疑。**
2. **别名表只有一条** —— `campusAliases: { 紫金港: [银泉] }`。`东1/东2/西1/西2/段1/段2/蒙民伟/建工` 等
   楼栋名**都不含校区名**，上游判定在这些地点上会**直接判成「非本校区」→ 系统性误报**。
   本包**不得照抄**这个口径：`isHomeCampus` 必须有 `null`（判不了）这一档，且 UI 上与 `false` 可区分。
3. **楼栋表是数据不是代码** —— 要真想可用，需要一张「校区 → 楼栋前缀」表。这张表的**来源与版权**
   不能默认继承代码的 MIT，须单独裁定；在表建立之前，本包只能输出 `exact` / `unknown`，**不得猜**。
4. **「本校区」从哪里来** —— 本仓没有用户常住校区字段。**建议**先走「不判定本校区，
   只输出校区 + 相邻两节课是否跨校区」，这条路**不需要任何用户配置**，见 `src/index.js` TODO-2。

## 目录

```
package.json        # 无 dependencies（B 类）、dsh.bundle.patch 指向 cordis.patch.yml
cordis.patch.yml    # 仅 insert 本包，不触碰他人条目
src/index.js        # 占位 + TODO（classifyZone / buildCampusTable 的形状）
src/upstream.js     # 上游形状记录（无可锁版包，故不做实例封装）
OWNERS              # Owner: shared
```
