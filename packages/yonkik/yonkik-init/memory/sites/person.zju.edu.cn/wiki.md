# 个人主页系统 person.zju.edu.cn

## 处置：被人机校验拦截（2026-11-22）

逐跳实测：
- https://person.zju.edu.cn/ -> 302 http://person.zju.edu.cn/index（HTTP 80 端口直连 socket hang up）
- https://person.zju.edu.cn/index -> 301 https://person.zju.edu.cn/index/
- https://person.zju.edu.cn/index.html -> 200，7882 字节，正文只有一个 iframe 指向第三方 WAF 校验页
- iframe src = https://valbr.bangruitech.com/asValidate?...&returnUrl=http://person.zju.edu.cn:443/index.html
- 页面文字：温馨提示：请验证以继续访问。

结论：入口被**第三方 WAF（bangruitech）**强制人机校验，不是校内统一身份认证，也没有可读的公开内容。

**明确不做**：不提交校验、不猜 token、不伪造 UA/cookie、不请求该第三方校验域名、不从缓存或搜索引擎取主页快照。反机器人校验是明确的访问边界，绕过它不属于只读侦察。

如日后需要，应由用户在浏览器中自行完成校验，再由本人授权读取。
