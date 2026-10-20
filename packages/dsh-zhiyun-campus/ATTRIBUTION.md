# 来源

本包是**本仓原生实现**。这一节说明它参考了什么，以方便日后追溯。

## 实现口径的来源

学在浙大与拼题A 的接口行为、端点清单、过滤口径，全部来自**本仓自己的 Flutter 实现**
（`zhiyun-pro` 项目的 `lib/bridge/`）：

| 本包文件 | 对应的 Flutter 参考 |
| --- | --- |
| `src/xzzd.js` | `courses_todo_data_source.dart`（`CoursesApi` 端点表、`isPendingTodo`、`buildCourseTodos`） |
| `src/pta.js` | `pta_data_source.dart`（`/api/problem-sets` 参数与 404 语义） |
| `src/cas/login.js` | `zjuam_client.dart`（CAS 三步登录）+ `courses_todo_data_source.dart` 的 `_loginCourses`（手动跟跳转链） |
| `src/cas/{errors,urls,session,transport,auth}.js` | 复制自本仓 `dsh-zhiyun-classroom/src/` |

同一作者、同一组织、同一套产品。**没有引入第三方代码**，所以不需要单独的致谢章节 ——
但参考关系写在这里，将来要同步改动时能对上。

## WebVPN 协议

`src/webvpn/protocol.js` 与 `src/webvpn/login.js` 是**本仓重写**，不是复制。

协议口径（AES-128-CFB 地址编码、`_csrf` 登录表单、`NEED_CONFIRM` 等错误码）参考了
本仓 `dsh-zhiyun-omni/src/auth/webvpn.ts`，而那份的注释写明了它的上游：

> WebVPN URL scheme and login form adapted from EviterLesRoses2/cc98-mcp (MIT),
> which in turn credits Lucent-Snow/CC98-CLI (MIT).

即 MIT 许可的第三方实现。本包**没有复制它的代码**，只沿用了协议事实（常量、
编码方式、字段名、错误码），因此按 [CONTRIBUTING 3.3](../../docs/contributing/CONTRIBUTING.md#33-参考其他项目前先确认协议)
属于「简单借鉴」，无需在包内附完整许可说明。

重写的理由：omni 那份绑在它自己的 `Transport` / `ToolError` 上，而本包有自己的
传输层与错误码；直接 import 会把两套错误类型搅在一起，也会让本包反向依赖 omni。

## 接口性质（如实标注）

学在浙大待办与拼题A 题集都是**登录后**的数据，不是公开数据：

- 学在浙大：需要 ZJUAM 统一身份认证换出的 `session` cookie；
- 拼题A：需要浏览器登录后的 Cookie（短信验证，无法自动化）。

不能把它们描述成"基于公开接口实现"。

## 为什么把 classroom 的 CAS 那几份复制过来

本仓跨包依赖只走 `ctx` 服务，**没有包用相对路径 import 另一个包的 `src/`** ——
那会让两个包在加载顺序、构建产物、以及"单独停用其中一个"这三件事上互相绑死。

那五份是纯库代码（CAS 协议、Cookie jar、HTTP 传输），约 270 行。改动要点：
`Transport` 的 cookie 主机白名单改成**可注入**（`hosts` 参数），因为 classroom 的默认值
只含智云课堂的域名，不包含 `courses.zju.edu.cn` 与 `pintia.cn` ——
不传就等于"请求不带 cookie、Set-Cookie 也不存"，登录会静默失败。

⚠️ 复制的那几份**不会**随 classroom 自动更新。改动时要两边一起看。

## 与本仓 `dsh-zhiyun-omni` 的关系

omni 仍在仓内，继续提供**教务课表/成绩（`zdbk`）**等域（「今天」页在用）。
本包只接管 **xzzd（学在浙大待办）** 与 **pta（拼题A 题集）**。

理由：omni 是移植来的、上游为 macOS 写，在这两条链路上有几处结构性问题
（一次失败封锁 15 分钟、认证层自己探网络模式、拼题A 的 N+1、`/api/todos` 会漏）。
其余域暂不动，避免一次性把「今天」页也卷进来。

⚠️ 本包**也做了 WebVPN**（`src/webvpn/`），但那不是"把 omni 的分支照搬回来"：
omni 是在认证层里探网络模式，探不到就把整条链路交给网关；本包把它拆成独立的
出口策略（`src/egress.js`），探测结果缓存、失败不阻断、只对**校园域名**生效，
且拼题A 这类公开站点永远直连。
