# dsh-zhiyun-source-omni

浙大校园**数据包**。移植自 [ZJU-Omni](https://github.com/Vita0818/ZJU-Omni)（MIT）的**数据层**，
补上本仓统一的 DSH 接入形状。

## 它是什么，不是什么

| 是 | 不是 |
| --- | --- |
| 一个数据包：对外暴露数据函数 | 不是工具包：**不注册任何 AI 工具** |
| 教务（课表/成绩/绩点/考试）、学在浙大（作业/课件）、CC98、拼题A 的读取能力 | 不重复实现智云课堂（那是 `dsh-zhiyun-source-classroom` 的活） |
| 表现成 `omni` 服务 + 一条同源数据路由 | 不规定谁来消费 —— 页面、AI、脚本都行 |

**为什么砍掉工具层**：上游把数据层包成 54 个 MCP 工具交给 AI。本仓不要那一层，
因为工具定义是「面向某个具体客户端」的适配，钉在包里，将来接页面时就得绕开它。
数据层本身与消费方无关 —— 谁来调、当 data 还是当 tool，留给调用方决定。

## 用法

### HTTP（页面用）

```
GET  /api/zhiyun-omni     → 有哪些平台、每个平台有哪些可调用的方法
POST /api/zhiyun-omni     → { type:'client-request', rpcId, payload:{ method:'zdbk.timetable', args } }
```

`method` 一律是 `<平台>.<函数名>`，函数名就是读取器上的方法名。**不在这里列举**：
上游加平台、改方法名，接入层不用跟着改 —— 消费方用 GET 自己发现即可。

### 宿主侧（其他插件 / 脚本用）

```js
const omni = ctx.get('zhiyunOmni');
await omni.invoke('zdbk.grades', { academic_year: '2025-2026' });
omni.describe();          // 有哪些平台和方法
await omni.auth('status'); // 认证状态
```

### 数据能力（44 个函数，按平台）

| 平台 | 函数 |
| --- | --- |
| `zdbk` 教务 | `timetable` `grades` `gpaSummary` `exams` |
| `xzzd` 学在浙大 | `courses` `assignments` `assignment` `materials` `submissions` `todos` `semesters` `download` … (21) |
| `cc98` | `hot` `boards` `boardTopics` `topic` `search` `user` `notifications` `messages` `conversations` `newTopics` (10) |
| `pta` 拼题A | `problemSets` `problemSet` `problems` `problem` `exam` `progress` `summarize` … (9) |
| `zhiyun` 智云 | 默认**不启用**（见下） |

## 配置

| 环境变量 | 默认 | 含义 |
| --- | --- | --- |
| `ZJU_PLATFORMS` | `xzzd,zdbk,pta,cc98` | 启用哪些平台 |
| `ZJU_NETWORK` | `auto` | `auto`（先直连，不通走 WebVPN）/ `direct` / `webvpn` |
| `ZJU_OMNI_DATA_DIR` | profile 的 `data/zhiyun-omni` | 会话与凭据落盘位置 |
| `ZJU_USERNAME` / `ZJU_PASSWORD` | — | 环境变量提供凭据（优先于本机凭据库） |

### 为什么不默认启用 `zhiyun`

上游的 `zhiyun_*`（我的堂次、转录、PPT 时间轴）与本仓 `dsh-zhiyun-source-classroom` 功能重叠，
两者会**各登录一次、各存一份 CAS 会话**。所以默认排除；想用上游那份时显式写进
`ZJU_PLATFORMS` 即可（例如 `ZJU_PLATFORMS=zdbk,xzzd,cc98,pta,zhiyun`）。

## 凭据：Windows 上用 DPAPI，不是钥匙串

⚠️ **这是与上游最重要的差别。** 上游的凭据后端是 **macOS 钥匙串专属**
（`/usr/bin/security`），在非 macOS 平台直接抛 `CREDENTIAL_BACKEND_UNAVAILABLE` ——
也就是说上游在 Windows 上只能靠把密码明文放进环境变量。

本仓在 Windows 上运行，所以把凭据保管抽成按平台选择的后端：

| 平台 | 后端 |
| --- | --- |
| `win32` | **DPAPI**（`ProtectedData`，`CurrentUser`）：密文落盘，只有同一台机器的同一用户能解开。与 `dsh-zhiyun-source-classroom` 存智云会话用的是同一套办法 |
| `darwin` | 沿用上游的钥匙串实现（未改动，便于上游同步时对照） |
| 其他 | 只能靠环境变量，并给出明确指引 |

`accounts.json` 只存**账号名与后端种类**；密码进密文文件（`credentials/<平台>.dpapi`）。
两个文件都能随便看，泄露不了密码。

环境变量**始终优先**于本地存储 —— 用户显式导出的值最权威，也方便 CI 与临时换号
（这一条与上游一致）。

### 配置账号

```sh
node packages/dsh-zhiyun-source-omni/src/cli.ts configure zju
node packages/dsh-zhiyun-source-omni/src/cli.ts status
```

密码经 PowerShell 的 `Read-Host -AsSecureString` **不回显**读取，走匿名管道回到进程，
随即交给 DPAPI 加密 —— 不经过命令行参数、不落临时文件、不进 shell 历史。

## 实现要点

- **零外部依赖**：数据层只用 Node 内置模块。上游的 `@modelcontextprotocol/sdk` 与
  `zod` 只被工具层用到，随工具层一起删掉了（`package.json` 里没有任何 `dependencies`）。
- **不转译**：源码保持 `.ts`，靠 Node ≥22.18 的原生类型剥离直接运行。
  实测本机 Node v24 与 DSH 的 Electron Node v24 都能跑，profile 的 junction
  会把它解析回 `packages/`（不在 `node_modules` 内），因此不受
  `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` 限制。
- **来源可追溯**：上游提交与许可记在 [ATTRIBUTION.md](ATTRIBUTION.md)；
  上游原始 LICENSE 保留为 `LICENSE.upstream`。

## 与上游同步

本包是**移植**（fork 式），不是依赖挂载 —— 上游没有 npm 包，且凭据层必须改。
日后上游更新时，按 `ATTRIBUTION.md` 记的提交号比对，**重点看这几处本仓改动**：

1. `src/core/keychain.ts` —— 凭据后端（DPAPI 替换钥匙串）
2. `src/core/config.ts` —— `defaultDataDir()` 的平台分支、`toolProfile()` 不再抛错
3. `src/auth/actions.ts` —— 由上游 `auth/tools.ts` 改名而来，删掉了 `authTools()`
4. `src/platforms/index.ts` —— 删掉了 tools 装配
5. `src/host.js`、`cordis.patch.yml` —— 本仓新增的接入层（上游没有）
