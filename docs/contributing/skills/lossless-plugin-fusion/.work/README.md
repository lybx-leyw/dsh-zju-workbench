# 无损融合 · 工作记录索引

> 这个目录放**过程产物**：实施清单、裁决、溯源报告、覆盖度审计、缺口清单、遗弃记录。
> 接手的人从 [`HANDOFF.md`](HANDOFF.md) 开始读。

最后更新：2026-11-11

---

## 先读这四份

| 顺序 | 文件 | 看什么 |
| --- | --- | --- |
| 1 | [`HANDOFF.md`](HANDOFF.md) | **现状、分工、还剩什么、接手须知** |
| 2 | [`coverage-gaps.md`](coverage-gaps.md) | **还差什么**（唯一权威的缺口记录） |
| 3 | [`abandoned.md`](abandoned.md) | **决定不要什么**（遗弃记录 + D1–D21 落地核对 + 承接方核查） |
| 4 | [`zju-assistant-impl-plan.md`](zju-assistant-impl-plan.md) | 整体清单 + 裁决汇总（D1–D21） |

**为什么缺口与遗弃要分两份**：一份记「要做没做」，一份记「决定不做 + 依据」。
混在一起时，「不做」很容易被误读成「不用做」，而过一段时间就没人记得当初的理由了。
本项目已经踩过三次这个坑（见 `coverage-gaps.md` 第五节、`abandoned.md` 第一节末）。

---

## 裁决与决策

| 文件 | 内容 |
| --- | --- |
| [`zju-assistant-impl-plan.md`](zju-assistant-impl-plan.md) | 实施清单；第 32 行起是**裁决汇总 D1–D21** |
| [`abandoned.md`](abandoned.md) | **D1–D21 逐条落地核对**（哪条真落地、哪条只落了一半） |
| [`zju-assistant-decisions.md`](zju-assistant-decisions.md) | 裁决的推理过程与备选方案 |
| [`zju-assistant-qa-approval.md`](zju-assistant-qa-approval.md) | 审批服务溯源（宿主 `ctx.approval` 的契约） |
| [`campus-split-plan.md`](campus-split-plan.md) | `source/campus` 拆成 `xuezai` + `pta` 的七步方案 |

---

## 覆盖度审计

| 文件 | 内容 |
| --- | --- |
| [`coverage-audit-batch-a.md`](coverage-audit-batch-a.md) | 批次 A：`zdbk` / `cc98` / `tyys` / `xuezai`（76 条 provides） |
| [`coverage-audit-batch-b.md`](coverage-audit-batch-b.md) | 批次 B：`lab` / `pta` / `sztz` / `xxt` / `classroom` + 四小包（71 条） |
| [`coverage-gaps.md`](coverage-gaps.md) | **两份审计的汇总结论 + 自查缺口 + 本轮实测** |

审计的核心发现：**覆盖率是假的**。表面 87–93%，但「名对了、功能废了」的条目
在实机上一个请求都发不出去。已修 8 处（见 `coverage-gaps.md` 第零、零之二节）。

⚠️ **本轮（2026-11-11）又查出 7 处同类断裂**（Y-7 ~ Y-13，`coverage-gaps.md` 第八节）：
源头是那 8 处的验证只做到 source 边界，工具层传的参数从来没测过。
**`node scripts/probe-write-contract.mjs` 一跑：22 条探针里 8 条不通（19 个动作里 8 个在真实调用路径上不可用）。**

⚠️ **两份审计只覆盖 147 条 provides（14 个数据模块）**。`doc`（4 条）与 `zjuam`（3 条）
没被任何审计碰过：`doc` 有 3 条完全没有承接方，`zjuam` 的 `session status` 是真实缺口
（`coverage-gaps.md` 第九节 Z-1 / Z-2）。

---

## 逐包溯源（融合前的事实调查）

| 文件 | 内容 |
| --- | --- |
| [`zju-assistant-inventory.md`](zju-assistant-inventory.md) | 上游资产总览（⚠️ 第 39 行的 `zjuam` 判「无需」已被推翻；`doc` 整块不在表里） |
| [`zju-assistant-entry-map.md`](zju-assistant-entry-map.md) | 入口映射 |
| [`zju-assistant-fusion.json`](zju-assistant-fusion.json) | 逐文件融合映射（1127 行，机器可读） |
| [`zju-assistant-trace-1-tools.md`](zju-assistant-trace-1-tools.md) | 溯源 1：工具注册 |
| [`zju-assistant-trace-2-approval.md`](zju-assistant-trace-2-approval.md) | 溯源 2：审批 |
| [`zju-assistant-trace-3-preset-skill.md`](zju-assistant-trace-3-preset-skill.md) | 溯源 3：preset 与 skill 机制 |
| [`zju-assistant-trace-4-slots.md`](zju-assistant-trace-4-slots.md) | 溯源 4：页面挂载槽 |
| [`zju-assistant-trace-5-campus.md`](zju-assistant-trace-5-campus.md) | 溯源 5：`source/campus` 拆包 |
| [`zju-assistant-source-tool-split.md`](zju-assistant-source-tool-split.md) | 读写分层方案 |
| [`zju-assistant-source-progress.md`](zju-assistant-source-progress.md) | 各数据源进度（⚠️ 停在「4/14 完成」，已过期） |

---

## WebVPN（独立计划）

| 文件 | 内容 |
| --- | --- |
| [`zju-assistant-webvpn-plan.md`](zju-assistant-webvpn-plan.md) | W1–W8 阶段计划 |
| [`zju-assistant-webvpn-coverage.md`](zju-assistant-webvpn-coverage.md) | 覆盖度与风险备注 |

⚠️ 该计划有两项**未解除的风险**：真实校外网络从未验证（R-1）；
`setWebvpnSession` 当前无人调用，校外场景 `source/http` 仍抛 `WEBVPN_REQUIRED`（R-3）。

---

## 质量与验收方法

| 文件 | 内容 |
| --- | --- |
| [`acceptance-checklist.md`](acceptance-checklist.md) | 验收清单 |
| [`acceptance-baseline-tyys-notice.md`](acceptance-baseline-tyys-notice.md) | `tyys` / `notice` 的验收基线 |
| [`source-package-checklist.md`](source-package-checklist.md) | 单个数据源包的完成标准 |
| [`source-metrics-method.md`](source-metrics-method.md) | 怎么核对数字（**每个数字要用两种方法验**） |
| [`parallel-dispatch-rules.md`](parallel-dispatch-rules.md) | 派子代理时的规则与踩过的坑 |
| [`audit-yjsy.md`](audit-yjsy.md) · [`audit-chalaoshi.md`](audit-chalaoshi.md) · [`audit-ebook.md`](audit-ebook.md) · [`audit-cnki.md`](audit-cnki.md) | 四个包的逐个审核记录 |

---

## 三条要记住的教训

1. **把自己判断的「不做」写成了「裁决」**（`coverage-gaps.md` 第五节）。
   现在的规矩：注释里不许出现「不做 / 丢弃 / 不搬运」，除非能指向一条编号裁决。
   没做就写「尚未实现」并记进缺口清单。

2. **「引用一条裁决」不等于「问题已解决」**（`abandoned.md` 第三节）。
   D21 说下载归 core，core 里 28 个包零命中；D9 说邮箱拆 4 个包，3 个没建；
   D11 说工具不要进 profile（对的），但 preset 也没建 → 22 条写能力没有入口。

3. **测试通过 ≠ 调用路径能走到底**（`coverage-gaps.md` 第八节）。
   工具层的测试用假 source、source 层的测试按 source 的写法给参数，
   两层之间那道缝从来没测过。**修完写操作，必须用工具层真实传的参数再走一遍。**

