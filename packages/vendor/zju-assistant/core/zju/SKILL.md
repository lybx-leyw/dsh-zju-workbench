---
name: zju
description: 浙江大学校园任务工具，查询课表、成绩、作业、课件和课程信息，学校各部门和本人学院的通知公告（教务网、学工部、研工部、团委、综合服务网、各学院官网等）和新通知，二课、三课的活动与本人记点（素质拓展平台，文件里常叫素拓网），学校订购的电子图书在哪个平台有全文（图书馆电子图书导航、超星电子书），体艺场馆空场、预约须知与放号时间，CC98 论坛帖子与帖内图片视频下载（file.cc98.org 等校网链接经 WebVPN 获取），读取 PDF、Word、PPT、Excel 等文档的文字（本地文件或链接），PDF 找页、切页、取出其中的图片或把某页渲染成图，照片和 Word 转 PDF，超星学习通（泛雅）课程的课件与视频下载，在中国知网检索中文论文（期刊、学位论文、会议）并用学校 IP 下载全文 PDF，执行已授权的学在浙大签到、场馆预约与取消、选课、作业提交和二课活动报名。zju.edu.cn、cc98.org 的链接直接用 curl 或网页提取会超时或要求登录，一律先用本技能。
---

# zju

用 `node "<SKILL>/scripts/zju.ts" <模块> <命令>` 执行，`<SKILL>` 换成本技能的目录。目录里常有空格（`C:\Program Files\…`），脚本的路径要像这样用双引号括起来。普通业务自动认证、分页、匹配目标和回查；直接读取结果，不先登录、探字段或生成中间 JSON。名字不唯一时结果会给候选，不猜测。

常规查询成功后直接按结果回答，不再读取源码、开发记录或重复请求；命令报错时才作必要诊断。

学校相关的问题（课程、成绩、考试、选课规则、通知、校内办事流程等）第一步用本技能：先读下方对应的参考文档，几步连起来的事照末尾列的技能走，能回答就直接作答；只有需要当期日期、名单等实时信息时才调用命令（如 `notice list --keyword 关键词`）。本技能确实没有答案时才联网，并说明信息来源。与学校无关的普通请求照常联网搜索。

## 日常调用

| 用户目标 | 调用 |
|---|---|
| 某天的课、下节课或教室 | `campus_schedule_read`，用 from/to 指定日期，已经处理校历、单双周、放假和调休；只看教务原始周课表时用 `zdbk timetable` |
| 研究生课表（研究生，或选了研究生课的本科生） | `yjsy timetable`，研究生院教务系统的课表，默认现在这个大学期，每次课的日期已经算好；本科教务网 `zdbk` 里没有研究生课 |
| 实验课哪天做什么、在哪个实验室 | `lab timetable`，按日期列出实验名、实验室、开始时间和教师 |
| 考试时间、考场、座位 | `zdbk exams`，可加 `--course 课程名`，期中与期末分开返回 |
| 成绩、GPA、学分 | `zdbk grades`，一次返回全部课程成绩、各学期与总体五分制绩点、主修绩点和已获学分 |
| 我是哪个学院、哪个专业、哪个行政班 | `zdbk student`，本科教务网上的本人学籍；研究生查不到 |
| 最近的通知，按关键词、部门或学院找通知（选课、推免、转专业、奖学金、资助、竞赛、二课、志愿、停电等） | `notice list`，默认最新 10 条完整正文与附件，来自本人学院官网、团委、综合服务网，以及按本科生或研究生自动选的教务网、本科生院、学工部或研工部、研究生院；可加 `--keyword`（几个说法用顿号一次给完）、`--source`（来源名、栏目名或学院名，如学工部、评奖评优、团委、控制学院；本人学院写 学院）、`--since`/`--until`、`--limit` |
| 有没有新通知、哪些新通知和我有关 | `notice new`，只回上次调用之后新发布的标题、日期、来源和链接；按标题挑出相关的，再用一次 `notice view --url` 取全文，不要逐条都取 |
| 某条通知全文 | `notice view --url 通知链接`，多条用竖线分隔一次取完；只知道标题时 `--title 通知标题` |
| 二课、三课分够不够，拿了多少，哪些活动记了点 | `sztz credits`，一次返回第二、三、四课堂的记点、学分、是否达标，美育劳育是否达标，和每一条认定记录 |
| 最近有什么二课活动可以报、某天有什么活动 | `sztz activity list`，还没结束的活动，报名中的在前，带记点、时间地点、报名方式和截止时间；可加 `--keyword 举办单位或活动名`、`--date 日期`。只问有没有新出的活动用 `sztz activity new`（上次调用之后新出现的，没有简介） |
| 竞赛、社会实践、实习能记多少点 | `sztz projects`，可加 `--keyword`、`--category 第三课堂` |
| 我报名和收藏的二课活动 | `sztz activity mine` |
| 报名、取消报名明确的二课活动 | `sztz activity signup --name 活动名 --confirm`，取消报名是同一个命令加 `--cancel`；设置 `ZJU_ALLOW_WRITE=1`，一条命令完成查找、提交和回查；写着不在本平台报名的活动会返回它自己的报名方式 |
| 收藏、取消收藏二课活动 | `sztz activity favorite --name 活动名 --confirm`，取消加 `--cancel`，同样设置写闸 |
| 有没有某本书的电子版、在哪个平台能看 | `ebook search --title 书名` 或 `--isbn`；一次查图书馆电子书刊导航和超星电子书，返回这本书和各平台的直达地址，把地址给用户在浏览器里打开，命令不下载 |
| 培养方案 | `zdbk plan view`，本人专业的学分、核心课和完整 PDF（`file`，用 `doc text` 读）；别的专业加 `--major 专业名` |
| 查作业、DDL | `xuezai todos`，自动合并原生待办和课程作业，按截止先后给出北京时间和 currentTime |
| 某课作业 | `xuezai homework list --course 课程名`；某个作业的完整要求和我的提交记录 `xuezai homework view --course 课程名 --name 作业名`；老师随作业给的附件 `xuezai homework attachments --course 课程名 --name 作业名`；我交过的文件、老师批改后传回的文件 `xuezai homework download --course 课程名 --name 作业名` |
| 找课件、看一门课每章有什么 | `xuezai material list --course 课程名`；章节和活动 `xuezai course view --course 课程名` |
| 下载课件 | `xuezai material download --course 课程名 --name 文件名`，多个用竖线分隔，某一章的全部用 `--chapter 章节名`，整门课全部用 `--all`（后两种不含视频，要视频再加 `--video`）；返回本地路径 |
| 超星学习通的课件 | 一条命令直接下载：`chaoxing material download --course 课程名 --chapter 实验或章节名`，返回本地路径。章节名照用户的说法写，命令自己会对上（差一两个字也行），不要先 list 再找。只有用户问「有哪些」时才用 `chaoxing material list --course 课程名`（只看一章加 `--chapter`） |
| 超星学习通的视频 | 同上，换成 `chaoxing video download` / `chaoxing video list`；课件和视频都要时两条各调一次。默认下原文件（几百 MB）；用户要快、要小或要把视频发过去时加 `--quality playback`（720p，十几 MB）。用户给了学习通课程页面链接时，链接原样写进 `--course` |
| 超星学习通的作业、测试 | `chaoxing homework list`，只看一门课加 `--course 课程名`；老师放在学习任务里的也在内。`deadline` 是 `null` 的老师没设时间，常常其实交到别的平台，不要催 |
| 提交明确的作业 | `xuezai homework submit --course 课程名 --name 作业名 --file 文件 --confirm` |
| PTA 作业 | `pta homework list`；一份作业的小题 `pta homework view --set 作业名`，看某题 `pta problem view --set 作业名 --problem 7-1`；作业写名称里的一段，小题写题号。作答见 [PTA](references/pta.md) |
| 找某课程教学班 | `zdbk selection sections --course 课程名`，可加 teacher/time 限定 |
| 保存已选定的志愿 | `zdbk selection select --course 课程名 --teacher 教师 --confirm` |
| 查实验班 | `lab labs --course 课程名` |
| 选明确的实验 | `lab select --course 课程名 --lab 实验名 --week 周次 --confirm`，退掉加 `--cancel` |
| 这几天在智云上有哪些课次（教室、起止时间） | `zhiyun timetable --from 日期 --to 日期`，默认本周；本人在智云上的全部课次，本科课和研究生课都在 |
| 找智云课程 | `zhiyun search courses --keyword 课程名`，自动翻页；没选的课也能找到 |
| 老师在课上说没说过某事（点名、考试范围、作业） | `zhiyun search subtitles --course 课程名 --keyword "点名、签到"`，几个说法用顿号一次给完；搜全部录播字幕，返回第几次课、时间点和前后文 |
| 下载智云材料 | `zhiyun download --course 课程名 --lesson 课次 --kind ppt`；也可用日期限定 |
| 上课实时转写 | `zhiyun live start`，指定课程加 `--course`；普通前台调用，命令自行启动后台，收到结果后直接按 message 回答 |
| 刚才老师说了什么 | `zhiyun live text`，默认最近五分钟，时间窗口见 [智云](references/zhiyun.md) |
| 转写本地录音 | `zhiyun trans audio --file 文件`，模型（第一次用时自动下载）和输出目录自动处理；有官方字幕的课次直接下字幕，不用转写 |
| 教师评价 | `chalaoshi teacher --name 姓名`，默认附评论；limit 控制数量 |
| 在知网找论文、中文文献 | `cnki search --keyword "词一 词二"`，多个主题词同时匹配，篇名不一定含全部词，结果足够就直接回答；指定篇名含词才用 `--title`。按要求加 `--year 2024-2026`、`--type 期刊`（或学位论文、博士、硕士、会议、报纸）、`--core CSSCI`、`--author 姓名`、`--source 来源`、`--sort cited`（或 date、downloads）、`--limit 条数`，见 [知网](references/cnki.md) |
| 下载知网论文 | `cnki download --title 完整篇名`，返回本地 PDF 路径；已知篇名直接下载，不先 search；同名时按候选加 `--author`。多篇用竖线分隔，30 篇也放进一次调用，命令自行分批串行；按 `message`、`files`、`failed`、`pending` 报告进度 |
| 体育场馆空场 | `tyys venue list --sport 运动 --campus 校区 --venue 场馆 --date 今天`；日期支持今天至3天后，场馆不唯一时返回候选 |
| 场馆放号时间、预约须知 | `tyys venue notice`，一次返回须知全文和各场馆放号时间 |
| 预约明确的体育场馆 | `tyys venue book --venue 场馆 --sport 运动 --date 日期 --time 19:00 --confirm`；设置 `ZJU_ALLOW_WRITE=1`，只约一次：处理验证码与同伴、确认付款并回查，没放号、没空场直接返回，不等；具体限制见 [体艺](references/tyys.md) |
| 我的场馆预约、取消预约 | 查看 `tyys venue order list`；已授权取消 `tyys venue order cancel --venue 场馆 --date 日期 --time 时段 --confirm`，同样设置写闸 |
| 学在浙大签到 | `xuezai rollcall --confirm` 默认 GPS/雷达；明确数字签到用 `xuezai rollcall number --confirm`，签到全开用 `xuezai rollcall all --confirm`；设置 `ZJU_ALLOW_WRITE=1`，见下方签到说明 |
| 现在有没有点名、以前的点名和缺勤记录 | 学在课程 `xuezai rollcall status`、`xuezai rollcall history`，体育课 `tyys rollcall history`；history 可加 `--course 课程名`，均只读 |
| 读 PDF、Word、PPT、Excel（含 doc/ppt/xls）等文件的文字 | `doc text --file 本地文件` 或 `--url 链接`；校内和 CC98 链接、教务网附件自动处理登录。各命令下载到的文件（课件、通知附件、论文）也用它读，不自行安装解析库或写下载脚本。结果是 `no_text`（扫描件、截图做的课件）时把页面渲染成图来看 |
| 照片、截图、Word 转成 PDF，或几个文件合成一个 PDF（交作业等） | `doc pdf --file 文件`，多个文件的写法见表后 |
| 从 PDF 里只取几页（如课本的某章习题） | 先 `doc find --file 课本.pdf --keyword 习题一` 看在哪几页，再 `doc pages --file 课本.pdf --pages 43-49` |
| 看文件某一页长什么样（版面、公式、图表、扫描件），或要整页的图 | 不在本技能里：用对话开头「看文件」那一段给的渲染命令把页面转成 PNG，再看图。PDF、Word、PPT、Excel 都行，不另装库 |
| CC98 消息 | `cc98 account notifications`，一次返回回复、@、系统通知的内容和未读私信 |
| CC98 私信 | `cc98 private-message list`，未读的对话直接带出；回私信用 `cc98 private-message send --user 用户名 --content 文本 --confirm` |
| CC98 搜索、看帖 | `cc98 search --keyword "说法一、说法二、说法三"`，几种说法一次给完，不要一个词调一次；看帖 `cc98 topic view --id 主题ID`，一次就有主楼全文和热评；多个帖写成 `--id "A|B|C"`，连读多页 `--page 2-5`，只看楼主加 `--lz`，只找提到某些词的楼层加 `--find "词一、词二"`；结果都在 `topics` 列表里；版面直接写名称 `cc98 board topics --name 版面名`，十大 `cc98 hot` |
| CC98 回帖、发主题 | `cc98 topic reply --id 主题ID --content 文本 --confirm`，楼主回帖要通知所有回复过的人加 `--notify-all`；`cc98 board post --board 版面 --title 标题 --content 正文 --confirm`；带图加 `--image 图片路径`（私信也可以），多张用竖线分隔 |
| CC98 改自己发的楼 | 先 `cc98 floor original --post 楼层ID` 取原文，再 `cc98 floor edit --post 楼层ID --content 新的完整正文 --confirm`；改主题楼时标题、格式和标签沿用原来的 |
| CC98 帖子里的图片、视频、附件 | `cc98 topic download --id 主题ID`，默认 1 楼，其他楼加 `--floor 楼层`；只有文件链接时 `--url 链接`。自动经 WebVPN，返回本地路径 |

`doc pdf` 多个文件用竖线分隔、按给出的顺序排页，如 `doc pdf --file "第1页.jpg|第2页.jpg" --out 学号_姓名_第二次作业.pdf`。图片自动转正、居中放 A4；用户要原图大小时加 `--size original`。

“下节课”用 campus_schedule_read 返回的具体日期安排与当前北京时间判断，正在上的课不算下一节；它是应用工具，不拼成 zju 命令。校历缺失或读取失败时照 notes 说明，不能按普通星期表断言当天上课。只有所问的那节课是实验课时，才再调用一次 `lab timetable` 取当天的实验室。原始课表返回 `cache.stale` 时说明缓存时间，不反复登录。

考试 status 为「未公布」表示时间还没出，已公布但没有 location、seat 表示考场和座位号还没出。通知关键词已含常见简称的全称（filters.searchedKeywords），一次结果即可作答，不换词重查。通知 status=partial 时说明未取全，sourceErrors 列出这次没读到的来源；attachment-only 表示正文在附件，summary-only 仅为摘要。

## 场馆预约

场馆预约目标已明确时直接调用 `tyys venue book`，今天到三天后都行；不先调用 list、notice、session 或 check 做预检。book 自行查询并处理同伴、验证码和回查；目标日期还没放号时返回预计放号时间，照实告诉用户到时再约；时段约满时返回相邻时段；确实缺用户选择时会返回候选。场馆是半点时段等情况下，按返回的相邻时段问用户，不再查询一次、不擅自改时间。

## 签到与考勤

“帮我签到”“学在浙大签到”默认学在 GPS/雷达，直接执行，不先查 status。在 PowerShell 同一次调用中设置写闸：

`$env:ZJU_ALLOW_WRITE='1'; node "<SKILL>/scripts/zju.ts" xuezai rollcall --confirm`

明确说“数字签到”换成 `xuezai rollcall number --confirm`，明确说“签到全开”换成 `xuezai rollcall all --confirm`。数字入口内部准备课堂字幕、取码与回查，无需另调 live start；课前开启并给出覆盖课堂的时长才能保留此前报码。全开组合 GPS 和数字两路，任一路确认签上后两路一起停止。普通签到只走 GPS，不开启数字或智云。数字签到遵守智云插件开关，停止时只关闭本次创建的采集。

默认挂 10 分钟，每 4 秒一轮，确认签上立即停止。用户指定时长才传 `--duration 秒数`，指定轮询间隔才传 `--interval 秒数`；明确要求持续到成功时用覆盖本次课的时长，不用默认 10 分钟替代，也不另建定时续接任务。不需要坐标或课号。

签到用应用的 `pwsh` 工具，设置 `run_in_background: true`，启动后说明正在监测；用返回的任务 ID 和 `job_output` 读取最终结果。只有 status 为 signed/already-signed 才说签到完成，其余按 message 报告，不能把启动或空结果说成成功。细节见 [学在](references/xuezai.md)。

只查当前点名用 `xuezai rollcall status`；历史和缺勤记录用 `xuezai rollcall history`，体育课用 `tyys rollcall history`，两种 history 都可加 `--course 课程名`；问历史未说平台时两个都查。体育课仍只查考勤，不提交签到；CC98 签到必须明确提到 CC98。

本技能不抢课、不抢场馆。要求到点抢课或一放号就抢场时说明不支持，可以查询教学班余量和场馆空场；正常选课和有空场时的一次预约照常。

## 操作边界与结果

- 写操作需要当前任务授权，并设置 `ZJU_ALLOW_WRITE=1`、`--confirm`；已有授权不重复询问。选课歧义必须先明确目标。
- 保存、提交、开考、交卷是不同业务，不能擅自合并。PTA 自动回查；recovered-previous-operation 表示只恢复了上次操作，本次没有新的写入。
- stdout 是完整 JSON；失败读取 error.message/detail，不能只提取 data 或忽略退出码。
- 不绕过 ZJU_DISABLED_MODULES。会话维护及网络诊断仅在排障时使用，参数见 [命令总表](references/commands.md)。
- CC98 发帖、回复、私信遵守站点规则，只发布用户提供并授权的内容。
- 技能目录（SKILL.md、references、代码、dev）和应用自带的技能（`../skills/`）只由开发维护，使用中不新增或修改其中任何文件；探索出来的做法按上文用 campus_skill_save 存，不写进这个目录。查到的课表、成绩、作业这些随时能再查，不往记忆里存；用户明确让你记住关于他本人的事时，先用 campus_profile_read 搜一下有没有同主题的记忆，再用 campus_profile_write 新建或更新那一条，来源写在属性里；用户让记的一件事（报名、截止时间）用 campus_note_write 记进备忘录；不写进 references，也不另建个人记忆副本。账号、密码由用户在应用的「插件」页填写，学院和专业在设置的「个人档案」里填写，都不要代填。

## 文件交付

文件就在用户本机，交付时用下载结果里的原路径，不复制、不重新下载。上传作业给老师与把文件给用户是不同动作。大文件/整包资源的范围由用户决定。

## 按需参考

[教务](references/zdbk.md) · [通知](references/notice.md) · [二三四课堂](references/sztz.md) · [电子图书](references/ebook.md) · [选课](references/zdbk-selection.md)（多轮流程见 [选课](../skills/course-selection/SKILL.md) 技能） · [实验课](references/lab.md) · [学在](references/xuezai.md) · [体艺](references/tyys.md) · [PTA](references/pta.md) · [超星学习通](references/chaoxing.md) · [智云](references/zhiyun.md) · [CC98](references/cc98.md) · [查老师](references/chalaoshi.md) · [知网](references/cnki.md)

几步连起来、跨几个系统的事照应用自带的技能走：[选课](../skills/course-selection/SKILL.md) · [考前复习](../skills/exam-prep/SKILL.md) · [课程学习](../skills/course-study/SKILL.md) · [我的一周](../skills/my-week/SKILL.md) · [交作业](../skills/homework-submit/SKILL.md)。它们在技能目录里各有一项，里面的命令照本技能的写法执行。比较教学班与老师是选课技能的一部分。

提醒和定时见 [定时任务](references/schedule.md)。
