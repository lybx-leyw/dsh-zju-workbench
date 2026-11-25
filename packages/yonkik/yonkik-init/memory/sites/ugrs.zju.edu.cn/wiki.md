# 浙江大学本科生院（ugrs.zju.edu.cn）

> **本页索引**：这是什么 · 能力 · 全站搜索协议（核心） · 坑 · 只读边界 · 未闭环

**状态**：done（2026-11-20）｜**鉴权**：**全站免登录**｜**限流**：串行 2s / 并发 1
**脚本**：`crawler.mjs`（search / page / health）｜苏迪 Webplus 平台

---

## 这是什么

浙大本科生院（教务处口径的本科教学门户）。栏目覆盖：专业设置、培养模式、特色项目、教学名师、
教师发展、优质课程、精品教材、教改项目、基层教学组织、教在浙大、教学成果、实践平台、一站式科研导航。

对学生的实际用途：**查培养方案与专业课程体系**、查教学管理政策原文、查教改与特色项目。

注意它与另外两个站的分工：

| 站 | 管什么 |
|---|---|
| `ugrs.zju.edu.cn` | 本科**教学政策与培养方案**（门户，免登录） |
| `zdbk.zju.edu.cn` | 本科**教务业务**（选课/成绩/课表，需登录） |
| `bksy.zju.edu.cn` | 培养方案**PDF 全文**（另一套库，免登录，已有资产） |

**培养方案两处都有**：ugrs 的搜索能给出「2020级/2019级本科专业培养方案」的**入口页**，
bksy 那边才是分年级分专业的 **PDF 正文**。要真读方案内容去 bksy，要判断「有没有这版方案」来 ugrs。

## 能力

```bash
node sites/ugrs.zju.edu.cn/crawler.mjs health
node sites/ugrs.zju.edu.cn/crawler.mjs search "培养方案"
node sites/ugrs.zju.edu.cn/crawler.mjs search "推免" 2      # 第二页
node sites/ugrs.zju.edu.cn/crawler.mjs page /81372/list.htm  # 任意栏目页正文
```

## 全站搜索协议（本页最重要）

搜索走的是苏迪 Webplus 的通用检索引擎，但**参数形态不是普通人想的那样**。

```
POST https://ugrs.zju.edu.cn/_web/_search/api/searchCon/create.rst?_p=<签名>&tt=<随机数>
Content-Type: application/x-www-form-urlencoded; charset=utf-8

searchInfo = base64( JSON.stringify([
  {field:'pageIndex', value:1},
  {field:'group',     value:''},
  {field:'searchType',value:''},
  {field:'keyword',   value:'培养方案'},
  {field:'recommend', value:''},
  {field:4, value:''}, {field:5, value:''}, {field:6, value:''}, {field:7, value:''}
]) )
```

**只有一个参数 `searchInfo`**，值是 base64 后的 JSON 数组。返回 JSON：

```json
{ "linkSiteId": 0, "total": "3", "pages": "<html 分页条>", "data": "<html 结果片段>" }
```

`data` 是 HTML 片段，不是结构化数组。每条形如：

```html
<div class="result_item clearfix">
  <input type="hidden" name="id" value="3229132">
  <input type="hidden" name="siteArtId" value="15958617">
  <h3 class="item_title"><a href='...'>标题</a></h3>
  <span class="item_metas">创建者:<姓名></span>
  <span class="item_metas">发布时间:2026-11-17 13:28:52</span>
  <span class="item_metas">目录:学生风采</span>
  <span class="item_metas">出处:本科生院</span>
</div>
```

### `_p` 签名从哪来

它是**搜索页自带的上下文标识**，不是会话凭证。抓法：打开首页，取任意 `search form` 的 `action`：

```
/_web/_search/api/search/new.rst?locale=zh_CN&request_locale=zh_CN&_p=YXM9MzgmdD0zMDA2JmQ9MTQyODkmcD0xJm09U04m
```

把 `_p` 抄下来即可。**站点换模板或调站时它可能变** —— 报「回包不是 JSON」时先回首页重抓。

## 坑

- **栏目 URL 不能用 `.htm` 直接替换成 `.psp`**：`/tzgg/list.htm` 会 301 到 `/tzgg/list.psp`，再 301 回 https，
  最终 200 但正文是「提示：访问地址无效，tzgg找不到对应的栏目！」。**这是「栏目不存在」，不是「页面挂了」**。
  判断依据是那个「提示信息」页（约 2.2KB），别当成抓到内容了。
- **首页列出的栏目才是真栏目**。`/81372/list.htm`（专业设置）实测 113KB 有内容；
  `/81823/`、`/tzgg/` 这类都是猜的，不存在。要枚举就照首页那批 `list.htm`。
- **分页在 `pageIndex` 里，不在 URL 上**。已实测 `pageIndex=2` 生效（总数 3 条时第 2 页为 0，是正确的空）。
- **搜索结果是 HTML 片段**，标题里可能有微信外链（`mp.weixin.qq.com`）—— 那是正常内容，不是脏数据。
- **`total` 是字符串**（`"3"`），别直接当数字用。

## 只读边界

`search` 与 `page` 都是 GET/POST 查询。不提供任何提交类操作。

## 未闭环

- **栏目分页**：只用 `list.htm` 抓过首页 10 条，翻页路径（`list2.htm`? `list_2.htm`?）未实测。
- **搜索结果翻页上限**：`pages` 字段里的分页条给出了页码，但没验证能翻到第几页。
- **附件下载**：栏目详情页里的 PDF 附件（培养方案等）没测；bksy 那边已验证 PDF 直链可裸下，若要下 ugrs 的先看那边经验。
