# 知乎 (www.zhihu.com)

## 本页索引
- 状态（blocked）
- 障碍实测（2026-11-20）
- 已知相关的知乎帖（仅凭搜索摘要，未取正文）
- 替代路径

---
## 状态（blocked）
匿名 HTTP 全站 403；/search 被 robots 显式 Disallow；YONKIK 凭据中无知乎账号。
下次不要重探这些已证伪的路，除非用户先补知乎凭据。

## 障碍实测（2026-11-20）
| 目标 | 结果 |
|---|---|
| GET / | 302 跳 /signin |
| GET /robots.txt | 200，有 Disallow: /search；无通配 User-agent 段 |
| GET /question/ID | 403 |
| GET /topic/ID/hot | 403 |
| GET /api/v4/search_v3 | 403 need_login，跳 account/unhuman 人机验证 |
| GET /api/v4/questions/ID/answers | 403 need_login |
| GET m.zhihu.com/question/ID | 200 但是「安全验证」页，非正文 |

## 已知相关的知乎帖（仅标题+摘要，正文未取得）
- question/2000897103359133676 「26年1月31日，你们的Gemini还能用吗？」
  摘要原文：今天一开电脑，Gemini订阅就发来到期提示，掐指一算离购买1年会员的日子仅仅过去了42天，然而在原本淘宝…
  判断：与「淘宝买 Gemini 会员被提前到期」高度相关，是本次最值得读的一帖。
- 其余命中多为模型评测类（Gemini 3.5 Flash / 3 Flash / GPT-6.1 等），与订阅渠道无关。
- 局限：摘要由 Bing 结果页给出，只覆盖开头一句，不能代表全文观点。

## 替代路径
1. 用户在浏览器登录知乎后，可提供 cookie 或截图，再由本工具增量重探（readonly）。
2. 用户直接把知乎帖正文粘进对话，我按 CC98 同样的方法做观点归纳（最省事、不触发风控）。
3. 检索技巧：Bing 对本机请求的 site: 语法失效（返回无关结果），自然语言加「知乎」前缀才偶尔命中；百度直连 fetch failed；搜狗直接跳 captcha。
