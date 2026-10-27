# 写一个插件包

本项目的功能单位是**插件包**（`packages/dsh-zhiyun-*`），不是往某个大插件里塞代码。
贡献一个新功能，就是提供一个包，或改动已有的包。

插件包怎么写没有额外规定，参考现成实现即可。除此之外只有四条约定，其中最重要的
一条是：**不要接入会让整个 profile 起不来的包**。

## 一个页面包需要五个文件

以 `packages/dsh-zhiyun-page-docs` 为例：

```text
packages/dsh-zhiyun-page-docs/
├── OWNERS              # 归属声明
├── README.md           # 讲取舍与踩坑，不是复述代码
├── package.json        # 入口、exports、dsh 声明
├── cordis.patch.yml    # 告诉 profile 怎么插入这个包
└── src/
    ├── index.js        # 宿主半边（可以是空壳，但必须存在）
    ├── client.jsx      # 浏览器半边：往插槽里注册组件
    ├── style.css       # 自带样式，不依赖别包的样式表
    └── …
```

`lib/client.js` 是构建产物，不进仓库。

## package.json 里的三类字段

```json
{
  "main": "./src/index.js",
  "exports": {
    ".": "./src/index.js",
    "./client": "./lib/client.js",
    "./package.json": "./package.json"
  },
  "dsh": {
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": { "platform": "web", "external": ["dsh-zhiyun-shell-ui"] }
  }
}
```

- `main` → 宿主半边的入口。Loader 靠它进启动图谱。
- `exports["./client"]` → 浏览器半边。**声明了 `dsh.client` 就必须有这一条**，
  否则宿主组装客户端模块表时直接抛错并拒启**整个工作台**。
- `dsh.client.external` → 运行时由别人的 bundle 提供的模块。写在这里的模块会被
  构建排除，运行时从模块表里取。

## 两个半边各写什么

宿主半边只需要把名字交出去：

```js
export const name = 'zhiyun-page-docs';
export function apply() {}
```

浏览器半边要导出三个东西：`name`、`inject`、`apply`。

```jsx
export const name = 'zhiyun-page-docs-client';
export const inject = ['slots'];

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunDocsStyle', css, label: 'zhiyun: docs page styles' });
  ctx.slots.inject('zhiyun.docs.content', () => ctx.slots.register(
    { name: 'zhiyun.docs.content' },
    Docs,
  ));
}
```

- **`inject` 写你真正依赖的东西**。只画界面的页写 `['slots']` 就够了；领域服务
  按名字写进来（`'remote'`、`'loader'`…）。写多了会让这一页因为别的包没就绪
  而一起消失。
- **`apply` 里只注册，不渲染**。组件的挂载与卸载交给插槽。

## 新页面要动四处装配清单

漏任何一处的表现都不是"这里立刻红"，而是**真机上那一页空白**：

1. `scripts/build.mjs` 的 `CLIENT_PACKAGES` —— 漏了就没有 `lib/client.js`，模块表缺行
2. `profiles/zhiyun-bench/package.json` 的 `dsh.profile.bundles` —— 漏了 Loader 不装载它
3. 外壳的 `NAV`（`packages/dsh-zhiyun-shell-workbench/src/model.js`）—— 漏了没有入口，
   页面注册了也没人打开
4. `package.json` 的 `exports["./client"]` —— 漏了宿主拒启整个工作台

`tests/plugins-page.test.mjs` 里有一条自动扫描守卫，会比对前三处。

整幅铺开、不套版心的页面还要额外进 `FULL_BLEED_PAGES`；这一页的滚动归谁，
要在加进去的时候想清楚，猜错的表现是页脚被裁掉或出现双层滚动条。

## 三条容易踩的坑

**Markdown 渲染器的类是哈希的。** 宿主用 CSS Modules，`.markdown` 在产物里是
`_markdown_1ypvv_5`，跟着它写规则会静默失效。要覆盖排版就在自己的容器类下写
后代选择器，或者用宿主显式写进 DOM 的稳定属性。

**共享原语的导出是逐个列的。** `dsh-zhiyun-shell-ui` 的入口有一份显式清单，
新增原语忘了加进去，使用方拿到 `undefined`，React 报 #130，表现是那一整块插槽
凭空少一片。`tests/ui-primitives.test.mjs` 会比对两边。

**图标必须彼此不重样。** 侧栏是只有图标的导轨，名字靠悬停浮出。一排里出现两个
一样的图形，导轨就没法用了。

---

> 内容摘写自 `docs/contributing/CONTRIBUTING.md` 第 3 章与各包 README。
