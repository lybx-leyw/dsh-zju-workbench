# 智云课堂数据源

宿主插件注册 `ctx.zhiyunClassroom`；业务插件声明 `inject = ['zhiyunClassroom']` 后使用。挂载插件时只建立客户端，不联网。首次读取用户状态时复用已有会话；令牌过期后，从「设置 → 浙大一卡通」读取账号并恢复连接。状态按 DSH `profileContext.dir` 隔离，卸载时撤销服务、取消请求。

纯 JS 使用不需要 Cordis：

```js
import { ClassroomSource } from 'dsh-zhiyun-classroom/source';

const source = new ClassroomSource({ sessionFile: 'C:/local/session.dpapi' });
try {
  const session = await source.restoreSession();
  if (!session.authenticated) await source.login({ username, password });
  const courses = await source.listCourses();
  const lessons = await source.listLessons(courses.items[0].id);
  const content = await source.getLessonContent(lessons.items[0].courseId, lessons.items[0].subId);
} finally {
  await source.dispose();
}
```

## 服务契约

| 方法 | 结果 |
| --- | --- |
| `restoreSession()` | `{ authenticated, user }`；网络/结构错误仍抛出，不误判成未登录 |
| `login({username,password}, {signal})` | 验证业务会话后返回登录结果；同进程同账号登录串行 |
| `logout()` | 取消请求并清空本地 Cookie；不代表注销校方所有站点的 SSO |
| `getCurrentUser()` | `{id,name}` 或 null |
| `listCourses({signal})` | 课程列表与分页元数据 |
| `listLessons(courseId,{onlyPlayable=true,signal})` | 节次及资源；false 保留不可播放状态 |
| `getSlides(courseId,subId,{signal,onProgress})` | PPT 帧及完整性元数据 |
| `getSubtitles(courseId,subId,{signal,onProgress})` | 按开始时间排序的字幕 |
| `getLessonContent(courseId,subId,options)` | 并行获取 slides/subtitles，保留各自元数据 |
| `getSchedule({start,end,userId,signal})` | 课表；默认上海今天，最多 31 天 |
| `downloadResource({url,destination,signal,onProgress,maxBytes,timeoutMs})` | 流式下载；默认 20 分钟，目标须为绝对路径 |
| `downloadSlides(courseId,subId,{directory,concurrency=6,signal,onProgress})` | 图片下载结果逐页汇总，最多 8 并发 |
| `dispose()` | 取消请求、关闭客户端、等待会话写入 |

## 直播（`source.live`）

直播与回放是两条不相交的通路，所以是独立的 `LiveSource`（`source.live`），但**共用同一个 transport** —— 同一次登录不该存在第二份 cookie。

| 方法 | 结果 |
| --- | --- |
| `listCurrent({signal,now})` | 此刻在播的课（今天 + 当前时段）；课间返回空列表 |
| `listLiveDay(date,{signal})` | 某天全天直播课；单时段失败标 `partial-quantum`，全失败才抛 |
| `resolveStreams(courseId,subId,{signal})` | `{streams,dropped,source}`；机位 key 为 teacher/screen/student/extra |

三处与回放**不同**、写错就会静默失败的地方：

1. **要 `Authorization: Bearer <JWT>`**，不是 cookie。直播网关每条请求都要这个头，缺了的表现是「今天没有课」而不是报错。JWT 从登录后的 `_token` cookie 里取，取不到就**不带**这个头（让上游如实拒绝，而不是编一个空 Bearer 把真实原因盖成 401）。
2. **`search_time` 要不补零**（`2026-6-3`）。补零会被上游当成空日期。
3. **`quantum_id` 分片**：传 0 是「探路」拿时段表，不是某个时段。上游没有全天聚合接口。

不可播放的流（`webrtc`/`mp4`/图片）进 `dropped` 而不是静默丢弃 —— 北教部分教室只给 `webrtc://`，直接 return 会让那个机位在界面上凭空消失。

浏览器里播直播**必须**经过本机转发（`/zhiyun-live`，见 `src/stream.js`）：CDN 校验 Referer、m3u8 里的分片是相对地址且带鉴权参数、以及跨域。转发层只做「拉取 + 改写 + 转发」，白名单是 `*.zju.edu.cn` 且仅 https，日志不含 query（那是签名）。

登录支持两个入口：`entry:'cas'`（默认，`tgmedia` 直连）与 `entry:'oauth'`（`yjapi/casapi` 授权码）。后者多一条取 JWT 的路径，`_token` cookie 里藏的就是它。`inspectJwt()` 只解析 payload、**不校验签名**，仅用于「会话还剩多久」这类展示。

列表结果统一 `{items, meta}`。`meta.complete` 为 true/false/null，分别代表已收全、部分结果、完整性尚未确认；`reason` 给出 total/empty-page/repeated-page/page-limit 等停止原因。不能在 UI 中把 false/null 默认为全部内容。`version` 是此响应规范化字段的快照摘要，包含资源地址，后续同步应另外设计语义内容版本。

ID 规范化为字符串；节次保留 Dart 的 `courseId_subId`，另有带来源的 `sourceId`。字幕使用毫秒，PPT 的 createdSec 与课表 startAt/endAt 保留秒，同时提供毫秒字段；视频同时保留纳秒与毫秒时长。课表日期原样保留为 YYYY-MM-DD。PPT 同图不同时间保留为独立事件，避免丢失三流融合锚点。

历史课件返回的 `http://video.cmc.zju.edu.cn/` 图片地址会统一升级为 HTTPS，原签名查询串保持不变；规范化后的 PPT 地址可供解析器和浏览器共同使用，传输层也兼容旧地址。其他非本机 HTTP 地址仍会拒绝，不回退到明文请求。

失败使用 `ClassroomError.code`：SESSION_EXPIRED、AUTH_REJECTED、AUTH_SHAPE、API_SHAPE、BUSINESS、HTTP、NETWORK、TIMEOUT、CANCELLED、STORAGE 等。诊断不携带原始响应、密码、Cookie、CAS ticket 或签名 URL。

Windows 持久化会话使用当前用户 DPAPI；未提供 sessionFile 时仅内存存储。其他平台需注入 `protect(bytes,decrypt)` 保护器。支持自定义 transport/fetch 进行离线测试。密码由调用方安全存储提供，数据源本身不保存密码；不要放进 Cordis 公共配置。

## 验证

```powershell
npm run test:classroom
node tests/classroom-live.test.mjs
npm run classroom:verify -- --live --credentials-file <本机凭据文件> --start 2026-10-05 --end 2026-10-11
npm run classroom:verify -- --live --probe-resources --logout-at-end
npm run classroom:parity
```

### 直播链路探针

`live.js` 里有一处是**推的、没实测过**：`sub_content` 的直出流结构。若上游字段名与
代码假设不符，`resolveStreams` 会返回空 `streams` —— 界面上是「这一节现在没有可用的
机位」，**不报错也不提示**。这是整套直播唯一会静默失败的点，所以给它单独一个探针：

```powershell
npm run classroom:live-probe -- --live                      # 复用 classroom:verify 的会话
npm run classroom:live-probe -- --live --date 2026-10-20     # 指定日期
npm run classroom:live-probe -- --live --trace               # 打印每条请求去向
```

它做三件事：确认 Bearer 头有效、打印机位的类型与能否过转发白名单、**打印
`sub_content` 的字段结构**（只给键名与类型，字符串只给长度）。

只读且保守：不发 POST、不下载分片（只对 m3u8 取前 2 KB 判断是不是播放列表）、
不写任何文件、不动会话。**输出里不含完整流地址与签名** —— 那里是 `auth_key`，
等同于短期凭据。

看两项就能定性：

- `bearer.present=false` → 直播每条请求都会失败，而上游只会回「今天没有课」
- `streams.verdict` 说没解出机位 → 字段名假设不成立，对照上面的 `raw-fields` 键名改 `collect()`

首次验证从指定文件读取 `ZJU_USER/ZJU_PASS`，也可由进程环境变量提供。后续命令默认复用 `.runtime/classroom-verify/session.dpapi`；`--fresh` 才重新登录。资源探测请求前 4096 字节并取消响应，不下载完整视频。验证报告只记录数量与状态，存放 `artifacts/classroom`。

`classroom:parity` 需 Dart SDK 和相邻 Flutter 仓库，可用 `--flutter-root` 指定；Windows 可用 `DART_EXECUTABLE` 指向 dart.exe。普通 Node 测试使用已记录的 Dart 脱敏基线，无需 Dart。`--capture-live` 使用已有验证会话，按字段白名单生成脱敏接口样本及 Dart 基线，不能作为日常测试自动执行。

2026-10-07 已通过新登录、会话恢复、30 门课程、两节内容、本周/空日课表、资源 Range 和本地注销验证。缺失课件/视频等可选资源及异常分页使用离线测试；未覆盖所有课程和所有服务端状态。


## 账号恢复与网络出口

宿主服务的 `getCurrentUser()` 会按需恢复登录。并发状态读取共用一次登录，失败后 60 秒内不重复提交；更改保存的账号或密码会立即触发重新认证，并清除旧账号会话。已有 SSO 时先续接业务授权，只有校方实际返回登录表单才提交密码，不把旧票据当成登录成功证据。显式退出后，本次运行不会立即自动重连；纯 `ClassroomSource` 库仍由调用方管理登录。

课堂请求使用本包自己的直连 dispatcher，与宿主 AI 服务的代理相互独立。会话仍保存到当前 profile 的 DPAPI 文件，实验目录中的会话不会被 App 自动发现。
