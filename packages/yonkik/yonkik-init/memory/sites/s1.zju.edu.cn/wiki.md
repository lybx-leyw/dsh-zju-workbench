# 浙大百事通（s1.zju.edu.cn）

> **本页索引**：这是什么 · 与旧站 s.zju 的关系（关键） · 能力 · 七个检索域 · 解析坑 · 只读边界 · 未闭环

**状态**：done（2026-11-20）｜**鉴权**：**CAS 必须登录**（`campus-sso`）｜**限流**：串行 2s
**脚本**：`login.mjs`（CAS 登录） · `crawler.mjs`（7 个检索域 + health）

---

## 这是什么

浙大**百事通** —— 校务信息的统一检索入口。把学校信息切成 7 个检索域：

| 域 | 内容 | 实测 |
|---|---|---|
| **办事指南** | 某事怎么办、找谁、带什么材料 | 「证明」**54 项** / 5 页 |
| **常见问题** | FAQ，带答案与受理部门 | 「借教室」**56 项** / 5 页 |
| **学校文件** | 校发公文 | 「培养方案」**1204 项** |
| 规范性文件 | 制度类 | 待测 |
| 通知公告 | 校内通知 | 待测 |
| 资讯 | 新闻类 | 待测 |
| 通讯录 | 部门与人员 | 待测 |

## 与旧站 s.zju.edu.cn 的关系（本页最重要）

**这是同一个系统的两代地址，且鉴权策略变了。**

| | 旧站 `s.zju.edu.cn` | 新站 `s1.zju.edu.cn` |
|---|---|---|
| 状态 | **已 502 挂掉**（2026-11-20 实测，TCP 通、HTTP 502） | **200 正常** |
| 鉴权 | 曾**完全免登录** | **必须 CAS 登录**，匿名 302 到 zjuam |
| 端点 | `/search/workGuide.do` 等 7 个 | **完全相同**的 7 个端点 |
| 内容 | 停更（挂了） | 现行，数据与旧站记录一致 |

**发现路径**：从 `service.zju.edu.cn` 的服务目录里找 id=202「浙大百事通」，`entranceUrl` 指向 `https://s1.zju.edu.cn` —— 
这说明学校自己已经把入口换到 s1，只是 `service` 站内搜索组件仍硬编码旧地址（学校前端也没适配完）。

**关键判据**：`/search/workGuide.do?words=证明` 在 s1 上仍返回「约有 **54** 项符合」，
与旧 wiki 记录的 54 项**完全一致** —— 数据没变，只是加了登录墙。

## 能力

```bash
node sites/s1.zju.edu.cn/login.mjs                    # CAS 登录（约 15 秒）
node sites/s1.zju.edu.cn/crawler.mjs health           # 自检：应回 hitFor_ZhengMing=54
node sites/s1.zju.edu.cn/crawler.mjs guide 证明        # 办事指南
node sites/s1.zju.edu.cn/crawler.mjs guide 证明 2      # 第 2 页
node sites/s1.zju.edu.cn/crawler.mjs faq 借教室        # 常见问题（带答案）
node sites/s1.zju.edu.cn/crawler.mjs file 培养方案     # 学校文件
node sites/s1.zju.edu.cn/crawler.mjs norm 学籍          # 规范性文件
node sites/s1.zju.edu.cn/crawler.mjs news 校历          # 资讯
node sites/s1.zju.edu.cn/crawler.mjs addr 教务处        # 通讯录
node sites/s1.zju.edu.cn/crawler.mjs all 奖学金         # 全部域
```

### `guide` 每条返回的字段（办事指南的真正价值）

实测「证明」首条：

```
zid:            Z0105                                    ← 事项编号，比事项名更稳
 title:          研究生毕业证明书/肄业证明/学习证明办理
 handleTime:     工作日周一至周四 8:30-12:00,13:30-17:30；周五 8:30-12:00,13:30-15:30
 supervisePhone: 0571-88981617                            ← 监督电话
 consultPhone:   0571-88981234                            ← 咨询电话
 dept:           紫金港校区行政服务办事大厅111室第7、8号窗口
 place:          （同上）
```

这份信息，学生问「XX 证明怎么办」时可以直接回答，不用登录任何业务系统。

### `faq` 每条返回

```
question / answer / consultPhone / applyScope / dept
```

实例（「借教室」里最实用的一条）：

> **问**：自习教室开放情况？时间？如何申请增开？
> **答**：东一A12间、东一B8间、东六4间、西一14间、西二13间，**共 51 间**；
> 开放时间 **7:00-22:30（考试周延长到 24:00）**；人多可在浙大教室 APP「意见反馈」提诉求，
> 或找教室门口物业电话申请增开。
> **咨询**：88208434　**受理部门**：本科生院

## 七个检索域的 URL 规律

```
/search/all.do          全部（跨域聚合）
/search/workGuide.do    办事指南   ← 找「某事怎么办」
/search/faq.do          常见问题   ← 找「为什么/怎么解决」
/search/schoolFile.do   学校文件
/search/normFile.do     规范性文件
/search/info.do         资讯
/search/addrBook.do     通讯录

参数：?words=<URL编码关键词>&pageNo=<页码，第1页可省>
```

## 解析坑（都已内置在 crawler.mjs）

1. **命中数被 `<span>` 包着**：`约有 <span>54</span> 项符合`。只匹配裸数字会得到 null。
2. **本条目的标题里有 `<font color='red'>` 高亮**（搜索词染色），不剥标签会把 HTML 带进 title。
   实测标题变成 `研究生毕业<font color='red'>证明</font>书…` —— 所以必须先剥 `font` 再取文本。
3. **必须锚定 `div.info_list`**：页面顶部有导航条（高级搜索/网站资讯/学校文件…），
   不锚定会把 11 个导航链接当成 11 条办事指南。第一版就是这么错的。
4. **办事指南与 FAQ 结构完全不同**：
   - 办事指南：`dd.D2` + `div.T3#data_ZNNNN` + `<b>受理时间:</b>`
   - FAQ：`dd.D3` + `div.T1`（问）+ `div.T2 > h4.da_high_content`（答）+ `<b>咨询电话:</b>`
   用同一套解析会一边全空。
5. **FAQ 答案里混着「展开」「收起」按钮文字**（`.expand-btn` / `.close-btn`），要抠掉。
6. **总页数在 `searchPage(N, ...)` 的调用里**，取最大值；页面上没有「末页」文本。
7. **CAS 提交后上下文会销毁**：用 `page.evaluate` 点按钮会报 `Execution context was destroyed`，
   必须用 `Promise.all([waitForNavigation(), btn.click()])`。

## 与 service.zju.edu.cn 的分工（别混用）

| 需求 | 去哪 | 为什么 |
|---|---|---|
| 「某证明怎么办、在哪办、电话多少」 | **本站 `guide`** | 事项级指南，带窗口与电话 |
| 「某问题为什么、怎么解决」 | **本站 `faq`** | FAQ 带答案 |
| 「学校有哪些业务系统、入口在哪」 | **`service` 的 `chain.mjs`** | 系统级目录，给 entranceUrl |
| 「某系统具体怎么用」 | 对应系统自己的 wiki | — |

## 只读边界

7 个检索域全是 GET 查询。不提供提交申请、下载附件、修改任何数据。

**登录态仅用于检索** —— 本脚本拿到会话后只打 `/search/*`，不碰个人中心、不碰待办。

## 未闭环

- **办事指南详情页**：`guide` 结果里的 `zid`（如 Z0105）如何跳详情页未探；
  旧站曾用 `detailnew.html?id=`，新站可能走 `/search/*` 的详情路由，需登录后抓一次真实点击。
- **附件下载**：办事指南背后的材料清单可能有附件，未探。
- **norm / news / addr 三个域**：脚本支持但未实测样例。
- **会话有效期**：CAS 会话的 TTL 未测；`health` 会给出 `needLogin: true` 提示重跑 login.mjs。
