# 智云课堂数据源

宿主插件注册 `ctx.zhiyunClassroom`；业务插件声明 `inject = ['zhiyunClassroom']` 后使用。挂载插件时只建立客户端，不联网。首次读取用户状态时复用已有会话；令牌过期后，从「设置 → 浙大一卡通」读取账号并恢复连接。状态按 DSH `profileContext.dir` 隔离，卸载时撤销服务、取消请求。

纯 JS 使用不需要 Cordis：

```js
import { ClassroomSource } from '@lybx-leyw/dsh-zju-source-classroom/source';

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
| `getLessonContent(courseId,subId,options)` | 并行获取 slides/subtitles，保留各自元数据；挂了课件缓存时每页多一个 `cacheKey`（命中再多 `cacheUrl`），并在后台预取 |
| `attachSlideCache(cache)` | 挂上课件缓存（可选）；不挂时行为与加缓存前完全一致 |
| `prefetchSlides(courseId,subId,options)` | 显式等待一节课的课件补齐；未挂缓存时返回 `cached:false` |
| `getSchedule({start,end,userId,signal})` | 课表；默认上海今天，最多 31 天 |
| `searchResources(courseId,subId,{kind,signal})` | 某节次的资源清单（**只看不下载**）；`kind` 为 `video,audio,ppt,slides,subtitles` 或 `all` |
| `searchCaptions({keyword,lessons\|courseId,days,limit,signal})` | 在录播字幕里搜关键词，命中带前后各一句；没有字幕的课次如实列出 |
| `check(component, {verify})` | 本地组件诊断（`asr` / `media` / `all`）；**只读**，不装任何东西。`verify` 加做 SHA-256 |
| `setupPlan(component)` | **安装计划**（不是安装）：目标路径 / URL / 字节数 / SHA-256，`executed` 恒为 false；导出在 `diagnostics.js`，路由 action 由 `index.js` 装配 |
| `setTranscriber(fn)` | 注入本地转写的识别内核；返回撤销函数 |
| `transcribeAudio({file,directory,signal,timeoutMs})` | 本地音视频转写，结果落盘；**分钟级**调用 |
| `liveStart({courseId,subId,...})` | 开始采官方实时字幕；**长连接**，只建立会话即返回 |
| `liveStatus({courseId,subId})` | 采集状态快照；**纯本地**，不联网 |
| `liveText({courseId,subId,at,before,after})` | 窗口内**已收**文字；如实报缺口，不等待未来 |
| `liveStop({courseId,subId})` | 停止采集；**已收到的字不删** |
| `downloadResource({url,destination,signal,onProgress,maxBytes,timeoutMs})` | 流式下载；默认 20 分钟，目标须为绝对路径 |
| `downloadSlides(courseId,subId,{directory,concurrency=6,signal,onProgress})` | 图片下载结果逐页汇总，最多 8 并发 |
| `dispose()` | 取消请求、停止实时字幕采集、关闭客户端、等待会话写入 |

HTTP 数据路由是 `/api/zhiyun-classroom`（`exact`），body 为 `{action, input}`。
**action 名与方法名逐字一致**：`searchResources` / `searchCaptions` / `check` / `transcribeAudio` /
`liveStart` / `liveStatus` / `liveStop` / `liveText`。老方法不在这条路由上
（它们历史上走 Cordis 服务对象，这里不改既有形状）。

## 课件缓存（`/zhiyun-slides`）

翻页卡顿的根因是**每翻一页都是一次带签名 URL 的网络往返**。`src/slide-cache.js` 是决策层（纯函数），`src/slide-store.js` 是文件层与路由，两者合起来把课件帧落到本地磁盘。

**只缓存 PPT，不缓存视频。** 视频是 HLS 分片长连接，要落几个 GB、还要处理 Range 与分片失效；PPT 是 100–300 KB 的 jpg，收益立竿见影。

三层分工，写错任何一层都会表现为「缓存好像没生效」：

| 关注点 | 位置 | 关键约束 |
| --- | --- | --- |
| 要不要下 / 叫什么 / 淘汰谁 | `slide-cache.js` | 键是**剥掉 query 的** `origin+pathname` 摘要 —— 智云图片带时效签名，拿完整 URL 当键等于每次刷新全量重下 |
| 索引、原子落盘、路由 | `slide-store.js` | 索引写临时文件再 `rename`；写一半的 JSON 会让整份缓存判为损坏而归零 |
| 何时补缓存 | `source.js` 的 `prefetchInBackground` | **读完再补**、不 await、按节去重、不跟调用方 signal |

目录布局与容量：默认 `<profile>/data/zhiyun-classroom/slides/`，`index.json` + `<页序>-<键前 12 位>.jpg`，上限 2 GB（约 100 节课），按 `usedAt` 做 LRU。淘汰按最近使用而不是最早创建 —— 否则用户最常看的那门课会被新看的挤掉。

失败一律降级：索引读不出、目录建不了、某页下失败，都只是「这次没缓存到」，不阻塞读课件。`getLessonContent` 未命中时**不带** `cacheUrl`，前端回退原始签名地址。

路由的安全姿态与直播转发**不同**，所以是独立前缀：

- 直播转发是「代你去 `*.zju.edu.cn` 取任意 URL」（防 SSRF）；
- 这里是「只给你我磁盘上已有的字节」（防路径穿越）。

挡穿越靠两道：键必须是 32 位十六进制；索引里的 `file` 必须是单段文件名（`isSlideFileName`，同时挡 `..`、`/`、`\` 与 `C:` 盘符相对路径）。前缀判断用**原始** pathname —— `new URL` 会把 `..` 折掉，先规范化再判前缀等于让穿越静默变成「另一个路由」。

`GET /zhiyun-slides/status` 报出 `{files, bytes, quotaBytes}` 供设置页显示。响应带 `Cache-Control: private, no-cache` + `ETag`（键+大小）：本地一次 304 只有零点几毫秒，换来的是「课件重传后不会永久显示旧图」。

## 直播（`source.live`）

直播与回放是两条不相交的通路，所以是独立的 `LiveSource`（`source.live`），但**共用同一个 transport** —— 同一次登录不该存在第二份 cookie。

| 方法 | 结果 |
| --- | --- |
| `listCurrent({signal,now})` | 此刻在播的课（今天 + 当前时段）；课间返回空列表 |
| `listLiveDay(date,{signal})` | 某天全天直播课；单时段失败标 `partial-quantum`，全失败才抛 |
| `remaining({now,course})` | **今天还值得起采集的直播课次** —— `liveStart` 的入参来源；已散场与非直播的筛掉 |
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

## 资源清单（`searchResources`）

对应上游 `zhiyun search resources`：**只看不下载**，回答「这几次课有什么」。

`models.lesson()` 的 `resources` 是课次响应里的那一段，没有种类标签、也不含
截图与字幕句数。`searchResources` 把它们拼成同一个带 `kind` 的数组：

| kind | 来源 | 额外字段 |
| --- | --- | --- |
| `video` | `content.playback.url` 与 `file_list` 里的视频 | `height`（从 URL 里的真实尺寸读，不信门户的清晰度槽位）、`durationMs` |
| `audio` | `file_list` 里的音轨 | 缺独立音轨时给一条 `available:false` 的说明项 |
| `ppt` | `content.download.ppt` | — |
| `slides` | **按需**调 `getSlides` | `count`（只给张数，不返回 83 个地址） |
| `subtitles` | **按需**调 `getSubtitles` | `count` |

`kind` 拼错**直接拒绝**（不静默忽略）—— 拼错一个种类却拿到「什么都没有」比报错难查。

`slides` / `subtitles` 的计数是额外请求，所以 `kind` 决定要不要付这个代价：
只问 `video` 时不会去拉一遍 PPT 与整份字幕。

当天还没点播的课次查字幕，上游是**拒绝**（`未查询到语音数据`）而不是给空表。
这一种按 0 句处理，其余失败照抛。判定在 `transport.json` 的 `tolerate` 里做 ——
那一层才看得到上游 `msg`（外面看到的只有统一后的「智云服务返回失败」）。

## 字幕关键词检索（`searchCaptions`）

对应上游 `zhiyun search subtitles`（`materials.ts:46` 的 `searchCaptions`）：
「老师有没有说点名」「考试范围讲到哪」这类问题，用时间轴一条条读是读不动的。

- 两种输入：给 `lessons`（`[{courseId, subId, date?}]`）直接搜；或给 `courseId`
  让它用 `getMyLectures({days})` 展开最近课次（跳过还没上课的）。
- 命中带**前后各一句**：命中词常常是「点名」这种孤立的两三个字，只给那一句看不出上下文。
- 没有字幕的课次进 `lessonsWithoutCaptions`（**如实报**，不是吞掉）—— 当天的课课后才有字幕，
  站点对这类是拒绝而不是空表。
- `counts` 按关键词分开计数；`total` 是真实命中数，`hits` 受 `limit` 封顶，超出时带 `truncated`。

## 本地组件诊断（`check`）

对应上游 `zhiyun check`，**只读**：不装东西、不下模型、不写文件。

| component | 查什么 | 关键判据 |
| --- | --- | --- |
| `media` | FFmpeg | 真的跑一次 `-version`（PATH 里有同名文件 ≠ 能跑）。可执行文件按 `FFMPEG_PATH` → `data/tools/zhiyun-media/...` → `ffmpeg` 顺序解析 |
| `asr` | 语音运行库与模型 | 运行库能否解析（`createRequire.resolve`，只解析不加载）+ 模型目录里三个文件在不在、多大 |

每个结果都带 `action` 字段，明说「缺什么、怎么办」—— 只说 `available:false`
没有用。

目录布局两种都认：`models/sensevoice-onnx/` + `models/silero/`（上游 `asr.ts` 与
宿主语音包的形状）与平铺的 `models/*.onnx`（手工摆放的常见形状）。结果里的
`layout` 写明按哪种找到的。大小不符（下载截断）算「没准备好」，不是「文件在」。

`asr` 的 `verified` **只在 `verify: true` 且三件摘要全对时为 true**；默认只比大小，
不冒充「校验通过」。

### `setup`：给计划，不执行（N-3）

上游 `setup`（`core/zju/lib/zhiyun/setup.ts`）是**写操作**：`media` 分支
`npm install ffmpeg-static@5.3.0`，`asr` 分支从 HuggingFace / hf-mirror 下载
约 241 MB 模型并落盘。前者在本仓是硬禁止，后者属安装层；两件都改**本机安装状态**。

所以本包给的是 `setupPlan()` —— 一份**可复算的安装计划**。它在
`src/diagnostics.js` 里（纯函数，不碰会话），由 `index.js` 的
`/api/zhiyun-classroom` 路由以 `action: 'setupPlan'` 暴露：

```js
const { value } = await (await fetch('/api/zhiyun-classroom', {
  method: 'POST',
  body: JSON.stringify({ action: 'setupPlan', input: { component: 'all' } }),
})).json();
// { component:'all', executed:false, totalBytes:241357257, steps:[...], reason:'…N-3…' }
```

（这是唯一入口：`setupPlan` 不在 `src/source.js` 的导出面上，本包也没有单独的
diagnostics 子路径导出。）

每一步都带确切的目标路径、URL、镜像 URL、字节数与 SHA-256，已就位的标
`satisfied: true`（免得重下 240 MB）。`executed` **恒为 false** —— 本方法一步都不做。

**这不是裁决 N-3 的替代品**：N-3 拒绝的是「把 sherpa-onnx 内核与权重内置进数据源包」，
本方法更退一步 —— 它连装都不装，只把 `check` 的「缺什么」翻译成「放到哪、从哪取」，
执行交给宿主安装层或用户。做完之后 `check` 立刻转绿。

### 本地转写现在**有装配方**了（漏-4 的收口）

调查后发现漏-4 的前提是错的：本仓**不需要**装 `sherpa-onnx-node`，也**不需要**下模型 ——
宿主 DeepSeek Harness 自带的
`@deepseek-ai/dsh-experimental-speech-to-text-sensevoice` 已经把这些都做了
（它注册 `speechToText` provider，自带运行库与 `assets.json` 清单，模型按需自下）。
缺的只是**没人把那个服务接到本包的 `transcriber` 接口上**。

`createHostTranscriber({ speechToText, executable, providerId?, language?, chunkSeconds? })`
就是那个适配器，它三点都是本包自己该做的编排：

1. **抽音频**：FFmpeg 转 16 kHz 单声道 PCM WAV（SenseVoice 唯一接受的格式）；
2. **按内核窗口切片**：宿主 provider 一条请求最多 4 MB，按时间轴切块分别送；
3. **拼句段**：provider 只回一整段文字、**没有时间戳**，所以给的是**块级**时间
   （`engine` 里写明 `chunked`），**不伪造成逐句时间**。

⚠️ **未真机验证**：本机没有启用宿主语音包、也没有权重（`~/.dsh/speech-to-text/`
不存在）。测试全部用假 provider 与假 FFmpeg 钉**编排**（切片、偏移、失败分类、
时间戳拼接），**没有**跑过真识别。

## 本地转写（`transcribeAudio`）

对应上游 `zhiyun trans audio`。

**本包没有内置识别内核**，但**现在有装配方**了（见上一节）。三条硬约束决定了
内核不能内置：`sherpa-onnx-node` 不在本仓依赖里（装它要 `npm install`，本仓禁止）；
240 MB 权重的下载属首次安装；上游借的是**宿主应用自带**的运行库。

所以本包把「编排」与「识别内核」拆开：

- **编排归本包**：路径与文件校验、落盘（原子换名）、缓存去重、超时、取消、结果形状；
- **识别靠注入**：`config.transcriber` 或 `source.setTranscriber(fn)`，
  形状是 `({file,directory,signal}) => ({segments:[{start,end,text}], engine?})`（秒）。
  现成的接法是 `createHostTranscriber({speechToText, executable})`。

没注入时**报 `DEPENDENCY_MISSING`**，不返回空文本 —— 否则「转写失败」看起来
和「这段音频没人说话」一模一样。

### 代价

- **时间**：上游实测，一节 148 分钟的录播在 CPU 上要跑**几分钟**。默认超时 30 分钟，
  超时会 `abort` 让内核真的收手（不是只放弃等待）。
- **盘**：中间 16 kHz 单声道 WAV 一节课近 300 MB，在 `finally` 里删掉；
  结果只落四个小文件。
- **可取消**：`signal` 一路传进内核。

### 产物（`directory` 下）

| 文件 | 内容 |
| --- | --- |
| `segments.json` | `[{startMs,endMs,text}]` |
| `transcript.txt` | 一行一句，便于直接喂给模型 |
| `transcript.md` | 带时间区间的粗稿，**首行写明「未做总结」** |
| `transcribe.json` | 缓存键（文件绝对路径 + 字节数 + 内核签名） |

落盘是**原子**的：先写 `<dir>/.transcript-<pid>-<n>.tmp/`，齐了再逐文件换名，
`transcribe.json` 最后落 —— 所以「看到缓存文件」等于「其余三个都已就位」。
失败时阶段目录整个删掉：半份结果比没有结果更难辨别。

## 实时字幕（`live`）

对应上游 `zhiyun live start/status/stop/text`。

### 它是长连接，而且不是 WebSocket

上游 `live-socket.ts` 的注释写「Official glue 1.9.1 read-only subscription」。
读协议之后可以确定：**HTTP comet 长轮询**，`POST` 到
`https://qlite2.cmc.zju.edu.cn/<频道>/glue/ajax`，服务端 hold 住请求直到有帧或超时。

```text
POST i                             → "uid&token"
POST u<uid>&in{"version":"1.9.1"}  → 订阅
POST u<uid>&pi                     → 心跳（服务端回 pi 时要回 po）
POST o<uid>&<token>                → "t"                超时，token 不前进
                                   → "<newToken>&<frame>" 有新帧
POST u<uid>&cl                     → 退订（停止时必须发）
```

帧命令：`in` 握手 / `pi`·`po` 心跳 / `cd` 字幕（`<频道长度>&<频道><JSON>`）/
`cl`·`dr`·`iv` 关闭 / 其它频道按 `other-channel` 忽略（**不是**错误）。

生命周期与心跳（照抄上游实测常量）：

- 空闲 **35 秒**推一次 `pi`；发出后 **8 秒**没有帧 → 判心跳无响应，作废重建；
- `"t"` 是超时响应，token **不前进**，必须原样继续；
- 断线按 1s→2s→4s… 退避，上限 30s，且不超过离截止还剩多久；
- 课次结束后继续听 5 分钟（老师拖堂），开课前 5 分钟开始尝试取地址；
- `sub_status` 为 `3` / `6` 表示已结束，**不再连一个死会话**。

### 在数据源层做长连接合适吗

**不完全合适 —— 这是本包明确做的取舍。**

包内其余方法都是「一次请求一次响应」。实时字幕是持续几十分钟到几小时的订阅。
上游把它交给一个**脱离宿主进程的后台采集器**（`live-task.ts`：Windows 走 WMI
起隐藏进程、POSIX `detached+unref`，配 `task.lock` / `owner.json` / `stop.json`
租约），所以 CLI 能「启动后立刻返回」。

本包**不**复制那套进程编排：数据源里 spawn 分离进程 + 写租约，等于把进程管理
塞进只读读取层，出问题时的症状是「有进程在跑但没人知道是谁的」。本包已有
「进程内后台任务」的先例（`prefetchInBackground`），沿用同一套比引入第二种
生命周期更容易审；而宿主是常驻 GUI 进程，不是一次性 CLI。

**四条方法因此按「会话」而不是「进程」设计**：

| 方法 | 语义 |
| --- | --- |
| `liveStart` | **只建立会话**：起后台循环后立刻返回，**不**等到收第一条字 |
| `liveStatus` | **纯本地快照**，不联网、不改状态；`receiving` 区分「连上了」和「真收到字了」 |
| `liveText` | 取窗口内**已收**文字，并逐段报出**缺口**；**不等待未来** |
| `liveStop` | 停定时器、退订、状态落成 `stopped`；**已收到的字不删** |

`liveText` 与上游有一处**有意不同**：上游会为 `--after` 阻塞到点
（`live-task.ts:186-194`），那是 CLI 的一次性语义。本包是长驻服务，阻塞式等待
会把宿主的一个请求挂上几分钟。未来部分用 `pending` 标出来，调用方自己决定
要不要再查一次。

`dispose()` 会先停干净采集再关 transport：只 `abort` 不 `await` 的话，
退订请求 `u<uid>&cl` 根本发不出去，服务端会留着那路订阅。


## 账号恢复与网络出口

宿主服务的 `getCurrentUser()` 会按需恢复登录。并发状态读取共用一次登录，失败后 60 秒内不重复提交；更改保存的账号或密码会立即触发重新认证，并清除旧账号会话。已有 SSO 时先续接业务授权，只有校方实际返回登录表单才提交密码，不把旧票据当成登录成功证据。显式退出后，本次运行不会立即自动重连；纯 `ClassroomSource` 库仍由调用方管理登录。

课堂请求使用本包自己的直连 dispatcher，与宿主 AI 服务的代理相互独立。会话仍保存到当前 profile 的 DPAPI 文件，实验目录中的会话不会被 App 自动发现。
