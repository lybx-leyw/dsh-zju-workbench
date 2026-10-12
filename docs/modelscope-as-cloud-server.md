# 巧用魔搭 Studio 当"云服务器"

本文记录本工作台**不引入任何云厂商**、仅靠魔搭（ModelScope）Studio 拿到一个可用后端
的完整做法。它的用途目前只有一个：收下用户在工作台「反馈」页填的需求与追踪反馈。

面向三类读者：想知道**为什么这么干**的决策者、要**照做一遍**的维护者、要**改动它**的开发者。

---

## 1. 要解决什么问题

工作台在每个用户机器上本地运行（DSH 宿主 + 本仓插件包），本地没有"公共讨论区"。
可需求收集这件事天然需要一个**大家都能写、大家也都能读**的地方：

- 用户在工作台里发需求、在别人的需求下评论 —— 不跳外站、不注册、不登录；
- 所有人都能读回同一份讨论串（不是只有维护者能看的私信箱）；
- 维护者/机器人能主动回帖，把"我们打算怎么做"公开写在同一条下面。

一开始评估过三条路，全被否掉：

| 方案 | 否决原因 |
| --- | --- |
| 第三方表单（如腾讯问卷） | 要求用户跳站/登录，体验割裂，与"面板内直接填"冲突 |
| 自建 Supabase（或同类 BaaS） | 账号、密钥、客户端注入 key，公开仓库里都是负担与风险 |
| 写进本地文件当"收件箱" | 本地文件传不回维护者，等于没收 |

结论：需要一台**极小的、公开可写、无身份**的收集端。魔搭 Studio 恰好免费提供。

---

## 2. 为什么选魔搭 Studio

- **免费且不需要额外账号体系**：用现有的魔搭账号即可，不新增付费云厂商。
- **支持 `docker` 类型应用**：可以跑任意服务端（我们只用 Python 标准库）。
- **公网可达 + CORS 放行**：Studio 的 `.ms.show` 域名对浏览器请求返回
  `Access-Control-Allow-Origin: *`，于是一个**纯前端**的工作台无需代理即可直接 POST。
- **成本可接受**：数据重启可能丢 —— 这一点已确认接受（见第 6 节的风险边界）。

> 一句话：**不把它当部署平台，只把它当一台"能收 POST、能落文件"的云服务器。**

---

## 3. 整体链路

```text
用户在「反馈」页发需求 / 评论
        │  POST /feedback          { kind, title, detail, name }
        │  POST /feedback/comment  { issue, body, name }
        ▼
魔搭 Studio（leywlybx/zju-workbench-alpha，docker 服务，0.0.0.0:7860）
        │  追加一个事件
        ▼
/mnt/workspace/feedback.jsonl   ← append-only 事件日志（唯一真值）
        │
        │  GET /feedback：fold() 合成讨论串，所有人读同一份
        ▼
工作台「反馈」页的 issue 列表与讨论串

维护者 / 机器人（**任何人都能当**）
        │  POST /feedback/robot   { issue, body }
        │  POST /feedback/status  { issue, status }
        ▼
同一条日志里追加 comment / status 事件 → 官方答复出现在讨论串里
```

关键点：**只有一处真值**。条目、评论、状态全在这条事件日志里，读回时现合成。
仓库里**不再有**一份静态公开板 —— 两份来源会立刻开始互相打架（服务端的条目改了，
仓库那份不知道）。代价要认：实例重启可能丢数据，见第 6 节。

**没有权限体系，也不打算有。** 官方回帖（`/feedback/robot`）与状态推进（`/feedback/status`）
和发需求一样是公开的：谁拿着 `robot/SKILL.md` 谁就能以机器人身份说话。这是**刻意**的 ——
这是个 demo 级反馈板，「谁想处理评论都行」比「防住冒充」重要得多。代价是任何人都能把
别人的需求标成「不采纳」，已知并接受（见第 6 节）。

---

## 4. 部署细节（照做版）

### 4.1 目录

```text
deploy/feedback-service/
├── server.py      # 收集服务本体，Python 标准库，零第三方依赖
└── Dockerfile     # python:3.12-slim + COPY server.py
```

### 4.2 Studio 配置

| 项 | 值 |
| --- | --- |
| 目标仓库 | `leywlybx/zju-workbench-alpha` |
| 类型 | `docker` |
| 分支 | `master` |
| 硬件 | `platform/2v-cpu-8g-mem`（免费档足够） |
| 可见性 | 公开 |
| 监听 | `0.0.0.0:7860`（**平台要求，8080 被占用**） |

### 4.3 服务端约束（踩过的坑）

- **只用标准库**：不引 FastAPI/uvicorn。平台对依赖体积与长阻塞敏感，镜像越小启动越稳。
- **监听 `0.0.0.0:7860`**：写死 `127.0.0.1` 或换端口都会被平台判定不健康。
- **持久化目录 `/mnt/workspace`**：平台声明的持久化路径；本地调试时退回到
  `deploy/feedback-service/data/`（该目录已加进 `.gitignore` —— 里面是真实用户反馈，
  **不是代码**，被 `git add -A` 带上就是公开仓库的信息泄露）。
- **端口从环境变量读**：`FEEDBACK_PORT` 默认 `7860`，便于本地复现。
- **没有令牌/密钥要配**：所有端点（含机器人回帖与状态推进）都无需凭证，
  所以部署时不需要设置任何 secret。

### 4.4 数据形状：append-only 事件日志

一行一个**事件**（不是一行一个 issue），共三种：

```json
{"t":"issue",   "id":"F-003","kind":"new","title":"…","detail":"…","name":"访客-7f3a","at":1700000000}
{"t":"comment", "issue":"F-003","body":"…","name":"访客-1","at":1700000100,"cid":"F-003-c…"}
{"t":"status",  "issue":"F-003","status":"done","at":1700000200}
```

读的时候 `fold()` 从小到大扫一遍，合成 `{id, kind, title, detail, name, at, status, comments[], last}`。

**为什么是事件流而不是"改一行"**：这条日志可能被并发写（多个用户同时评论），
追加是原子的、改中间某一行不是。状态推进也只是再加一个事件，不动历史 ——
于是"这条为什么变成 done 了"永远能回溯。代价是读要 fold，但量级（几千条）无所谓。

### 4.5 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/health` | 健康检查，返回 `{"ok": true, "issues": N, "events": M}` |
| `GET` | `/feedback` | 读回全部讨论串（已 `fold`，按最后活动倒序）；带 `?pending=1` 只给待回应的 |
| `POST` | `/feedback` | 发一条新需求，服务端分配编号 |
| `POST` | `/feedback/comment` | 在某条下评论 |
| `POST` | `/feedback/robot` | 以「反馈机器人」身份回帖（**公开**） |
| `POST` | `/feedback/status` | 推进状态 `open/done/declined`（**公开**） |
| `OPTIONS` | `*` | CORS 预检 |

**没有任何端点需要凭证。** 这是刻意的设计，不是漏配。

请求体（`POST`，JSON）：

```json
{ "kind": "new", "title": "希望支持导出课表", "detail": "……", "name": "访客-7f3a" }
{ "issue": "F-002", "body": "我也想要", "name": "访客-1" }
{ "issue": "F-002", "body": "方案如下……" }                      // 机器人回帖，无需凭证
```

- `kind`：`new`（新需求）或 `track`（追踪已有条目，编号写在标题里）。
- `name`：**1~24 个字母/数字/下划线/连字符**（`访客-7f3a` 这种），必填。
  两端各有一份同形状的规则，**注意 JavaScript 的 `\w` 只认 ASCII**（Python 默认是
  Unicode）—— 直接照抄 `[\w-]` 会让浏览器把默认生成的中文笔名判成非法，这条踩过。
- **字段白名单**：只认上面这些键。出现白名单外的字段**直接拒绝**（返回 400），
  而不是静默丢弃 —— 这样任何身份字段泄漏会在第一次调用就暴露。
- **限长**：单条请求体 32KB 上限；标题 200 字符、正文 4000、评论 4000；
  上限 2000 条需求 / 20000 个事件（评论比需求更容易被刷）。

### 4.6 客户端接线

工作台侧只需一个常量（`packages/dsh-zhiyun-page-feedback/src/board.js`）：

```js
export const FEEDBACK_ENDPOINT = 'https://leywlybx-zju-workbench-alpha.ms.show';
```

---

## 5. 最关键的一条经验：`.ms.show` 有 UA 过滤

这是整件事从"以为做不到"翻盘成"能做"的原因，单独记一条。

- 用**裸 curl** 请求 `https://<studio>.ms.show/...`，会拿到 **403**，且返回体是一句
  误导性的"请使用 API 地址"提示 —— 看起来像是网关强制要 token，于是很容易
  误判成"此路不通"。
- 但只要带一个**浏览器 User-Agent**，同一个地址就返回 **200**，并带上
  `Access-Control-Allow-Origin: *`。

```bash
# 403，误导信息
curl -s https://leywlybx-zju-workbench-alpha.ms.show/health

# 200，正常返回
curl -s -H "User-Agent: Mozilla/5.0" \
     https://leywlybx-zju-workbench-alpha.ms.show/health
```

**教训**：判定一个平台"不可用"之前，先用浏览器 UA 复验一遍 —— 很多平台的
边缘防护只对疑似爬虫的请求见效，对真实浏览器（也就是我们的用户）完全放行。

**但这不等于"对我们无害"**：页面跑在浏览器里，确实自带 UA；而 `robot/feedback.py`
是 **Python 工具，不是浏览器** —— urllib 默认自报 `Python-urllib/3.x`，于是它请求线上
**每条命令都 403**。这个坑跑遍本地测试都看不出来（本地服务没有那层网关），
只有连真服务才暴露，部署当天就踩到了。所以工具里显式带一个浏览器形态的 UA
（`USER_AGENT` 常量），并有断言盯着每个请求都带上它。

---

## 6. 安全与隐私边界

收集端是**公开可写**的（这正是它的用途 —— 谁都能发需求、谁都能评论），
因此边界靠四条守住：

1. **限长 + 字段白名单**：抵御乱写与灌库，见 4.5。
2. **不存任何身份信息**：不记 IP、不记 User-Agent、不接受真名。服务端 `clean_issue()` /
   `clean_comment()` 会**拒绝**含未知字段的请求。这是仓库公开化约定的延伸 ——
   讨论串的内容会被所有人读到。
3. **署名只有一个本地随机笔名**：`访客-7f3a`，由浏览器生成、存在本机、可重置。
   它主要解决"讨论串里分不清谁在说话"，而不是用来认人。收件端另有 `realName`、
   `studentId`、`email` 等禁区字段守卫。
4. **没有权限体系**：官方回帖（`/feedback/robot`）与状态推进（`/feedback/status`）
   和发需求一样公开 —— **谁拿着 `robot/SKILL.md` 谁就能用**。这是刻意的：
   这是个 demo 级反馈板，「谁想处理评论都行」比「防住冒充」重要。
   唯一还要求署名的是**普通评论**：不签名就等于可以冒充维护者，而署名成本只是
   一个本地随机笔名。

**已知并接受的风险**：

- 数据落在 `/mnt/workspace`，**重启可能丢**。当作社区的可容忍代价；不要拿它存关键数据。
  丢数据时页面会显示成空社区并说明是连不上，而不是装作"还没有人提过"。
- Studio 的删除**只能在网页控制台做**，没有编程接口。
- 公开可写意味着可能被刷。当前靠限长与条数/事件上限兜底；若被滥用，最坏情况是
  重启实例清空重来。
- **任何人都能以「反馈机器人」身份发言，也能把别人的需求标成「不采纳」。**
  已知并接受 —— 想处理评论的人本来就不该被挡在门外。

---

## 7. 本地复现与验证

服务端可以在本地直接跑（无需 Docker）：

```bash
cd deploy/feedback-service
FEEDBACK_PORT=7860 python server.py
```

验证链路（把域名换成你的 Studio）：

```bash
UA="User-Agent: Mozilla/5.0"
BASE=https://leywlybx-zju-workbench-alpha.ms.show
JSON="content-type: application/json"

curl -s -H "$UA" $BASE/health
curl -s -H "$UA" -H "$JSON" \
     -d '{"kind":"new","title":"试一条","detail":"本地验证","name":"访客-0001"}' $BASE/feedback
curl -s -H "$UA" -H "$JSON" \
     -d '{"issue":"F-001","body":"我也想要","name":"访客-0002"}' $BASE/feedback/comment
curl -s -H "$UA" $BASE/feedback | head -c 400

# 机器人回帖：不需要令牌
curl -s -H "$UA" -H "$JSON" \
     -d '{"issue":"F-001","body":"方案如下……"}' $BASE/feedback/robot
```

单元测试：

```bash
python -m unittest tests/test_feedback_service.py     # 服务端清洗、折叠与端点行为
python -m unittest tests/test_feedback_robot.py       # 机器人工具的参数与输出契约
node --test tests/feedback.test.mjs                    # 客户端逻辑与两端契约
```

---

## 8. 换一个 Studio / 迁移时

需要改的地方只有两处：

1. 重新按第 4 节建一个 Studio（`docker` 类型、公开、`0.0.0.0:7860`）。
   没有 secret 要配。
2. 改 `FEEDBACK_ENDPOINT` 为新域名，重新构建客户端包。

服务端代码不依赖具体域名，无需改动。**数据会跟着旧实例走**（在那台实例的
`/mnt/workspace/feedback.jsonl` 里），要迁移就把它复制到新实例的同一路径。

---

## 9. 这套做法的边界

**适合**：低流量、无身份、可容忍丢失的收集类后端（反馈、埋点、简单投票）。

**不适合**：需要账号体系、需要事务一致性、需要"绝不丢数据"、或流量较大的场景 ——
那些场景请老老实实用正经托管后端（本仓另有 `cloud-service` 能力可选）。
