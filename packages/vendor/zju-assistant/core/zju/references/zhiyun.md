# 智云课堂

查询用 `zhiyun search`，下载用 `zhiyun download`，本地录音转写用 `zhiyun trans audio`。业务命令自动处理认证，`zhiyun session` 仅用于会话排障。完整参数见各命令的 `--help` 或 [命令总表](commands.md#zhiyun)。

## 查询与下载

```text
zhiyun
├─ search    courses · lessons · resources · subtitles   找课、看课次与资源、搜字幕
├─ timetable                                             本人某几天的课次（含研究生课）
├─ download                                              下载回放、音频、课件、截图、字幕
├─ live      start · status · stop · text                上课时的实时字幕
├─ trans     audio                                       本地录音转写
├─ setup · check                                         本地依赖
└─ session                                               排障用
```

课程写名称，可用简称（计组）；课次写第几次（`--lesson 1`、`--lesson 1,3-5`）或日期（`--date 2026-09-28`），也可 `--week-of 日期` 取那一周、`--all` 取全部，四种只给一种。智云录播对全校开放：课程名先在我的课程里找，没有再搜全站，没选的课也能查。

- 同名课程有多位教师时加 `--teacher 教师名`。同一门课开过多个学期时默认取当前学期的；当前学期没开就取最近一次开的，不取还没开始的学期。结果开头写明取的是哪位教师、哪个学期，默认取过时带 note。要别的学期：`search courses --keyword 课程名` 找到那一门，把它的 courseId 写到 `--course`。
- `search courses --keyword 课程名` 返回课程、教师、学期（如 2026-2027秋冬）。scope 为 all 表示这些课不是用户选的。
- `search lessons --course 课程名` 列出每次课：lesson（第几次）、date、time、能否回放 playable、有哪些资源 kinds。编号按开课时间，含还没上的。
- `timetable --from 2026-11-02 --to 2026-11-08` 列出本人这几天在智云上的每节课：日期、起止时间、课程、教室、老师，默认本周，一次最多 42 天。研究生课的正式课表用 `yjsy timetable`。
- `search resources --course 课程名 --lesson 1` 看某次课有什么：回放视频（带地址与清晰度）、音频、课件、课堂截图张数、字幕句数。只是查看；要文件用 download，不是下载的前置步骤。
- `search subtitles --course 课程名 --keyword "点名、签到、考勤"` 在录播字幕里搜老师说过的话（点名、考试范围、作业要求等），几个说法用顿号或竖线分隔；省略课次时搜全部有录像的课次。每处命中给出第几次课、日期、时间点和前后各一句；字幕里的「点名」可能是叫人回答问题，按前后文判断。当天的课课后才有字幕，列在 lessonsWithoutCaptions。不用先下载字幕再自己搜。
- `download --course 课程名 --lesson 1 --kind ppt` 下载并返回 `files`：每个文件的课次、日期、种类、本地路径和大小；没有该类资源的课次列在 `skipped`。kind 支持 video,audio,ppt,slides,subtitles，默认 ppt，可逗号分隔多种。视频取 1080p；只要音频时用独立音轨或 360p 视频提取。`--dry-run` 只列出将下载什么。可指定 `--audio-format`；并发、超时、重试和续传由内部处理，下载过的文件校验后复用。
- 文件默认放进用户的「文档」：`文档\CampusAgent\课程\课程名\第N次 日期\`，一次课一个文件夹（课件在 `materials\`，截图在 `slides\`，字幕是 `subtitles.json/txt`，回放是 `video.mp4`），结果里的 `outDir` 是这门课的文件夹。用户指定位置时加 `--out-dir`，整批放进那个目录。还没有字幕的课次（当天的课、没上的课）列在 `skipped`，不影响别的课次。

## 课堂实时文字

`zhiyun live start` 后台采集今天本人剩余课堂的官方字幕，自动等待开课、按课次切换，最后一节结束后退出；只听一门课可加 `--course 课程名`。用普通前台终端调用，命令自行启动后台并立即返回状态，随后直接回答；命令返回后采集继续，重复启动同范围复用任务。执行机需要保持在线，启动成功不等于已收到字幕。

`zhiyun live text` 返回刚才五分钟的已保存文字。指定课程加 `--course`；指定时刻用 `--at "2026-09-30 13:40"` 或 `--at 13:40`，可用 `--before 300 --after 300` 调整前后秒数。未来部分由命令内部等待；多个课次有歧义时返回候选。晚启动或断线造成的缺失会直接说明；preview 是尚未定稿的文字，不能当作多次独立发言。

查看采集用 `zhiyun live status`，停止用 `zhiyun live stop`。停止保留已保存字幕；查询文字不会自动启动监听或补回此前内容。live start 只采集文字。当前没有自动音频转写兜底。

这些命令与其他智云命令一样统一远程执行。文字内嵌在结果中，file/directory 是执行机上的持续采集文件，status/text 不把整个增长目录复制回调用端。

## 转写

```powershell
node scripts/zju.ts zhiyun trans audio --file 录音.m4a
```

**音频**：接受 FFmpeg 可读取的本地音视频（下载的回放也行），转成 16 kHz 单声道后转写。模型是 SenseVoice，在本机 CPU 上跑，不需要 Python 和显卡；模型约 240 MB，第一次转写时自动下载，与应用的「语音输入」共用同一份。一节 90 分钟的课转写要几分钟。返回的 `markdown` 指向带时间的 `transcript.md`（约 15 秒一段），`text/segments/raw/metadata` 保留文字与原始结果。同一个文件再转一次直接复用；人工改过的 Markdown 不覆盖。

结果默认放进用户的「文档」：课次文件夹里的文件（如 `…\第3次 2026-10-08\video.mp4`）转出来放在那次课的 `转写\文件名\` 下，别处的文件放在 `文档\CampusAgent\转写\文件名\`；指定位置加 `--out-dir`。有官方字幕的课次直接 `download --kind subtitles`，不用转写；转写留给没有字幕的课次和自己录的音。专业词三种来源都会错（「摊还」常写成「瘫痪」），对照课件校正。

课件不用另外提取：下载下来的课件要文字用 `doc text --file 文件`，要看版面、公式和图就把页面渲染成图自己看（见技能说明里读文档的那几行）。

整理课堂笔记时，读取转写和课件，按 [笔记模板](zhiyun-notes-template.md) 直接成稿。核对作业、日期、公式和老师更正，保留原始粗稿；用户已有改稿时另存版本。已有转写结果直接读取，无需重复处理。

## 依赖检查

转写没有可选的引擎、设备或批量参数，也不用先安装：`trans audio` 自己检查模型，缺了就下载。只有音频要先转格式，所以需要 FFmpeg。

缺少组件或排障时使用 `zhiyun check --component asr|media`，按结果调用 `zhiyun setup --component 同名组件`。asr 是转写模型（`setup` 只下载模型，下载源先回应的优先，校验通过才启用）；media 是 FFmpeg（应用自带）。检查、转写和课件提取不需要校园登录。

## 可选远程执行

运行环境中的 `ZJU_ZHIYUN_REMOTE=<SSH别名或user@host>` 与 `ZJU_ZHIYUN_REMOTE_ROOT=<仓库绝对路径>` 可将智云命令交给另一台执行机；未配置时本地执行。当前执行端为 Windows PowerShell，调用端支持 Linux 和 Windows。可选 `ZJU_ZHIYUN_REMOTE_NODE`、`ZJU_ZHIYUN_REMOTE_KEY`、`ZJU_ZHIYUN_REMOTE_PORT` 指定 Node、私钥和端口；默认 Node 命令为 `node`，端口 22。执行机须在线，并已配置免密 SSH、可信主机密钥及自己的账号文件和依赖。

- 原有命令与参数保持不变；CLI 自动传输文件和回传产物，每次业务命令只远程执行一次（输入副本失效时在命令开始前就退回重传，不算执行）。文件传输用 SFTP，连接中断时自动从已传部分续传（最多 4 次）。
- `--file` 使用调用端文件并自动上传；明确的 Windows 绝对输入路径也可引用执行机文件。上传的副本放在执行机的 `data/cache/remote-input/`，同一文件通过两端哈希校验后复用；两周没用过的副本自动清理，被清理或改动过的在下次使用时自动重新上传。
- `--out/--out-dir` 指调用端输出位置；默认下载回到 `data/output/zhiyun/remote/<目标哈希>/`。原图、目录结构和 Markdown 链接一起回传，返回的业务文件路径可在调用端直接读取。
- 检查、安装和会话命令只回传结果，不复制模型、可执行文件或凭据。调用端已修改的文件拒绝覆盖；传输失败保留错误信封和非零退出码。
- 网络中断或取消不自动重发业务命令。重试前先确认原任务已结束；执行机副本与结果保留用于缓存，调用端映射保存在 `data/cache/zhiyun-remote/`。

