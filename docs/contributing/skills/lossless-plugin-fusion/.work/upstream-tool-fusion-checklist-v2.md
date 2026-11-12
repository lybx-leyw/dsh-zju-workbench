# 上游 tool 融合清单 · 第二次核对（2026-11-12 晚，已两次更正）

> **这一份是当前有效的清单。** 全部数字由 `node scripts/audit-tool-coverage.mjs`
> 产出，脚本带自检（映射表引用的工具必须真实存在，否则直接退出）。
>
> **更正史**（记下来免得再犯）：
>
> 1. **第一版**说「A 类 22 条只缺 tool」—— **错的**。根因是我枚举工具名时用了
>    正则 `campus_[a-z_]+`，而工具名里有数字（`campus_cc98_read` 的 `98`），
>    于是那个 22 个 action 的 CC98 读工具在脚本里"不存在"，21 条被误报成缺口。
> 2. **第二版**改正后为 98/1/20，但当时 chaoxing / doc / zhiyun / xuezai 下载
>    / sztz 收藏这五批还没落定。
> 3. **本版**是那五批全部落地之后的结果。

---

## 一、总账

| 分类 | 条数 | 说明 |
| --- | --- | --- |
| ✅ **已有 tool 覆盖** | **113** | 工具存在且已接线 |
| ⬜ **A · 只缺 tool** | **1** | `zhiyun download` |
| 🟧 **B · source 也要补** | **5** | 见 §三 |
| ⚪ **不需要 tool** | **4** | `webvpn` 的 probe / check / url 编解码 |
| ⛔ **明确不做** | **4** | 知网 2 + PTA 开始/交卷 2 |
| ⚙️ **会话动作** | **35** | `session login/status/logout/import-cookie` |
| **合计** | **162** ✅ | 与上游 `module.json` provides 总数一致 |

**覆盖率 113/162 = 70%。**

> **核对**：113 + 1 + 5 + 4 + 4 + 35 = 162 ✅

---

## 二、本仓现有 24 个工具（实测）

| 包 | 工具 | 说明 |
| --- | --- | --- |
| `tool/zdbk` | `campus_zdbk_read` | 12 action |
| | `campus_course_select` | 3 action（写，过审批） |
| `tool/xuezai` | `campus_xuezai_read` | 9 action（含 2 个下载） |
| | `campus_homework` | 2 action（写） |
| | `campus_checkin` | 单个 + **批量（`all: true`）** |
| `tool/cc98` | `campus_cc98_read` | **22 action** |
| | `campus_post` | 4 action（写） |
| | `campus_react` | 6 action（写） |
| | `campus_signin` | 无 action（写） |
| `tool/sztz` | `campus_sztz_read` | 6 action |
| | `campus_activity` | **4 action**（signup / cancel / favorite / unfavorite） |
| `tool/tyys` | `campus_tyys_read` | 5 action |
| | `campus_venue` | 2 action（写） |
| `tool/lab` | `campus_lab_read` | 10 action |
| | `campus_lab_select` | 2 action（写） |
| `tool/pta` | `campus_pta_read` | 7 action |
| | `campus_answer` | 2 action（写） |
| `tool/classroom` | `campus_classroom_read` | **10 action**（含 `check` / `setupPlan` / `liveCandidates`） |
| `tool/doc` | `campus_doc` | 4 action（text / pdf / pages / find） |
| `tool/xxt` | `campus_xxt_read` | 7 action |
| `tool/notice` | `campus_notice_read` | 4 action |
| `tool/chalaoshi` | `campus_chalaoshi_read` | 3 action |
| `tool/ebook` | `campus_ebook_read` | 无 action |
| `tool/yjsy` | `campus_yjsy_read` | 无 action |

---

## 三、B 类 · source 也要补（5 条）

**这是当前唯一的真实缺口。**

| provides | 卡在哪 | 能不能做 |
| --- | --- | --- |
| `zhiyun setup` | 上游是 `npm install ffmpeg-static` + 下 241 MB 权重。前者仓库硬禁，后者属裁决 N-3 | **已给出计划面**：`setupPlan()` 列出每步的路径 / URL / 字节数 / SHA-256，`executed` 恒为 `false`（有测试钉住）。**执行部分明确不做** |
| `zhiyun check` | 三处实测缺陷已修（平铺布局、截断权重算通过、`verified` 恒 false） | ✅ 已做 |
| `zhiyun trans audio` | 装配方已补（`createHostTranscriber`），内核来自宿主自带语音包 | ⚠️ **未真机验证**（本机没有权重与语音包） |
| `zhiyun live start` / `stop` | 入参链路已补（`LiveSource.remaining()`） | ⚠️ **协议帧未真机验证**（需一台校园网内的机器） |
| `zhiyun download` | source 已暴露 `downloadResource`，只差一个 tool action | **A 类，1 条**，成本极小 |

> **`zhiyun setup` / `check` / `trans audio` / `live` 的实际状态**：
> 代码都写了、都有离线测试，但**`trans audio` 与 `live` 从未跑过真机**。
> 这一条必须如实记着 —— 「有代码 + 有测试」不等于「验证过」。

---

## 四、其他分类

### 4.1 不需要 tool（4 条）

`webvpn probe` / `check` / `url encode` / `url decode`。

库函数都在（`probeHost()` / `doctor()` / `checkReachable()` / `toWebvpnUrl()`），
但这四件事属于**设置页诊断按钮**或**维护脚本**。让 agent 去「测一下这个站能不能通」
既占工具表又没场景。

### 4.2 明确不做（4 条）

| provides | 依据 |
| --- | --- |
| `cnki search` / `cnki download` | 用户明说「不做知网数据源」 |
| `pta homework start` / `homework finish` | 开始答题会**启动计时**，替用户做这个决定不合适。`campus_answer` 会检查「是否已开始」，没开始就拒绝 |

### 4.3 会话动作（35 条）

`session login` / `status` / `logout` / `import-cookie`，分布在 13 个模块。
在本仓是**装配层**的事（`source/login` + 设置页），不是 agent 工具。

---

## 五、这一轮（五批并行）实际补了什么

> 下表「测试」列写的是**该批新增**的用例数，不是模块总数。模块总数见 §六。

| 批次 | 补了什么 | 验证 |
| --- | --- | --- |
| **chaoxing**（7 条） | 新建 `tool/xxt`（7 action）+ 补 source：资料栏合入、三来源作业、16 种视频扩展名、真落盘 | 169 条测试；**14 轮反证，其中 2 轮「首轮 0 红」被抓出并补了断言** |
| **doc**（4 条） | 新建 `core/doc` + `tool/doc`；OOXML/ODF 直读（零新依赖）；页边界保留 | 55 条测试；**23 条反证全部变红**，其中 1 条抓出假绿 |
| **zhiyun**（4 条） | `check` 三处缺陷修复；`setupPlan` 计划面；ASR 装配方；直播入参 | 34 条测试；15 次反证 |
| **xuezai 下载**（2 条） | `source/http` 共享下载器 + `xzzdDownload` | 47 条测试；6 条反证，**1 条最初 0 红（发布竞态）被发现并补测** |
| **sztz**（2 条） | 收藏/取消收藏；批量签到（`rollcall-batch.js`） | 81 条测试；14 个反证点 |
| 合并收尾 | 两份下载器合并成一份；4 个包补 `inject` 声明；`setupPlan` 挪回 `source.js` | 见 §六 |

### 顺带修掉的真 bug（都不是「加功能」）

| # | bug | 后果 |
| --- | --- | --- |
| 1 | `sztz` 的 `mine.some is not a function` | `signupActivity` / `cancelActivity` 在**实机上都是坏的**；被假测试掩盖（夹具返回数组，真机返回对象） |
| 2 | `classroom` 的 `findDataChunk()` 写死 44 字节 | FFmpeg 在 `fmt` 与 `data` 间插 `LIST` 块时音频整体偏移 → 「能跑但全是乱码」 |
| 3 | `zhiyun` 的 `verify` 恒 true | 自定义文件名一个摘要都不算就报 `verified: true` |
| 4 | `tool/ebook` 等 4 个包缺 `inject` | 挂载即抛 `Cannot read properties of undefined (reading 'register')` |
| 5 | `rollcall` 批量的 `course` 只影响审批文案 | 审批框写「签高数」，实际全签 |

---

## 六、这一轮的验证

| 项 | 结果 |
| --- | --- |
| 工具数 | 24 |
| 探针 | **32/32** |
| tool + repo + doc 测试 | **317 条**（316 过 / 1 skip / 0 失败） |
| classroom + http | **253 条**（252 过 / 1 skip / 0 失败） |
| xuezai | **231 条全绿** |
| xxt | **149 条全绿** |
| doc | **55 条全绿** |
| 链接 | 78/78 |
| 构建 | 通过 |

**反证纪律**：每个 agent 都被要求「改坏实现 → 确认变红 → 还原」。
执行中抓出 **3 次「反证首轮 0 红」**（测试本身是假的），全部当场补了断言：

| 谁 | 改坏什么 | 首轮 | 处理 |
| --- | --- | --- | --- |
| xuezai 下载 | `link()` → `copyFile()` | **0 红** | 原测试只覆盖「开始前已存在」，没覆盖发布竞态 → 补测 |
| chaoxing | 章节范围不收窄 | **0 红** | 补 `chapterScope.keep` 的直接断言 |
| chaoxing | 下载白名单退回 | **0 红** | 断言写成子域 `cldisk.chaoxing.com`，打不到差异 → 改用 `file.cldisk.com` |
| doc | 插件层不要求输出目录 | **0 红** | 断言只查 `code === 'CONFIG'`，服务层也抛同一个 → 改咬插件层自己的文案 |

---

## 七、仍然压着的一件事

**24 个工具一个都没挂载。**

- preset（`D11`）仍未定
- 按约定工具包不进 profile bundles
- 所以**一个都到不了 agent**

这条比补最后 5 条 B 类重要得多。补完 B 类，工具表还是空的。

---

## 八、怎么复算

```bash
node scripts/audit-tool-coverage.mjs
```

脚本的映射表是**硬编码的**：每条 provides 都指名由哪个工具、哪个 action 覆盖。
所以：

- 加了新工具 → 改 `MAP` 里对应那几行 → 重跑，数字必须仍合计 162；
- 映射表引用了不存在的工具 → **脚本直接报错退出**（这是防第一版那种错的机制）；
- 有未映射 → 脚本会列出来（现在 0 条）。

**新增读工具的验收口径**：

1. source 方法已存在且返回完整（不是「只回链接」那种半成品）；
2. 工具参数里**不出现**用户拿不到的东西；
3. 读操作**不过审批**（审批只给写操作）；
4. 若依赖跨域字段，在 `coverage-gaps.md` 登记。
