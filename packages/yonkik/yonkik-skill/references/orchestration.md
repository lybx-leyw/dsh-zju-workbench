# 多站编排：triage → 贪心选站 → 子代理深探 → 读盘回传

主 agent 的职责是**维护图和队列、选站、派子代理、读盘汇总**，不亲自深探多站。
深探的上下文成本（快照、XHR、试错）留在子代理里，主 agent 只拿落盘产物。
全程串行：共享 CAS/网关的站并发会撞限流与会话争用。

## 1. Triage（O(N) 廉价试探）

对用户给的每个 URL，只发几个请求，目的是归类而非探索：

- GET `robots.txt`（限流信号）；GET `/` 记录**重定向链与最终 URL**
  （302 到 passport/IdP → SSO 信号；最终 URL 是 webvpn 包装 → 网关依赖）。
- 登录入口识别：`playwright-cli find "登录|统一身份认证|SSO|CAS|一卡通|Login"`，
  布局看不准时才 screenshot。不是每站都截图。
- 归一去重：webvpn hex 解码出源站 host（见 webvpn.md）、重定向归一，
  同一源站的 webvpn 版与直连版合并为**一个 key**，`via` 记可达路径。
- 每站产出写入 `_index.json`，`status: "pending"`，附 `type`（opac/教务/公开站…）、
  `requires`（网关/IdP 的 key）、`signals`（登录方式、限流线索、与用户任务的相关度）。

triage 本身也守安全契约与默认限流；N 个 URL 串行几个请求，成本可控。

## 2. 选择循环（每轮重估）

从 `_index.json` 选下一站，输入摆可见，判断交给模型，**不做评分公式门控**：

- **前提满足**：`requires` 里的站都已 done（或资产已就绪，如网关 state 有效）。
- **期望收益**：枢纽优先（IdP/网关解锁 K 个成员站，边际收益最高）；
  与用户当前任务相关度；playbook 可迁移度（同类站已有经验 → 成本低）。
- **增量价值**：done 站若本次任务有新候选，也值得再访一次（增量重探）。
- **相关性路由**：读站点内容画像置信度，对当前问题出高/中/低读数；
  低相关 ∧ 置信 ≥ 2 ∧ 问题在已知范围 → 跳过深探（见第 6 节）。

派出一站、读盘回传后**重新评估**：资产变了，下游的前提和价值都变了。
静态排序会错过「探完 A 发现 B 免登了」这类收益，这正是 backprop 的意义。

## 3. 子代理简报模板

主 agent 派子代理时，简报必须自包含（子代理看不到主会话历史）：

```
你是 site-recon 的站点深探子代理。先读 <repo>/skills/site-recon/SKILL.md 并遵守安全契约。
站点 key：<key>
本次任务：<用户当前任务，如「查书+电子书下载接口」>
已有资产：
- _index.json 中本站节点：<status/requires/signals 摘要>
- 适用 playbook 条目：<摘录，含证据与适用范围>
- SSO 家族：<_sso.json 相关 family；credentialKey；state 位置>
- 依赖站产物：<网关/IdP 的 wiki 关键结论、state.json 路径>
预算：几十次单发请求；任务所需接口验证可用即收工，其余记 unverified 候选。
写回契约（必须全部落盘，你的上下文会消失，磁盘是唯一回传通道）：
- sites/<key>/{site.json, endpoints.json, wiki.md, crawler.mjs}
- _index.json 本站节点更新（status、endpointCount、requires 修正）
- 可迁移经验 → sites/_playbook.md（带证据+适用范围+来源站）
- 新 SSO 成员/家族 → sites/_sso.json
- 受阻 → status: blocked + blockedReason，不要静默跳过
完成后只回一段摘要：verified/unverified 计数、关键坑、blocked 原因。
```

## 4. 读盘回传（backprop）

子代理结束后，主 agent **读磁盘产物，不读子代理转录**：

- 核对写回契约清单是否齐全；缺了让它补，或主 agent 据摘要补记。
- 更新图：新发现的 requires、SSO 成员关系、枢纽站解锁了哪些下游。
- 把 playbook 新条目纳入下一轮选站的输入。
- blocked 站：汇总原因（缺凭据/403/限流停等），**显式问用户**，不静默丢弃。
  缺凭据 → 请用户提供该站凭据或确认用 SSO 试一次（见 webvpn.md 防锁号护栏）。

## 5. 增量与终止

- 每站深探是任务 scoped 的增量（SKILL.md「增量探索」节）：本次任务接口验证
  可用即收工，候选记 unverified，下次从候选继续。不追求单次全站收敛。
- 编排循环终止：队列无 pending（全 done/blocked），或用户预算尽。
- anytime：任何时刻中断，已落盘站点即刻可复用；重启从 `_index.json` 接续。

## 6. 相关性路由：画像置信与可逆跳过

这是 MCTS 选择策略的落地：早期探索项主导（低阈值全看），证据累积后利用项主导
（高置信跳过无关站）。评分对象是「站点 × 当前问题」的相关性，是路由读数，
不是输出质量门控；读数是模型判断材料，跳过可逆、留痕，不是程序硬过滤。

**落盘的是画像，不是分数矩阵**。分数依赖问题、无法预计算；能累积的是站点
「覆盖哪些信息/接口」的内容画像（`_index.json` 节点的 `profile`，schema 见
artifacts.md）。每个 facet 带 confidence + lastVerified + 证据（指向 endpoints.json
verified 条目）。**confidence 计数**：一次独立深探在阶段 4 实际验证了该 facet 下的
接口 → +1；triage 的廉价观察不计（否则首层就虚高）。首次深探后 confidence=1，仍不可
排除；第二次独立深探印证后 =2，才达排除硬下限。每次深探回传刷新 lastVerified。

**选站时按当前问题出读数**：模型读 profile + confidence + 问题意图，判高/中/低
并记理由。「问题在已知范围」= 问题意图能映射到至少一个 facet.covers；映射不到任何
facet → 新型问题，按护栏 1 复探，不排除。跳过规则：

> 低相关 ∧ confidence ≥ 2 ∧ 问题落在画像已知范围 → 跳过该站**深探**，
> 理由记入 `_index.json` 节点 `skipLog`（问题摘要 + 读数 + 依据）。

triage 已发生，跳的是子代理深探预算，不是 triage。

**阈值随置信升**：首层（triage/首访）阈值极低，不排除任何站——初印象噪声大，
每站至少给一次廉价观察。多次探索印证「这站只有这些东西」后，排除才开始生效。

**四条防误杀护栏**：

1. **可逆**：画像陈旧（lastVerified 久远）或问题相对历史任务是新型 → 不直接排除，
   先 1–2 请求廉价复探确认再定。
2. **衰减**：衰减是模型按 lastVerified 距今时长做的判断，不是程序公式。参照站点
   内容可能变化的尺度（如学期/数月级）：超过该尺度 → 视为陈旧，排除前先复探；
   重访验证后刷新 lastVerified。陈旧画像不授权跳过。
3. **用户强制纳入**：用户点名某站 → 覆盖读数，直接探。
4. **硬下限**：单次访问的印象永不授权排除，confidence ≥ 2 才可跳过——
   「多次探索验证」的制度化。