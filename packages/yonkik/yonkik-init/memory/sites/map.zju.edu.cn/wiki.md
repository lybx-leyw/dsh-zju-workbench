# 浙大校园地图（map.zju.edu.cn）

> **IMAP 场景服务平台 Release 2.13** + GeoServer/GeoWebCache。不是死站，是**一个匿名的 GIS 服务**：底图瓦片与 1334 条 POI 都能直接取。
> 探索日期 2026-11-20，全部匿名只读。

## 本页索引

- ## 一句话结论
- ## 877B 是什么
- ## 接口（已实测）
- ## 坐标系（必读，最容易全盘错的地方）
- ## POI 数据的真实质量
- ## CC98 主张的核实清单
- ## 坑
- ## 本次探了什么 / 还剩什么
- ## 值不值得当资产

---

## 一句话结论

**活站、匿名可用、有真实 GIS 数据。** `map.setting.v2.js` 一次性给出 9 个校区的精确 extent，`/geoserver/wfs` 匿名返回 1334 条建筑 POI（含坐标/建成年/层数/建筑面积），`/geowebcache` 匿名返回航拍底图 PNG（已目视核对）。
**但 POI 名称字段大面积缺失**（多数 `alias` 是单个空格），这是「地图上找不到某楼」的真正原因。

## 877B 是什么

`GET /` 返回 885B（实测），内容只是 UA 分流：

```javascript
$(function(){
  if (isMobile()) { window.location.href = "/mobile/index.html"; }
  else            { window.location.href = "/index.html"; }
});
```

**所以「877B」不是崩了、也不是空壳，是一个纯跳转页。** 桌面端真正入口是 `/index.html`（22992B，43 个 script）。把它当 SPA 壳是误判 —— 它是**服务端渲染的地图页 + 匿名的 GIS 后端**，比 SPA 更好用。

## 接口（已实测）

| # | method + path | 用途 | 鉴权 | 关键响应 |
|---|---|---|---|---|
| 1 | `GET /` | UA 分流 | 无 | 885B，302 式 meta 跳转 |
| 2 | `GET /index.html` | 地图页壳 | 无 | 22992B，43 script |
| 3 | `GET /resource/imap/js/map.setting.v2.js` | **图层配置（最有用）** | 无 | 7995B，9 校区 extent + resolution + WMS/WFS 端点 |
| 4 | `GET /geowebcache/service/wms?...GetCapabilities` | 瓦片图层清单 | 无 | 9945B，23 个 layer（含 `_en` 英文版） |
| 5 | `GET /geowebcache/service/wms?...GetMap&layers=yq&bbox=...&width=256&height=256` | **航拍底图 PNG** | 无 | 200 `image/png` 179261B/256²，目视确认 |
| 6 | `GET /geoserver/wfs?...GetCapabilities` | 要素图层清单 | 无 | 94878B，含按月滚动的 featureType |
| 7 | `GET /geoserver/wfs?...DescribeFeatureType&typeName=IMAP:hotmap_261119` | POI 字段结构 | 无 | 3115B，23 个字段 |
| 8 | `GET /geoserver/wfs?...GetFeature&typeName=IMAP:hotmap_261119&count=N&outputFormat=application/json` | **POI 全量（GeoJSON）** | 无 | `totalFeatures=1334` |
| 9 | 同上 + `&CQL_FILTER=sname LIKE '%X%' OR alias LIKE '%X%'` | **按名检索建筑** | 无 | GeoJSON，命中可为 0 |
| 10 | `GET /api/IMAP-source.js` | 地图引擎本体 | 无 | 805679B，`IMAP VERSION_NUMBER:"Release 2.13"` |

### 9 个校区图层（从 `map.setting.v2.js` 直接抄）

| name | ename | layers | 备注 |
|---|---|---|---|
| 紫金港校区 | Zijinggang | `zjg` | 余杭塘路 866 号 |
| 玉泉校区 | Yuquan | `yq` | 已取瓦片目视核对 |
| 西溪校区 | Xixi | `xx` | — |
| 华家池校区 | Huajiachi | `hjc` | — |
| 之江校区 | Zhijiang | `zj` | — |
| 舟山校区 | Zhoushan | `zs` | — |
| 海宁国际校区 | Haining | `hn` | 海州东路 718 号 |
| 国际医学院 | yixueyuan | `yxy` | 2023-07 新增 |
| 城市学院 | （WMS 里叫 `gcs`） | `gcs` | WMS caps 有，setting 里没有 |

每层都给 `extent`（minx,miny,maxx,maxy，EPSG:32651 米）、`resolution`（6 级）、`tileorigin`、`tilesize=256,256`。

### POI 字段（`IMAP:hotmap_261119`）

```
id · shape(MultiPolygon) · fid · ename · alias · sname · address · enAddress
entityType · remark · houseNum · buildNum · picNum · useType
 displayLevel(int) · otherName · beforeName
 has_indoormap(int) · build_year(int) · build_area(double) · build_floor(int)
 x(double) · y(double)
```

**`x`/`y` 是 EPSG:32651 米制**（与 geometry 同一 CRS），不是经纬度。

## 坐标系（必读，最容易全盘错的地方）

- CRS = **EPSG:32651（WGS84 / UTM zone 51N）**，单位**米**。
- 例：玉泉校区 extent = `1868041.37, 1973294.03, 1869454.34, 1974324.48`。
- 用经纬度（如 120.09, 30.26）去查一定查不到任何东西，且**不会报错，只会返回空** → 极易误判成「没这个楼」。
- `zju_pxdp_sndt_4326` 这个 featureType 名字带 `4326`，说明**也有一份 WGS84 经纬度版本**，但本轮未实测其数据。

## POI 数据的真实质量

**这是本站最重要的一条认知：数据在，但名字缺。** 实测 `count=30` 与 `find 紫金港`（380 条命中）的样本显示：

- `sname` = **校区名**（「紫金港校区」「海宁国际校区」），不是楼名。**同一栋楼的多边形分块会重复同一 sname**（海宁校区前 3 条 sname 完全相同，只是坐标不同）。
- `alias` 才是楼名（「教学实验楼」「行政楼」「书院」「文理楼」「校门」），但**大量记录 `alias` 是单个空格 `" "`**。
- `address` = 校区地址（「杭州市西湖区余杭塘路866号」），不是楼的具体位置。
- `build_year` / `build_area` / `build_floor` 部分记录有值（如紫金港一条 `build_year=2014, build_area=26896, build_floor=12`），部分全 0。

**所以「地图上找不到某个楼」的机制是：`alias` 为空 → 没有名字可搜。** 不是数据缺失，是**命名缺失**。1334 个多边形里只有一部分带 `alias`。

验证：
- `CQL_FILTER sname LIKE '%专家楼%' OR alias LIKE '%专家楼%'` → `totalFeatures: 0`
- `CQL_FILTER sname LIKE '%图书馆%' OR alias LIKE '%图书馆%' OR address LIKE '%图书馆%'` → `totalFeatures: 0`
- `CQL_FILTER sname LIKE '%行政楼%' OR alias LIKE '%行政楼%'` → `totalFeatures: 2`（两条都是海宁，一条 `build_area=19618.88 / build_floor=5`，一条全 0）

即：**「行政楼」这类通用名能搜到，「图书馆」「专家楼」这类搜不到**（浙大的图书馆在 POI 里多半叫「基础图书馆」「图书馆（紫金港）」之类，或压根没填 alias）。

## CC98 主张的核实清单

| 主张（帖号） | 实测 | 判定 |
|---|---|---|
| 5973753「工院专家楼是哪一栋？校园地图上找不到」 | `CQL_FILTER` 查「专家楼」→ `totalFeatures: 0` | **证实**：POI 库里确实没有「专家楼」这个名字 |
| 5206588「求一份高清玉泉校园地图」→ 回复给 file.cc98.org 的图 | 底图瓦片可自取（`layers=yq`，已目视核对，179KB/256² 高清航拍） | **证实需求存在，且官方接口就能满足**——比从 CC98 下别人截图更好。用 `crawler.mjs tile yq <x0> <y0>` 可自己拼任意分辨率的玉泉图 |
| 3938122（2012）「『浙边走』可不可以改成『浙里走』」 | 现站是 IMAP 2.13，「浙边走」这个名字已不存在（`index.html` 无此串） | **已过时**：那个产品名已经没了，站被整体替换为 IMAP 平台 |

## 坑

1. **`/` 是 885B 的 UA 跳转页，不是地图。** 别把它判成「SPA 空壳」。桌面 UA 要去 `/index.html`；移动 UA 去 `/mobile/index.html`。用 node 直连时 UA 决定你拿到哪条分支。
2. **WMS GetMap 的 bbox 必须与 gridset resolution 严格匹配，否则 400。** GWC 报错原文：`400: Requested horizontal resolution: 5.519414062499891 , best match: 2.9633392600118533 exceeds 10% threshold. Perhaps the client is configured with an incorrect set of scales (resolutions), or the DPI setting is off compared to the one in GWC ?`
   → **正确公式**：`width * resolution == bbox 宽度`，且 resolution 取 `2.9633392600118533` 或它的 1/2 倍序列。`crawler.mjs tile` 已按此实现。我第一次用「按 extent 算尺寸」得到 477×348 → 400；改成固定 256×256 + bbox = x0,y0,x0+256*res0,y0+256*res0 → 200 PNG。
3. **WFS 的 namespace 必须是 `IMAP:`，不是 `www.imap.com:`。** 用 `typeName=www.imap.com:hotmap_261119` → 200 但内容是 `ExceptionReport: Unknown namespace [www.imap.com]`（489B）。**HTTP 200 不代表成功**，要检查响应体是不是 ExceptionReport。`map.setting.v2.js` 里写的 `featureNS:"www.imap.com"` 是**混淆项**，实际 typeName 前缀是 `IMAP:`。
4. **featureType 名带日期后缀且按月滚动**：`hotmap_261119`（=2026-11-19）。历史版本 `IMAP:zheda_hotmap_new_0611` 等还在，但**当前版本会换**。硬编码 `hotmap_261119` 会在下个月失效。稳妥做法：先 `GetCapabilities` 找最新的 `IMAP:hotmap_*`，或读 `map.setting.v2.js` 的 `entity_wfs_param.featureType`。
5. **POI 的 `sname` 是校区名不是楼名，`alias` 才是楼名且大量为空。** 只按 `sname` 搜只能定位到校区；要搜楼必须同时 `alias LIKE`。而 alias 为空的楼**根本无法按名搜到**。
6. **坐标是 UTM 米，不是经纬度。** 用经纬度查询返回空且不报错。
7. **`/robots.txt` 302 到 `/templet/login.html`**（nginx 把 robots 也拦了），所以拿不到明文条款。按保守默认 2800ms（Geoserver 是重服务）。
8. **`/templet/login.html` 是后台登录页（3DES/ECB）**，与只读取数无关，**不要探它**。
9. **本机必须 `node:https`**（env 代理），不能用 `fetch`。
10. **`totalFeatures` 是本次查询的总命中，不是返回条数。** `count=N` 只限制 `features[]` 长度，`totalFeatures` 仍报全量（1334）。分页用 `startIndex`。

## 本次探了什么 / 还剩什么

**已探（约 12 次只读请求）**：`/` · `/index.html` · `map.setting.v2.js` · `IMAP-source.js` · WMS GetCapabilities · WMS GetMap（4 次才调对分辨率）· WFS GetCapabilities · DescribeFeatureType（2 次，第 1 次 namespace 错）· GetFeature（count=2）· CQL 检索（专家楼/紫金港/图书馆/行政楼）· `/templet/login.html`（只读了壳，未登录）。

**剩余候选（`endpoints.json` 的 unverified 区）**：
- `IMAP:map_layer_wdt_1f..5f` 室内楼层图 —— 可用于「某教室在几楼」，未实测数据量。
- `icssp.ktzy.js`（空余教室）的数据接口未定位 —— 若存在，价值高于地图本身。
- `IMAP:zju_pxdp_sndt_4326` —— 疑似 WGS84 经纬度版本 POI，若可用则免去 UTM 转换。
- 校车图层（`icssp.schoolbus.js`）—— **但班车正主是 www.life.zju.edu.cn（已 done），不要从地图侧重探**。

**脚本**：`crawler.mjs`，4 个 op（`campuses` / `poi` / `find` / `tile`），已跑通 `--list`、`poi 30`、`find 图书馆`、`find 紫金港`、`find 行政楼`。

## 值不值得当资产

**值得，但只在两个具体用途上。**

**值得的场景：**
1. **「这个楼在哪 / 叫什么」** → `find <关键词>`，返回坐标+建成年+层数+面积。比翻 CC98 问人快。注意 alias 缺失问题。
2. **自取任意校区高清底图** → `tile <layer> <x0> <y0>`，自己拼瓦片阵列。解决「求一份高清玉泉地图」这类需求，比 CC98 上流传的截图分辨率可控得多。

**不值得的场景：**
- 当「poi 检索 API」对外提供 —— 1334 条里大量 alias 为空，召回率不可靠。
- 当「找教室/找办公室」 —— 那需要室内图，本轮未验证。

**与已探站的关系**：班车查 `www.life.zju.edu.cn`（8 个只读接口，已 done），**不要用地图站做交通**。地图站专注地理坐标与底图。
