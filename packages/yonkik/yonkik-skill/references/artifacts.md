# 产物格式

机读文件用 JSON（Node 原生解析，零依赖）；人读 WIKI 用 Markdown。
agent 快速加载靠 JSON，人审查靠 WIKI，两者内容保持一致。

下文 JSON 均为结构示例，域名用 `example.edu` 占位（非真实目标），实际值来自探索。

## sites/<key>/site.json

```json
{
  "key": "lib.example.edu",
  "origin": "https://lib.example.edu",
  "via": null,
  "requires": [],
  "rateLimit": {
    "minIntervalMs": 2000,
    "concurrency": 1,
    "source": "default",
    "evidence": "robots.txt 404，无 API 文档，取保守默认（2026-11-17）"
  },
  "auth": {
    "type": "cas",
    "loginUrl": "https://passport.example.edu/login",
    "stateFile": "state.json",
    "credentialKey": "campus-sso"
  },
  "notes": "会话约 2 小时过期；下载链接 token 有效期 10 分钟"
}
```

- `origin`：实际可达的基址（WebVPN 站填包装后的 URL）。
- `via`：直连为 null；WebVPN 见 webvpn.md。
- `requires`：前置站点 key（网关/IdP），编排选站用；lib 不读此字段。
- `auth.type`：`cas | form | token | none`。`credentialKey` 缺省 = key。
- `stateFile` 相对站点目录；lib 自动导入其中 cookie。

## sites/<key>/endpoints.json

```json
{
  "site": "lib.example.edu",
  "updatedAt": "2026-11-17T12:00:00Z",
  "verified": [
    {
      "id": "search-books",
      "method": "POST",
      "path": "/opac/ajax/search",
      "purpose": "图书检索",
      "params": { "keyword": "string", "page": "int, 从 1 起" },
      "auth": "cookie",
      "responseShape": "{ total, items: [{id,title,author,link}] }",
      "sample": "keyword=三体 page=1 → total=42",
      "script": "crawler.mjs#search",
      "notes": "page 超过 total/20 返回空 items 而非报错"
    }
  ],
  "unverified": [
    {
      "id": "reserve-book",
      "method": "POST",
      "path": "/opac/ajax/reserve",
      "suspected": "write",
      "reason": "UI 文案为「预约」，疑似创建预约记录，未调用",
      "source": "详情页按钮 XHR 抓包"
    }
  ]
}
```

- verified 只收**单发验证过且语义只读**的接口。
- unverified 是候选区：疑似写、语义不明、401/403 的都放这里，写清原因。
  下次会话从这里继续，而不是重新发现。

## sites/_index.json（单一索引：依赖图 + 队列 + 资产目录）

triage 写入 pending 节点，深探后更新为 done。选站、复用、续探都读它。

```json
{
  "sites": {
    "webvpn.example.edu": {
      "status": "done",
      "type": "gateway",
      "requires": [],
      "origin": "https://webvpn.example.edu",
      "summary": "WebVPN 网关，CAS 登录，解锁内网站",
      "exploredAt": "2026-11-17",
      "endpointCount": 2,
      "profile": {
        "facets": [
          {
            "covers": "内网站点 WebVPN 包装访问 / CAS 登录",
            "confidence": 3,
            "lastVerified": "2026-11-17",
            "evidence": "endpoints.json verified: wrap-url, cas-login"
          }
        ]
      },
      "skipLog": [],
      "wiki": "sites/webvpn.example.edu/wiki.md",
      "script": "sites/webvpn.example.edu/crawler.mjs"
    },
    "jw.example.edu": {
      "status": "pending",
      "type": "教务",
      "requires": ["webvpn.example.edu"],
      "signals": { "login": "cas", "taskRelevance": "查课表成绩", "rateLimitHint": "网关限流" },
      "origin": "https://webvpn.example.edu/http/<hex>/"
    },
    "opac.example.edu": {
      "status": "blocked",
      "blockedReason": "独立账号，SSO 不适用，等用户提供凭据",
      "requires": [],
      "signals": { "login": "form" }
    }
  }
}
```

- `status`：`pending | exploring | done | blocked`。blocked 必附 `blockedReason`。
- `requires`：前置站 key；选站前提是它们 done（或资产就绪）。
- done 节点带 wiki/script 路径与 endpointCount；pending 节点只有 triage 信号。
- `profile.facets`：站点覆盖的信息/接口面。`confidence` = 独立探索印证次数，
  排除决策的硬下限是 ≥ 2；`lastVerified` 久远则置信衰减，跳过前先廉价复探。
  每次深探回传刷新 facets。`evidence` 指向 endpoints.json 的 verified 条目。
- `skipLog`：相关性路由的跳过留痕（问题摘要 + 高/中/低读数 + 依据），可逆可查。
- 分数不预存：相关性是「画像 × 当前问题」的临时读数，选站时生成（见 orchestration.md 第 6 节）。
- 复用第一入口：先读它，done 命中再读对应 wiki；pending/blocked 进编排循环。

## sites/_sso.json（SSO 家族图谱）

```json
{
  "families": {
    "campus-cas": {
      "idp": "passport.example.edu",
      "loginUrl": "https://passport.example.edu/login",
      "credentialKey": "campus-sso",
      "members": ["lib.example.edu", "jw.example.edu"],
      "sessionScope": "网关域 cookie 对成员站免登（实测）",
      "evidence": "libweb 302 → passport，登录一次后 jw 带 state 直接 200（2026-11-17）"
    }
  }
}
```

一个 family = 一套 IdP + 一个凭据键 + 成员站列表。探明一个成员站即登记，
其余成员站复用凭据键并先做免登试探（见 webvpn.md）。`evidence` 必填。

## sites/_playbook.md（跨站可迁移经验）

per-site wiki 是纵向知识；playbook 是横向的、可迁移的模式。每条格式：

```markdown
## <模式名，如「example.edu WebVPN hex 编码规则」>
- 模式：<可迁移的做法/规律>
- 证据：<实测摘录，请求/响应/解码结果>
- 适用范围：<如 *.example.edu 的 WebVPN 包装；不是「所有大学」>
- 来源站：<key>，<日期>
```

护栏：单站观察不等于普适规律，适用范围必须收窄到有证据支撑的范围。
playbook 是给模型读的判断材料，不是规则引擎；采用前核对适用范围是否匹配本站。
阶段 0 读它，阶段 6 写回它。

## sites/<key>/wiki.md 模板

```markdown
# <站点名> (<key>)

## 概览
一句话说清这站能拿到什么、入口 URL、是否 WebVPN。

## 鉴权
方式（CAS/表单/token）、登录入口、会话寿命实测、state.json 刷新方法。
不写任何密码/cookie 值。

## 限流
数值 + 证据原文 + 抓取日期。触发过的 429 记录。

## 接口
表格：id | method path | 用途 | 关键参数 | 脚本操作名。
与 endpoints.json 一致。

## 坑
302 陷阱、必填参数、token 时效、分页边界、编码问题……

## 脚本用法
node crawler.mjs --list
node crawler.mjs search --keyword 三体 --out result.json

## 待探（unverified）
候选接口与疑似语义，下次从这里继续。
```

## crawler.mjs 约定

- 从 `skills/site-recon/assets/crawler.mjs` 复制，填充 `ops`。
- 每个 op 对应一个 verified 只读接口，命名用动词（search/get/download）。
- 参数化：不硬编码关键词、ID、过期链接。
- 下载 op 用 `client.download(path, dest)`；token 现取现用。
- CLI：`node crawler.mjs <op> [--参数 值] [--out 文件]`，`--list` 列操作。
- lib 不提供 put/patch/delete——脚本能力面即安全边界。

## secrets/intake.json（用户填写的合并入口，gitignored）

聊天只收目标；网址与凭据全填这里。模型从 `intake.example.json` 生成，含填写指引：

```json
{
  "_说明": "右键→打开方式→记事本，只改引号里的内容，填完保存",
  "网站": ["https://站点1.example.edu", "https://站点2.example.edu"],
  "凭证": [
    { "描述": "学校统一身份认证，键一=账号，键二=密码", "键一": "<账号>", "键二": "<密码>" },
    { "描述": "某站 API key，键一=key", "键一": "<key>" }
  ]
}
```

- 模型在聊天里只给填写指引，不索要数据；用户本地填完保存。
- 模型读 intake.json 校验 JSON（坏了指出第几行怎么修，不回显密钥），再拆分：
  凭证 → `credentials.json`（键 = credentialKey），网站 → `_index.json` 进 triage。
- 凭据↔网站映射不要求用户填，由探索发现。

## secrets/credentials.json（落盘凭据，gitignored）

由模型从用户填写的 `secrets/intake.json` 拆分写入（**数据不经聊天**），键 = credentialKey：

```json
{
  "campus-sso": {
    "描述": "学校统一身份认证（一卡通），键一=账号，键二=密码",
    "键一": "<账号>",
    "键二": "<密码>"
  },
  "books-api": { "描述": "某电子书站 API key，键一=key", "键一": "<key>" }
}
```

- 通用键袋，字段不固定：`client.credentials()` 原样返回，模型按 `描述` 解释每个键。
- 凭据↔网站的映射不在这里，由探索发现并记入 `_sso.json` / `site.json.auth`。
- 用户填 `secrets/intake.json`（`凭证` 数组 + `网站` 列表）；模型拆分：凭据进本文件，网址进 `_index.json`。
- 模型读文件校验、不回显值；绝不索要明文密钥进聊天（见 SKILL.md「凭据与网站入口」节）。