# 本科生院办公网 bksy.zju.edu.cn

## 本页索引

<!-- yonkik:toc -->
> 按节读，不要整篇加载：grep -n "^## <标题>" wiki.md 取行号，只读那一节。

- 一句话结论
- 入口与身份
- 鉴权与免登录范围
- 培养方案栏目结构（本页核心）
- 栏目 URL 与分页规律
- 附件直链形态
- 按「专业 + 年级」定位培养方案（已脚本化）
- 接口
- 限流
- 坑（必读）
- 内容结构
- 脚本
- CC98 主张核实
- 未探候选

---
**状态：done（2026-11-20）** —— 培养方案全链路免登录可读，已脚本化「按专业+年级取 PDF」。

## 一句话结论

学生问「我这专业要修什么课」的唯一权威免登录源。**2026 年 11 月实测：全部培养方案栏目免登录可读，PDF 原件直链可裸下，无验证码、无 cookie 要求、无 Referer 检查。** 替代体验很差的教务系统培养方案界面（CC98 5141495 楼主原话："培养方案界面体验很差……建议直接打开本科生院官网的培养方案栏目"）——**这一主张已证实**。

## 入口与身份

- 根 `https://bksy.zju.edu.cn/` → 200，169,814B，title「浙江大学本科生院办公网」。
- 系统身份：**苏迪 Coreplus/Webplus** 站群（`/_upload/tpl/0b/b2/2994/template2994/`，`siteId=499`），nginx，技术支持「寸草心科技」。
  - 这与 `www.life.zju.edu.cn` 同属苏迪系（见 `sites/_playbook.md` 的苏迪条目），但本站在 `_web/_apps/lightapp/**/pub/` 之外**整站静态可读**，不需要绕。
- 首页 HTML 里带完整两级栏目树（`ph-nav-level1` / `ph-nav-level2`），**这是栏目发现的唯一权威入口**——不要猜 URL。

## 鉴权与免登录范围

**免登录可读（全部实测 200）**：

| 范围 | 说明 |
|---|---|
| 首页 + 全部栏目列表页 | 两级导航全覆盖 |
| 全部专业培养方案详情页 | `/YYYY/MMDD/c{n}a{id}/page.htm` |
| **全部培养方案 PDF 原件** | `/_upload/article/files/...` 静态路径，支持 Range |
| 必读说明 / 解读视频 | 各年级 `bdsm` 类栏目 |
| 通知公告、表格下载、指导手册 | 学生手册、教师规范、学籍表格等 |

**唯一不可用**：站内搜索接口（`/_web/_search/api/search/new.rst`）匿名 **403**。见「坑」节。

## 培养方案栏目结构（本页核心）

```
培养方案总栏目  /28325/list.htm   （14 条/页，2 页，共 18 个年级入口）
│
├─ 2026 级  /dlpymspyfa_94116/list.htm   ← 大类培养模式（86 条，单页无分页）
│           /zypymspyfa_94115/list.htm   ← 专业培养模式（23 条，14/页 → list2.htm）
│           /bdsm/list.htm               ← 必读说明
├─ 2025 级  /dlpymspyfa_87825/ + /zypymspyfa_87824/ （必读 /bdsmwjdsp/）
├─ 2024 级  /dlpymspyfa_83005/ + /zypymspyfa_83006/ （必读 /pyfajd/ = 「必读说明&解读视频」）
├─ 2023 级  /dlpymspyfa_84078/ + /zypymspyfa_83942/
├─ 2022 级  /dlpymspyfa/       + /zypymspyfa_69885/
├─ 2021 级  /dlpymspy/list.htm + /62629/list.htm
├─ 2020 级  /52489/list.htm    + /52490/list.htm
└─ 2010–2019 级：纯数字 columnId（/28330 … /28327），/28325/ 第 2 页可见
```

**「大类培养模式」与「专业培养模式」的区别**（实测对比 2026 级）：

| | 大类培养模式 `/dlpymspyfa_*` | 专业培养模式 `/zypymspyfa_*` |
|---|---|---|
| 2026 级条数 | **86** | **23** |
| 内容 | 按**试验班/大类**列出每个专业方向（如「工科试验班（计算机）」下挂各专业） | 按**专业本身**列（法学、临床医学、药学、艺术类…），另有特色班 |
| 分页 | **无**（86 条一页出全） | **有**（14 条/页，list2.htm） |
| 左侧导航 | 有 30+ 个试验班子栏目（`childColumnId`） | 无子栏目 |

> 学生找「我这专业」时：**优先查大类模式页**（86 条覆盖全体本科专业），找不到再查专业模式页（补特色班/长学制/艺术体育类）。`crawler.mjs find` 已自动两个都查。

各年级每个子栏目左侧导航都能拿到「必读说明 / 大类培养模式 / 专业培养模式」三件套，**跨年级 URL 不通用，必须按年级取**。

## 栏目 URL 与分页规律

**两种 URL 形态并存**（同一个站）：

1. **纯数字 columnId**：`/{columnId}/list.htm`，如 `/28325/list.htm`、`/52489/list.htm`
2. **英文 slug（+可选 columnId 后缀）**：`/{slug}/list.htm`，如 `/dlpymspyfa_94116/list.htm`、`/gksybwjsjw/list.htm`、`/bdsm/list.htm`

> slug 是栏目拼音缩写，带 `_NNNNN` 后缀的表示重名去重时加的后缀。**不要用规律构造**——从 `/28325/` 或首页导航抓。

**分页规律（苏迪 wp_paging）**：

```html
<div id="wp_paging_w54">
  <span class="all_count"><em>18</em></span>      <!-- 总数 -->
  <a class="next" href="/28325/list2.htm">      <!-- 下一页 -->
  <em class="curr_page">1</em>/<em class="all_pages">2</em>
</div>
```

- **第 1 页 = `/list.htm`，第 2 页起 = `/list2.htm`、`/list3.htm`…**（不是 `?page=2`）
- 末页的 `next`/`last` 是 `javascript:void(0);` —— 判末页看这个
- **但有的栏目压根没有分页块**（如 2026 级大类模式 86 条）：此时整页就是全部，`wp_paging_w` 不存在
- `list1.htm` 也能访问（等于第 1 页），但规范写法是 `list.htm`

## 附件直链形态

**PDF 不在 `<a href>` 里**，而是挂在 `div` 的自定义属性上（`wp_pdf_player` 播放器）：

```html
<div pdfsrc="/_upload/article/files/20/f1/d7c832924f9fbc49a73ebac44aab/efde2cbb-7c55-4710-bdbf-ce96a738447f.pdf"
     swsrc="/_upload/article/videos/.../....swf"
     id="efde2cbb-..."
     sudfile-attr="{'title':'<年级>级<专业>培养方案.pdf'}"
     class="wp_pdf_player" sudyplayer="wp_pdf_player"></div>
```

- **取 `pdfsrc` 属性**，拼 `https://bksy.zju.edu.cn` 前缀。
- 多个附件时（如 2024 级哲学同时有 PDF + 讲解 mp4），`sudfile-attr` 的 `title` 会给出文件名。
- 实测直链：`206 Partial Content`、`application/pdf`、`magic=%PDF-`、**不需要 cookie/Referer**，裸 GET 即可。
- 典型大小 300–450KB，没有扫描层问题（是文本 PDF，与 zdbk 教务系统里那份扫描件不同）。

## 按「专业 + 年级」定位培养方案（已脚本化）

```bash
# 1. 先看支持哪些年级
node ~/.yonkik/sites/bksy.zju.edu.cn/crawler.mjs grades

# 2. 按专业名模糊定位（自动查「大类」+「专业」两种模式）
node ~/.yonkik/sites/bksy.zju.edu.cn/crawler.mjs find --grade 2026 --keyword <专业关键词>
# → 命中该关键词对应的专业条目（示例：同一专业的不同培养模式）

# 3. 定位并下载那一份 PDF
node ~/.yonkik/sites/bksy.zju.edu.cn/crawler.mjs pdf \
  --grade 2026 --major "<专业全名>" --out ./pyfa.pdf

# 4. 导出某年级某模式全量「专业 → PDF 直链」清单（不下载）
node ~/.yonkik/sites/bksy.zju.edu.cn/crawler.mjs dump --grade 2026 --mode dalei --out pyfa-2026.json
```

**实测验证（2026-11-20）**：
- `find --grade 2026 --keyword <关键词>` → 命中 2 条（同一专业的不同培养模式）
- `find --grade 2024 --keyword <关键词>` → 命中 3 条（相近专业）
- `pdf --grade <年份> --major "<专业全名>"` → **440,330B，`%PDF-1.4`，校验通过**
- `list --grade 2026 --mode zhuanye` → 23 条（两页合并正确）

## 接口

| 接口 | 方法 | 用途 | 鉴权 |
|---|---|---|---|
| `GET /` | GET | 首页 + 完整栏目树 | 无 |
| `GET /28325/list.htm` | GET | 培养方案总栏目（年级入口） | 无 |
| `GET /{column}/list.htm` | GET | 任意栏目列表 | 无 |
| `GET /YYYY/MMDD/c{n}a{id}/page.htm` | GET | 专业详情页（含 pdfsrc） | 无 |
| `GET /_upload/article/files/...pdf` | GET | PDF 原件（Range 可用） | 无 |
| `GET /_web/_search/api/search/new.rst` | POST | 站内搜索 | 无 | **403** |

详见 `endpoints.json`（9 verified）。

## 限流

- `/robots.txt` → **404**（不存在）。
- 响应头无 `X-RateLimit-*`、无 `Retry-After`。
- 站内未见自动化条款（页脚只有版权与技术支持）。
- **沿用保守默认：串行、间隔 ≥2.1s、并发 1**（`site.json` 已设 `minIntervalMs: 2100`）。本次全程串行，0 次 429。

## 坑（必读）

1. **附件在 `div[pdfsrc]` 而不是 `<a href>`。** 正则找 `.pdf` 的 href 会一条都匹配不到（页面里的 href 全是 css/js）。这是本站最容易翻车的地方。
2. **站内搜索匿名 403。** 页面里有个搜索框 `target=_blank` POST 到 `/_web/_search/api/search/new.rst?...&_p={base64}`，返回「抱歉，您没有权限访问该页面」。所以**不要走「站内搜专业名」这条路**——正确做法是遍历栏目列表 + 本地按专业名匹配（`crawler.mjs find` 就这么做）。
3. **同年级两种模式分页行为不同**：大类模式 86 条一页（无分页块），专业模式 14 条/页（有 `list2.htm`）。写死「每页 14 条」或「必有多页」都会错。统一用「有 next 就跟」的循环。
4. **跨年级栏目 URL 不通用。** 2026 级是 `dlpymspyfa_94116`，2025 级是 `_87825`，2024 级 `_83005`，2022 级干脆没有后缀（`dlpymspyfa`）。**不要用年份推算 columnId**，从 `crawler.mjs grades` 的硬编码表取（该表已从实测导航提取并校验）。
5. **`zdbk` 里那条 `bksy` 外链曾经不可达是校外网络问题**（见 `sites/zdbk.zju.edu.cn/wiki.md`）。2026-11-20 从当前网络实测 bksy **完全可达、171ms**。若再遇到 TLS 重置，先怀疑本机代理（见 `_playbook.md` 代理 7993 条）。
6. `http://` 链接会 301 到 `https://`（站内大量 `http://bksy.zju.edu.cn/...` 的绝对链接），跟随即可。

## 内容结构

- 栏目树一级：部门概况 / 教学培养 / 教学质量 / 教学建设 / 教学研究 / 文件汇编 / 表格下载 / 联系我们 等。
- **教学培养 → 培养方案** 是学生流量最大处；同级的「专业教育 / 课程建设 / 通识教育 / 教学运行 / 学籍管理」也有用（学籍异动、主修专业确认及转专业、毕业与学位、保送研究生、政策解答、出国成绩办理预约）。
- 有独立子站外链：`jxzygl.zju.edu.cn`（教学资源）、`ugrs.zju.edu.cn/dwjlfwpt/`（对外交流）、`ilab.zju.edu.cn`（虚拟仿真实验）、`kyjs.zju.edu.cn`（科研竞赛）。

## 脚本

`crawler.mjs` — 5 个操作：`grades` / `list` / `find` / `pdf` / `dump`。基于 `lib/http.mjs` 自动限流。

## CC98 主张核实

| 主张（帖 id） | 实测 | 判定 |
|---|---|---|
| 5141495：「培养方案界面体验很差，建议直接打开本科生院官网培养方案栏目 http://bksy.zju.edu.cn/28309/list.htm」 | `/28309/list.htm` → 200，但 title 是「**教学培养**」（14 条混合通知：助教岗位、未来课堂、混合式课程认定…），**不是培养方案栏目** | **部分证伪**：bksy 确实是正路，但**帖里的 URL 给错了**——真正的培养方案栏目是 `/28325/list.htm`。28309 是「教学培养」大栏目 |
| （同上帖隐含）「bksy 免登录」 | 全程无 cookie 无登录，200/206 | **证实** |
| 学生需求「按专业 + 年级定位到那一份 PDF」（Lead 转述近期帖：某年级某专业培养方案 / 同一级培养方案会变 / 能看直博培养方案吗） | `crawler.mjs find --grade <年份> --keyword <关键词>` → 精确命中 2 条；`pdf` 下载 440KB 校验通过 | **证实且已脚本化** |
| 「同一级的培养方案会变吗」 | 栏目内条目有 `2026/1113` 新增（汉语言（国际学生）晚于同批 `2026/0823`）；页面无版本号/无修订记录字段 | **证实会变，且站点不提供变更历史**——只能靠抓取时间戳对比 |
| 「本科生能看直博的培养方案吗」 | 本科培养方案栏目只到本科专业；直博属研究生 → 应查 `yjsy.zju.edu.cn`（见该站 wiki，其 `/dataapi/open/config/listPykc` 免登录可读研究生课程体系） | **证伪（本科站看不到）**，指向 yjsy |

## 未探候选

1. `/28325/` 第 2 页的 2010–2019 级栏目（本次只确认 URL 形态 `/28330/`…`/28327/`，未逐个抓内容）。
2. 「必读说明」各年级版本内容差异（`/bdsm/` `/bdsmwjdsp/` `/pyfajd/` 三个不同 slug，未逐个读）。
3. `/_web/_column/publishedManage/api/beforeOrNextArticle/new.rst` —— 详情页底部相邻文章接口（需从页面取 `_p` base64），未单发。
4. 表格下载区（`/28317/list.htm` 及 8 个子栏目）——学生常用表格（免测/缓测/学籍异动表），未探内容。

## 一证多站

本站**不需要凭据**（纯公开区）。相邻需要登录的参照站：`zdbk.zju.edu.cn`（教务，campus-sso CAS）。见 `sites/_sso.json`。

## 学籍管理与实践交流通知（2026-11-22）

公开 HTTPS 免登录：/76425/list.htm 14 条（声明共 52 条/4 页；含置顶图标 14，未识别 0）；/76426/list.htm 14 条（声明共 76 条/6 页；含置顶图标 14，未识别 0）。HTML 用 li.right-list-item 的标题与日期配对；置顶与外链只记录，不当采集任务。复用 sites/zju-notices/crawler-columns.mjs 的 column bksy.zju.edu.cn <完整列表路径> 单页接口。
