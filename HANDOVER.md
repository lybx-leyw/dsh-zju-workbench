# 交接说明

> 本文写给下一位接手的人（人或 AI）。只讲**当前状态、未做的事、以及为什么**。
> 规范类内容在 [docs/contributing/AGENTS.md](docs/contributing/AGENTS.md)，不在这里重复。

## 一、当前状态一句话

两个新包已经写好并验证可用，**改动全部未提交**（没有 commit、没有 push）。

```
 M ATTRIBUTION.md                             ← 指向 omni 包内那份移植说明
 M README.md                                  ← 追加两个新包的介绍
 M packages/dsh-zhiyun-page-me/src/client.jsx ← 挂网络代理面板的插槽
 M packages/dsh-zhiyun-shell/src/client.jsx   ← 声明 zhiyun.me.network 子插槽
 M profiles/zhiyun-bench/package.json         ← 接入两个新包
 M scripts/build.mjs                          ← net-proxy 加入客户端构建清单
 M tests/css-order.test.mjs                   ← 补 CSS 包清单（含既有的 page-today 遗漏）
 M tests/profile.test.mjs                     ← 同步 bundles 逐字符断言
?? packages/dsh-zhiyun-net-proxy/  （13 文件 / 1988 行）
?? packages/dsh-zhiyun-omni/       （53 文件 / 5720 行）
?? tests/net-proxy.test.mjs        （7 项测试，全绿）
?? tests/omni.test.mjs             （10 项测试，全绿）
```

测试现状：单包 `node --test tests/<包>.test.mjs` 各自全绿；
全量 `npm test` 为 **562 项 / 561 通过 / 1 失败**，唯一的失败是既有的
`dsh-radar-better-markdown`（与本任务无关，见第三节第 7 条）。

## 二、两个包分别是什么

### 1. `dsh-zhiyun-net-proxy` —— 分域网络代理（自研）

**解决什么**：智云（`*.zju.edu.cn`）是国内站点，原先跟着全局 `HTTPS_PROXY`
绕道海外代理，导致「我的课 / 学习」取数慢到卡住。

**做法**：所有出口流量经一个本地中继（`127.0.0.1` 随机端口），中继按用户配置的
**域名路由表**分发到不同代理或直连。代理数量不设上限。

```
页面取数 / agent 抓取 ─► 宿主出口策略 ─► 本地中继 ─┬─► 代理 A
                                                 ├─► 代理 B
                                                 └─► 直连
```

**关键设计：只暴露一个代理端点**。宿主的 `@deepseek-ai/dsh-http-proxy` 有条硬约束
（其 README 明写）：`proxyForUrl()` 与已安装的 dispatcher **绝不能对同一 URL 给出不同
答案**，否则 `dsh-web-fetch-http` 会把请求钉在策略从未放行的地址上。所以分域逻辑全收
在中继里，「策略层的答案」永远只有一句「走本中继」—— 从构造上不可能不一致。

**UI**：「个人 → 网络代理」，复用壳的 `.zy-settings-group` 折叠组（与其他设置项同源）。
可增删代理与规则、单独测试每个出口。

**实测数据**：`schedule` 2062ms → **227ms**；`courses` 冷启 3579ms → **1542ms**。

**已验证的边界**（详见该包 README）：
- ✅ 终端环境变量（`HTTP_PROXY` 等）不再影响 —— 宿主会把这些名字就地改写成中继地址
- ✅ Windows 系统代理不再影响
- ⚠️ **管不了 DSH 右侧的「浏览器」页面** —— 它是 Electron `<webview>` guest，策略在主进程
  session 上，插件宿主够不到。这是 DSH 的架构限制，插件侧无法修复。

**踩过并修掉的两个坑**（`tests/net-proxy.test.mjs` 已钉住）：
1. `egress.js` 早先把 `NO_PROXY` 覆盖成「只剩回环」，**丢掉了用户原有的
   `api.deepseek.com` 直连意图** → 翻译（LLM 调用）被送去一个不可用的代理，挂死 120 秒。
   现在改为继承并显式化用户的直连意图（`directHosts()` + `withInheritedDirect()`）。
2. `enabled:false` 时 `status.active` 变不回 `false`。原因：宿主的还原函数先恢复环境变量、
   再 `await agent.close()`，而 `close()` 会等**在飞请求**结束 —— 那条挂死的请求让它永不返回。
   现在改成「先改状态、再等还原」。

### 2. `dsh-zhiyun-omni` —— 浙大校园数据包（移植）

**来源**：[Vita0818/ZJU-Omni](https://github.com/Vita0818/ZJU-Omni)（MIT，提交
`192d1015a53a7b09f23ae143d56686c8fbf706af`）。

**它是什么**：**数据包，不是工具包**。对外暴露 44 个数据函数（教务课表/成绩/绩点/考试、
学在浙大作业与课件、CC98、拼题A），谁来消费由调用方决定。

**为什么砍掉工具层**（用户决策）：上游把数据层包成 54 个 MCP 工具交给 AI。工具定义是
「面向某个具体客户端」的适配，钉在包里，将来接页面时就得绕开它。数据层本身与消费方无关。

**为什么移植而不是依赖挂载**：上游**没有 npm 包**，且凭据层在 Windows 上必须改。

**关键改造**：上游凭据后端是 **macOS 钥匙串专属**（非 darwin 直接抛错），意味着上游在
Windows 上只能把密码明文放进环境变量。本包改成按平台选后端，**Windows 用 DPAPI**
（与 `dsh-zhiyun-classroom` 存会话同一套办法）。

**暴露面**：
```
GET  /api/zhiyun-omni   → 有哪些平台、每个平台有哪些方法
POST /api/zhiyun-omni   → { type:'client-request', rpcId, payload:{ method:'zdbk.timetable', args } }
```
宿主侧也可直接 `ctx.get('zhiyunOmni').invoke('zdbk.grades', {...})`。

**已验证**：
- 44 个源文件全部解析通过，0 语法错误
- 数据函数可列出：`xzzd` 21 / `cc98` 10 / `pta` 9 / `zdbk` 4（`zdbk` 的 `items`/`rows`
  是读取器的内部工具方法，不算数据方法、也不暴露 —— 见「调用守卫」）
- **调用守卫 17/17 正确**：合法方法放行；`__proto__` / `constructor` / `toString` /
  `hasOwnProperty` / `valueOf` / `isPrototypeOf` 等原型链名字一律拒绝；内部方法与未启用平台也拒绝
- **真实调用验证过**：`pta.summarize` 走通「取方法 → 调用 → 返回」整条链
- DPAPI 往返正常，**磁盘无明文密码**（`accounts.json` 只有账号名，密码进密文文件）
- 真实实例里 `GET /api/zhiyun-omni` 返回正常，且确认**不含 `zhiyun` 平台**（与文档一致）

## 三、未做完 / 需要注意的事

按重要性排序：

1. **两个包都没有真实账号跑过端到端**。net-proxy 的出口切换用假代理验证过；omni 的数据
   函数只验证了「能加载、能列出」，**没有用真实浙大账号调过一次真实接口**（那需要你配置
   凭据）。接入后第一次用需要留心。

2. **omni 的 `skills/` 目录当前未被任何代码引用**。上游的两个技能文件（`zju/SKILL.md`
   和 `zju-lite/SKILL.md`）搬过来了，但本包不做工具层，也就没有把它们注册给 AI 的入口。
   留着是为了日后要接 AI 时能直接用；**如果你决定不接 AI，这两个文件应该删掉**。

3. **omni 的 `tsconfig.json` 是照抄上游的，但本仓没装 typescript**，所以它现在只是
   一份声明，跑不了 `tsc`。源码靠 Node 原生类型剥离运行（实测 Node v24 与 DSH 的
   Electron Node v24 都行）。若日后要加类型检查，需要先装 typescript。

4. **omni 的测试只覆盖「本仓加的那一层」**。`tests/omni.test.mjs` 有 10 项，钉的是调用守卫
   （含 `__proto__` 等原型链名字必须被拒）、凭据后端选择、零外部依赖、平台默认值。
   **上游的业务逻辑（各平台接口解析）没有测试覆盖到** —— 上游自己的测试没搬过来，
   也不该在这里重造。所以第一次用真实账号时仍需留心。

   > 这 10 项里有一条当场抓到过 bug：`config.ts` 与 `host.js` 各写了一份平台默认值，
   > 内容不同（一处含 `zhiyun`、一处不含），于是「默认启用哪些平台」有两个答案。
   > 现已收敛到 `config.ts` 的 `DEFAULT_PLATFORMS` 单一真源。

5. **两个包的「真实使用」都还没接到页面上**。omni 的数据路由通了，但前端还没有任何页面
   在读它；net-proxy 的面板在「个人」页可用。omni 接下来要接哪个页面（今天？我的课？）
   是尚未决定的产品问题。

6. **`dsh-zhiyun-omni` 的 `ZJU_PLATFORMS` 默认排除 `zhiyun`**（避免与本仓
   `dsh-zhiyun-classroom` 各登录一次）。想用上游那份智云能力时需显式加上。
   这条默认值已由 `tests/omni.test.mjs` 钉住。

7. **全量测试 562 项：561 通过，1 失败**。失败的是 `dsh-radar-better-markdown`
   （要求导出 `UPSTREAM_REPOSITORY`），**与本次改动无关**，改动前就是红的（已用
   `git stash` 隔离验证过）。

## 四、`.runtime/` 里留了什么（都不进仓库）

| 路径 | 用途 | 可否删 |
| --- | --- | --- |
| `.runtime/ref-zju-omni/` | 上游 ZJU-Omni 的完整克隆（含 `dist/`、`node_modules/`，约 49MB），**日后同步上游时用来比对** | 同步完可删 |
| `.runtime/ref-net-proxy/` | 参考过的 `dsh-net-proxy`（MIT）克隆，最终**没有采用**（单代理模型做不到分域） | 可删 |
| `.runtime/home/profiles/zhiyun-bench/` | 运行中的 profile（含 `data/zhiyun-net-proxy/config.json`） | 是实例数据，删了要重新 init |

**我自己建的临时脚本已全部清理干净**（34 个文件，含各种探测/截图/验证脚本）。

## 五、注意事项与建议

- **推送前必须做信息泄露检查**（仓库规范）。我已扫过两个新包，**无本地绝对路径、无凭据**。
  但提交前请再自己过一遍 —— 特别是 `git config user.email`：按
  [AGENTS.md](docs/contributing/AGENTS.md)，它只有**本来就是该 GitHub 账号注册邮箱**时才可直接用，
  否则应改成 GitHub 的 noreply 地址（本次工作环境的这个值含学号，是否可用请自行确认，**不要在文档或提交信息里抄写它**）。
- **推送一律走 PR**（`main` 有分支保护）。两个包是独立主题，**建议拆成两个 PR**。
- **当前实例还在 3092 跑着**（我启动的后台任务）。3091 上那个是 10-12 就存在的旧实例，
  **不是我启动的**，别误关。
- 当前 profile 里 `zhiyun-net-proxy` 的配置是 `enabled:false` + `fallback:oversea`
  （我测试时的状态），**接管是关闭的**。要用需要自己去「个人 → 网络代理」打开。
- 我建的 goal（`goal-fcecf833-7d6e-4edd-8746-2c3c60cf3375`）描述的是旧方案（注册
  `mcp__zju__*` 工具）。**方案已改为数据包**，那个 goal 的描述已过时，别照它做。
