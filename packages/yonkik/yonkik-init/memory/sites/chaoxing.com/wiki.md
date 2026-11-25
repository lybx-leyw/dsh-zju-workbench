# 学习通（超星 / chaoxing.com）

> **本页索引**：这是什么 · 登录与滑块真相 · 接口 · 坑 · 只读边界 · 未闭环 · 合规与风险

**状态**：done（2026-11-20）｜**鉴权**：账密表单（非 CAS）｜**限流**：串行 2s / 并发 1
**脚本**：`login.mjs`（登录） · `crawler.mjs`（6 个只读 op）｜**接口**：`endpoints.json`（11 条）

---

## 这是什么

超星（世纪超星，1993，北京）旗下产品矩阵：**超星数字图书馆**（电子书，号称大陆 1949 年后出版物的 85%+，需超星阅览器）、
**学习通**（在线课程/作业/考试/签到，高校网课主力）、**读秀学术搜索**。

**与「学在浙大」是两个平台**，别混：

| | 学习通 | 学在浙大 |
|---|---|---|
| 域 | `*.chaoxing.com` | `courses.zju.edu.cn` |
| 性质 | 第三方商业平台 | ZJU 自建（TronClass） |
| 登录 | chaoxing 自有账号 | ZJU CAS 单点（`campus-sso`） |
| 本库 | 本页 | `sites/courses.zju.edu.cn/` |

实测账号的 `fid=469`（浙江大学机构号）公开可查，登录后落地页标题「浙江大学」—— 说明该 chaoxing 账号已与浙大机构绑定。

## 登录与滑块真相（最重要的一条）

**登录页的滑块不是必过项，是风控触发项。** 实测三次登录，`#needVcode` 每次都为空串，滑块从未出现。

代码路径（`passport2-static.chaoxing.com/js/fanya/login.js`）：

```js
if (capInstance == null || $("#needVcode").val() != "1") {
    loginByPhoneAndPwdSubmit();   // 直接提交
} else {
    capInstance && capInstance.popUp();  // 弹滑块
}
```

滑块本体是 CX captcha：`https://captcha.chaoxing.com/load.min.js`，`captchaId=GcXX5vewqE7DezKGlyvleKCnkTglvGpL`，
容器 `#captcha`，通过后把票据写进隐藏字段 `#validate`。

**所以「用视觉过滑块」这条路只在该字段为 1 时才需要走；本项目不做自动破解** ——
`login.mjs` 的处置是：检测到 `needVcode=1` 就截图 `_login-slider.png`、报告退出码 2，交回人工或稍后重试（风控多为短时）。
理由与 `source/xxt` 归档包的口径一致：验证码识别器每几周失效一次，失效表现是「密码对的却登不上」，比不做更糟。

### 密码加密

`#t == "true"` 时页面用 `encryptByAES(pwd, "u2oh6Vu^HWe4_AES")` 加密。**不要自己实现** ——
页面已加载 CryptoJS，脚本只需填 `#phone` / `#pwd` 后点 `#loginBtn`，加密由页面自己完成。
自己算 AES 反而会因补位模式不同而失败。

### 需要的 Cookie

`UID` / `_uid`（用户 id）、`fid`（机构号，本账号 469）、`_d`、`vc3`、`uf`、`cx_p_token`、`p_auth_token`。
缺 `UID`/`_uid`/`fid` 时表现为「登录看似成功但啥都读不到」。`crawler.mjs health` 用 `i.chaoxing.com/base` 验，
一个判据：正文含「个人空间」或「退出登录」且不含「请先登录」。

## 接口

```bash
node sites/chaoxing.com/login.mjs          # 建/刷 state.json
node sites/chaoxing.com/crawler.mjs health
node sites/chaoxing.com/crawler.mjs courses
node sites/chaoxing.com/crawler.mjs chapters 266440240 152900786 508400552
node sites/chaoxing.com/crawler.mjs homework
node sites/chaoxing.com/crawler.mjs notices
node sites/chaoxing.com/crawler.mjs schedule
```

细节在 `endpoints.json`。三条口径值得单独记：

1. **课程列表必须 POST**。同 URL 的 GET 回 1679 字节空壳，正文只有「暂无课程」，HTTP 200、不报错。
   照 GET 写脚本会得出「这账号一门课都没有」的错误结论。这是本页第一个坑。
2. **通知原始回包带全班真名**。`receiverArray`、`toNames`、`users` 三处各有一份，一班 20 人。
   `crawler.mjs notices` 已投影成 `{title, content, sender, sendTime, isread, attachments[]}`，不外泄同学 PII。
3. **章节目录是两级**。`div.catalog_name` 里的章（如「力学实验」）+ `div.chapter_item#cur<N>` 里的节
   （如「用扭摆法测定物体的转动惯量」）。节的 `onclick="toOld(courseid, 章节id, clazzid, index)"` ——
   **第二个参数是章节 id，不是 clazzid**；页面里根本没有 cpi，要用课程列表那个。

## 坑

- **GET 空壳**（见上）：`courselistdata` 用 GET 时返回「暂无课程」。同类形态在本库其它站也见过（200 ≠ 接口存在）。
- **`/pc/notice/noticeList` 是 404**，正确的是 `POST /pc/notice/getNoticeList`。
- **课程中间页 302 且无 Location 可跟**，别指望它能当跳转入口用。
- **`lessonArray` 恒空**：课表接口只回骨架（学年/学期/周次/12 节时间表），课程明细不在里面。
- **本机代理**：`HTTP_PROXY=<本地代理>` 出口在墙外，`lib/http.mjs` 已改用 `node:https` 直连；
  chaoxing 不在内网，代理与直连都能通（实测直连 `passport2` 200 / `i.chaoxing.com` 302 到登录）。
- **`state.json` 是明文会话**。本机 `~/.yonkik` 不是 git 仓库，「已 gitignore」的说法在此不成立；过期重跑 `login.mjs` 即可。

## 只读边界

6 个 op 全是查询。**不提供**：交作业、开始考试、签到（位置签到尤甚）、提交讨论。
判据是「有没有改别人的状态」—— 签到会改考勤、交作业会改成绩，这些不是数据读取能替用户决定的。

## 未闭环

- **课表明细**：`lessonArray` 为空，`curriculumCount=6`。`getAllLesson` / `getLessonList` 均 404，真实接口名未找到。
- **章节课件/视频清单**：`source/xxt` 归档包里有 `materials` / `videos` / `downloadParams` 的完整实现
  （章节卡片 `mooc-ans/knowledge/cards` + 资料栏 `stu-datalist` 双通路，按 `objectId` 合并去重），
  本轮没复现，因为课程本身没有可见课件。要补就直接参考归档包 `<本地路径>`
  的 `src/reads.js`，别重写。
- **作业 DDL**：列表页不含截止时间，`source/xxt` 的做法是逐条进详情（贵；用「只看未完成 + max_courses + horizon_days」控制）。

## 合规与风险

- 超星是**用户自有账号**的第三方平台，本页只做本人账号的只读访问。
- 2022-06 学习通被曝疑似 **1.7 亿条**用户信息泄露，公司称未发现明确证据并报案；
  北京邮电大学等多家单位发过风险预警（见维基百科「超星网」条目引用）。
  **实务建议**：这里的密码不要与其它站点复用；已泄露过的平台尤其如此。
- 课程通知里带同学真名，属他人个人信息。脚本已投影掉，不要另存原始回包。

## 本人课程 JSON 端点（2026-11-22）

- `GET https://mooc1-api.chaoxing.com/mycourse/backclazzdata` → **302 到 passport2.chaoxing.com/login**，路由存在、需账密登录。
- 它返回**本人课程 JSON**，比已在档的 HTML 课程表更适合脚本。
- 不自动登录、不猜参数。
