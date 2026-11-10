# campus 拆包收尾方案

**背景**：`source/campus` 装着学在浙大 + 拼题A 两个平台。拆成 `source/xuezai` + `source/pta`。
两个代理并行做包本体，**共享文件与退役由我统一处理**（避免冲突）。

---

## 一、`zhiyunCampus` 的真实消费者

`core/planning/src/index.js` 用了 **4 个方法**：

| 位置 | 调用 | 返回形状 | 拆包后归属 |
| --- | --- | --- | --- |
| `:1926` | `campus.todos()` | `{ xzzd: {ok, rows, error}, pta: {ok, rows, error} }` | **两半**（xzzd + pta 各一半） |
| `:1946` | `campus.ptaStatus()` | `{ configured, names }` | **pta** |
| `:1956` | `campus.ptaStatus()`（二次读取） | 同上 | **pta** |
| `:1979` | `campus.savePtaCookie(raw)` | `{ source, names }` | **pta** |

另有 `source/campus/src/client.jsx`（页面半边）引用 `/api/zhiyun-campus`，随包退役处理。

**没有其它包**在代码里 `ctx.get('zhiyunCampus')`。`source/{zdbk,cc98,xxt,login}` 的命中都是**注释**或**路由名对照**，不是真实依赖。

---

## 二、必须做的三件事

### 1. 兼容 shim（不能省）

`core/planning` 期待**一个** `zhiyunCampus` 服务，而拆包后有**两个**服务（`zhiyunXuezai` / `zhiyunPta`）。

**方案**：在 `core/planning` 里改成一个聚合函数，而不是让两个 source 包互相依赖。

```js
/**
 * 拿学在浙大 + 拼题A 两半，拼成 core/planning 一直用的形状。
 *
 * # 为什么在这里拼而不是让两个 source 包互相依赖
 *
 * `xuezai` 与 `pta` 都是 tier 1 业务包，按本仓硬规则**不得互相依赖**。
 * 而 `todos()` 的消费者要的是合并结果 —— 那就只能在消费者这一层合并。
 * `core/*` 是聚合层，天然适合做这件事。
 */
const todosFromSources = async (ctx) => {
  const xuezai = ctx.get('zhiyunXuezai');
  const pta = ctx.get('zhiyunPta');
  if (!xuezai && !pta) {
    const why = { code: 'CAMPUS_UNAVAILABLE', message: '校园数据包未启用：需要 source-xuezai 或 source-pta' };
    return { xzzd: { ok: false, rows: [], error: why }, pta: { ok: false, rows: [], error: why } };
  }
  const [xzzd, ptaHalf] = await Promise.all([
    xuezai ? wrap(() => xuezai.todos()) : missing('xuezai 未启用'),
    pta ? wrap(() => pta.todos()) : missing('pta 未启用'),
  ]);
  return { xzzd, pta: ptaHalf };
};
```

**要求**：
- 两半**各自 try/catch**：一边挂了不能拖垮另一边（现有代码就是这个语义）
- 都缺时给 `CAMPUS_UNAVAILABLE`，**不要编一个"没有待办"的空结果**
- `ptaStatus()` / `savePtaCookie()` 直接转 `zhiyunPta`

### 2. `campus` 退役清单

| 项 | 动作 |
| --- | --- |
| `packages/source/campus/` 目录 | 删除（两个代理搬完之后） |
| `profiles/zju-workbench/package.json` 的 campus 行 | 删 |
| `retiredBundles`（`scripts/profile.mjs:35`） | **加 `dsh-zju-source-campus`** — 否则老 profile 里那行会让 Loader 解不开、整个 profile 起不来 |
| `packages/source/campus/OWNERS` | 随目录删除 |
| `tests/campus-*.test.mjs` | 删或迁到 `tests/xuezai.test.mjs` / `tests/pta.test.mjs` |
| `NO_SETTINGS` 里的 campus 行 | 删，换 xuezai / pta 两行 |
| `/api/zhiyun-campus` 路由 | 客户端 `client.jsx` 随包删；**若有其它消费者要留兼容路由** |

### 3. 共享文件的处置

两个代理都**不动** `campus/src/index.js`，各自给我一份「属于我的那些行」的清单。我据此切：

| 内容 | 去向 |
| --- | --- |
| `hosts.js` 的学在浙大常量 | 复制进 `xuezai` |
| `hosts.js` 的 pta 常量 | 复制进 `pta` |
| `reads.js`（页面合并） | 两边都要 → 各复制一份（24 行，重复可接受） |
| `egress.js` | 已迁 `source/webvpn`，本包只是薄封装 → 两边各留薄封装或直接不用 |
| `index.js` | 按两份清单切分 |

---

## 三、验收检查点

拆包完成后必须验证：

- [ ] `node --test tests/source-capability.test.mjs` 绿（tier1 不得依赖 tier1）
- [ ] `node --test tests/source-settings.test.mjs` 绿
- [ ] `xuezai` 与 `pta` 的 `requires` **互不包含对方**
- [ ] `core/planning` 的 4 个调用点都有对应实现（改完后跑它的测试）
- [ ] `retiredBundles` 含 `dsh-zju-source-campus`
- [ ] `packages/source/campus/` 已删且无残留 import
- [ ] workspace 链接 `missing` 为空
- [ ] 全仓测试无新增失败（对比基线 27）

---

## 四、风险

| 风险 | 缓解 |
| --- | --- |
| `core/planning` 的 `todos()` 语义变化 | shim 保持原返回形状；两半独立 try/catch |
| 老 profile 残留 campus 行导致启动失败 | `retiredBundles` 登记（`scripts/profile.mjs` 的 `initialize` 会自动清） |
| 两个代理同时改 `index.js` | 明令禁止，各交清单由我切 |
| `client.jsx` 的页面半边找不到路由 | 随包退役；如需保留，我加兼容路由 |
| 测试夹具随 campus 删除而失效 | 迁移而非直接删 |
