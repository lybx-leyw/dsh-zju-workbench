# 数据源建设进度

**规则**：D17 —— 写操作进 `tool/`，读操作进 `source/`。
**样板**：`source/yjsy`（已完成，21 条测试，可作为其余包的模板）。

## 已完成

| # | 包 | 状态 | 测试 | 备注 |
| --- | --- | --- | --- | --- |
| S-02 | `source/yjsy` | ✅ | 21 条 | 样板包；上游 6 个导出全覆盖 |
| S-11 | `source/chalaoshi` | ✅ | 23 条 | **站点国内不可达**，有缓存时离线可用 |
| S-12 | `source/ebook` | ✅ | 19 条 | 双来源合并；按 IP 认证 |
| S-13 | `source/cnki` | ✅ | 31 条 | 检索式 + 结果解析 + IP 登录状态机；**滑块未搬** |

**进度：4/14 完成，110 条测试通过。**

**样板确立的包结构**（其余包照此）：

```
packages/source/<name>/
├── package.json       dsh.capability: tier 1 / auth / network / writes:false / requires
├── cordis.patch.yml   id: zju-source-<name>
├── OWNERS             @lybx-leyw + Open
├── README.md          能力表 + 分级理由 + 已知限制
└── src/
    ├── index.js       服务 + 路由（不注册 AI 工具）
    └── <name>.js      纯逻辑（可单测，注入 request）
```

**四条样板约定**：

1. **纯逻辑与插件入口分离** —— `src/<name>.js` 不 import cordis，只收注入的 `request`；
   `src/index.js` 负责 `ctx.provide` + 路由。这样单测不需要宿主。
2. **错误有稳定 code** —— `<Name>Error { code: 'SHAPE'|'AUTH_EXPIRED'|'REJECTED'|'CONFIG' }`。
3. **凭据/登录由调用方注入** —— 数据源不知道凭据从哪来（tier 1 不依赖业务包）。
4. **设置分区归白名单** —— 走 CAS 的包无可配置项，状态并入「浙大统一身份认证」分区；
   新包要加进 `tests/source-settings.test.mjs` 的 `NO_SETTINGS`。

## 待建（12 个）

按依赖复杂度排序，建议这个顺序：

| # | 包 | auth | 复杂度 | 上游源 | 说明 |
| --- | --- | --- | --- | --- | --- |
| 1 | `source/chalaoshi` | none | 中 | `chalaoshi/index.ts` 17.7 KB | **本机不可达**（国内被墙），需先确认是否值得建 |
| 2 | `source/ebook` | none | 中 | `ebook/index.ts` 14.8 KB | 双来源合并 + HTML 解析；`sslibrary` 实测可达 |
| 3 | `source/cnki` | none | 中偏大 | `cnki/index.ts` 23.9 KB + `slider.ts` 9.7 KB | IP 登录 + 滑块 |
| 4 | `source/notice` | cas | **大** | `notice/` 9 文件 80 KB + 68 主机表 | 两套适配器 |
| 5 | `source/lab` | own | 中 | `lab/index.ts` 27 KB | **已实测可用**，含签名算法 |
| 6 | `source/sztz` | cas | 中 | `sztz/index.ts` 29 KB | 只收读；报名归 tool |
| 7 | `source/tyys` | cas | 中偏大 | `tyys/` 76 KB | 只收读；预约归 tool |
| 8 | `source/xuezai` | cas | 大 | `xuezai/` 10 文件 128 KB | 从 campus 拆；只收读 |
| 9 | `source/pta` | own | 中 | `pta/` 8 文件 | 从 campus 拆；只收读 |
| 10 | `source/mail` | own | 中 | `plugin/host/mail.mjs` 22 KB | 拆 4 包之一；只收读 |
| 11 | `source/weread` | own | 大 | `core/weread` | 需浏览器 + 管道 |
| 12 | `source/wechat-chat` | — | 大 | `core/wechat` | 本机库读取 |
| 13 | `source/dingtalk-chat` | — | 大 | `core/dingtalk` | 本机库读取 |

**扩展类（4 个，不是新建）**：

| # | 包 | 加什么（只读） |
| --- | --- | --- |
| E1 | `source/cc98` | +11 条读（版面标签、话题下载、楼层原文/评分理由、账号 6 条、签到记录） |
| E2 | `source/classroom` | 实时字幕 4 条、ASR 转写、资源检索 |
| E3 | `source/xxt` | 章节课件清单、视频清单 |
| E4 | `source/zdbk` | 培养方案 2、学籍 1、选课查询 3 |

## 审核计划

全部建完后，**逐个数据源派子代理审核**。每个代理的任务模板：

1. **上游覆盖度**：把上游该模块的导出逐条列出，每条给「本仓对应物」或「明确丢弃 + 理由」
2. **接口事实核对**：端点、参数、字段名是否与上游一致；是否有本仓漏掉的字段
3. **错误处理**：错误码是否稳定、错误文案是否可操作、是否有静默吞错
4. **分层合规**：是否越界（数据源不该注册工具、不该有写操作、不该依赖业务包）
5. **测试覆盖**：有没有测「上游记录过的坑」（那些注释里写明的踩坑点）
6. **可运行性**：包结构完整、workspace 链接、契约守卫通过
