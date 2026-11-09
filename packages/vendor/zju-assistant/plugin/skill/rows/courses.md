## 课程与学习

教务网（zdbk）、研究生教务网（yjsy）、学在浙大（xuezai）、PTA（pta）、大物实验课（lab）、智云课堂（zhiyun）、超星学习通（chaoxing）、电子书（ebook）、知网（cnki）。下表是 `zju` 的 `args`。

| 用户目标 | 调用 |
|---|---|
| 某天的课、下节课、教室 | `campus_schedule` 的 `read`；只看教务原始周课表时 `zdbk timetable` |
| 实验课哪天做什么、在哪 | `lab timetable` |
| 考试时间、考场、座位 | `zdbk exams`，可加 `--course 课程名` |
| 成绩、GPA、学分 | `zdbk grades` |
| 研究生课的原始课表（研究生，或选了研究生课的本科生） | `yjsy timetable`，可加 `--year 2026-2027 --term 冬`；日程表已经把它和本科课表排在一起，问哪天上什么课还是先用 `campus_schedule` |
| 本人学院、专业、行政班 | `zdbk student`（研究生查不到） |
| 培养方案 | `zdbk plan view`，别的专业加 `--major 专业名` |
| 作业、DDL | `xuezai todos` |
| 某课作业 | `xuezai homework list --course 课程名`；要求和我的提交 `xuezai homework view --course 课程名 --name 作业名`；老师给的附件 `xuezai homework attachments …`；我交的和批改回来的 `xuezai homework download …` |
| 课件 | 列出 `xuezai material list --course 课程名`；下载 `xuezai material download --course 课程名 --name 文件名`（多个用竖线分隔，一章 `--chapter`，整门课 `--all`） |
| 提交作业 | `xuezai homework submit --course 课程名 --name 作业名 --file 文件 --confirm`，流程照 [交作业]({{core}}/skills/homework-submit/SKILL.md) |
| 学在浙大签到 | `xuezai rollcall --confirm`（数字签到 `xuezai rollcall number --confirm`，全开 `xuezai rollcall all --confirm`）；默认挂 10 分钟，`timeoutSeconds` 给到 `--duration` 再加 60。只有 status 为 signed/already-signed 才算签上 |
| 点名和缺勤记录 | `xuezai rollcall status`、`xuezai rollcall history`，体育课 `tyys rollcall history` |
| PTA | `pta homework list`；小题 `pta homework view --set 作业名`；某题 `pta problem view --set 作业名 --problem 7-1` |
| 选课 | 教学班 `zdbk selection sections --course 课程名`；保存志愿 `zdbk selection select --course 课程名 --teacher 教师 --confirm`；多轮的流程照 [选课]({{core}}/skills/course-selection/SKILL.md) |
| 实验 | `lab labs --course 课程名`；选 `lab select --course 课程名 --lab 实验名 --week 周次 --confirm`，退加 `--cancel` |
| 智云录播 | 找课 `zhiyun search courses --keyword 课程名`；老师说没说过某事 `zhiyun search subtitles --course 课程名 --keyword "点名、签到"`；下载 `zhiyun download --course 课程名 --lesson 课次 --kind ppt` |
| 上课实时转写、刚才老师说了什么 | `zhiyun live start`；`zhiyun live text` |
| 转写本地录音 | `zhiyun trans audio --file 文件` |
| 学习通课件、视频 | `chaoxing material download --course 课程名 --chapter 章节名`，视频换成 `chaoxing video download`（要小加 `--quality playback`）；问「有哪些」才用 `… list` |
| 学习通的作业、测试 | `chaoxing homework list`（只看一门课加 `--course 课程名`）；学习任务里的也在内。`deadline` 是 `null` 的老师没设时间，常常其实交到别的平台，不要催 |
| 某本书的电子版 | `ebook search --title 书名` 或 `--isbn` |
| 知网论文 | 检索 `cnki search --keyword "词一 词二"`；下载 `cnki download --title 完整篇名`，多篇用竖线分隔一次给完 |
| 读 PDF、Word、PPT、Excel 的文字 | `doc text --file 本地文件` 或 `--url 链接`；照片和 Word 转 PDF `doc pdf --file "a.jpg|b.jpg" --out 名字.pdf`；找页和切页 `doc find`、`doc pages` |

不抢课：到点抢课说明不支持，可以查教学班余量。

PTA 登录要过验证码时，`zju` 会在插件用本机默认浏览器开的窗口里打开验证码，先自动作答，认不出来时请用户在窗口里做完；报没找到能用的浏览器时，请他装一个 Chrome 或 Edge。

东西放哪：课程资料在用户「文档」的 `CampusAgent\课程\<课程名>\第N次 日期\`，由下载命令自己放好，不要另起位置；一次课的总结存成这次课文件夹里的 `总结.md`。「学习」页照这些文件夹画，放错了用户就看不到。交付文件时给出它的路径。

几步连起来的事照工作流走：[考前复习]({{core}}/skills/exam-prep/SKILL.md) · [课程学习]({{core}}/skills/course-study/SKILL.md) · [我的一周]({{core}}/skills/my-week/SKILL.md)。命令细节：[教务]({{core}}/zju/references/zdbk.md) · [选课]({{core}}/zju/references/zdbk-selection.md) · [学在]({{core}}/zju/references/xuezai.md) · [PTA]({{core}}/zju/references/pta.md) · [实验课]({{core}}/zju/references/lab.md) · [智云]({{core}}/zju/references/zhiyun.md) · [学习通]({{core}}/zju/references/chaoxing.md) · [电子书]({{core}}/zju/references/ebook.md) · [知网]({{core}}/zju/references/cnki.md)
