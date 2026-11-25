# 限流：先读协议，再定数值

站点规则是访问契约的一部分。用户给的是自己的账号，违反限流可能封号，
所以限流值必须有出处，查不到就保守。

## 证据优先级（高 → 低）

1. **API 文档明示**：如「100 次/分钟」「QPS ≤ 2」→ 换算成 minIntervalMs。
2. **robots.txt**：匹配本 agent 的 `User-agent` 段（没有就匹配 `*`）的
   `Crawl-delay: N` → N×1000 ms。
3. **服务条款 / 开发者协议**里的自动化条款。
4. **响应头**：`X-RateLimit-Limit` / `X-RateLimit-Remaining` / `Retry-After`。
5. **都没有 → 默认**：`minIntervalMs: 2000`，并发 1，`source: "default"`。

## 写进 site.json

```json
"rateLimit": {
  "minIntervalMs": 2000,
  "concurrency": 1,
  "source": "robots.txt",
  "evidence": "User-agent: * / Crawl-delay: 2（2026-11-17 抓取）"
}
```

`evidence` 必填：原文摘录 + 抓取日期。下次会话看到证据过期（比如站点改版）
再重查，而不是盲目沿用或盲目重查。

## robots.txt 的正确解读

- `Crawl-delay` 是请求间隔约定，遵守。
- `Disallow` 是爬取范围约定，不是授权边界：探索期尊重；用户明确要访问的、
  自己有权的页面可以访问，但在 wiki 注明。
- robots.txt 不存在（404）≠ 允许随便打，落到默认值。

## 429 / 503 处理

lib 已内置：读 `Retry-After`（秒数或 HTTP 日期），停等后重试，最多 3 次；
等待超过 60s 直接抛错停止。agent 遇到这个抛错应当：

1. 停止该站探索；
2. 把实测限流（触发时的请求频率、Retry-After 值）写进 wiki 和 site.json，
   调高 minIntervalMs；
3. 告诉用户触发了限流，而不是换个姿势继续打。

## 叠加与特例

- **WebVPN**：网关与源站取更严值（见 webvpn.md）。
- **下载**：并发下载上限常比 API 更严（1–2），大文件串行，wiki 单独记。
- **多站共用账号**：同一 CAS 下的站点共享会话风险，探索不同站也保持串行，
  不要并行开多站探索。

## 默认值速查

| 场景 | minIntervalMs | 并发 |
|---|---|---|
| 有明示限流 | 按文档换算 | 按文档（通常 1） |
| robots.txt Crawl-delay: N | N×1000 | 1 |
| 无任何证据 | 2000 | 1 |
| 电子书批量下载 | ≥2000 | 1 |