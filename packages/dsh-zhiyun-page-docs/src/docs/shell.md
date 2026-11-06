# 外壳契约速查

这一页是查表用的：写页面包时会反复用到的名字、判定与变量。权威定义在
`packages/dsh-zhiyun-shell-workbench/src/model.js`。

## 导航项

`NAV` 是一个冻结数组，每一项四个字段：

```js
{ id: 'docs', label: '文档', icon: 'book', hint: '查协作规范与开发指南' }
```

- `id` 决定插槽名（`zhiyun.${id}.content`）与承载包名（`dsh-zhiyun-page-${id}`）
- `icon` 取 `shell-ui` 的路径表，**必须自带含义且彼此不重样**（导轨只有图标）
- `hint` 出现在 Ctrl+K 的匹配范围里，一句"这一页能干什么"

页面可以声明 `sidebar: false` 表示它是从别页 drill-in 进来的子页：不进侧栏、
不进 Ctrl+K，但 `activePage` 仍然认得出它。

## 三份清单

| 清单 | 含义 | 加进去的代价 |
| --- | --- | --- |
| `RAIL_DEFAULT` | 导轨上半组，固定且不可撤销 | 永久占用导轨一格 |
| `RAIL_ACCOUNT` | 单独钉在最下方（目前是「个人」） | 只该有一个 |
| `FULL_BLEED_PAGES` | 整幅铺开、不套版心的页 | 这一页自己负责滚动 |

`FULL_BLEED_PAGES` 那些页拿到的容器是 `.zy-content.zy-content-flush`：
没有 980px 版心、没有内边距、`height:100%` 且是列向 flex。页面的根元素写
`flex: 1; min-height: 0` 就能吃满整个内容区。

不在清单里的页面套 `.zy-content`：`max-width: 980px` 居中，`padding: 43px 48px 28px`。
**文章型**页面用这个，行宽才读得下去。

## 插槽名

| 插槽 | 谁注册 | 说明 |
| --- | --- | --- |
| `main` | 外壳 | 主面板，按 `panelKey(page)` 分 key |
| `zhiyun.<page>.content` | 页面包 | 这一页的正文区 |
| `sidebar` | 外壳 | 左侧导轨 |
| `account` | 外壳 | 账号浮层 |

页面包**只注册 `zhiyun.<id>.content`**，其余由外壳管。注册时给的组件会收到
`{ controller, renderSlot }`：

- `controller` —— 导航、开关侧栏、切主题、开账号浮层。**不含领域数据**，
  领域数据要么自己在 `inject` 里声明服务，要么这一页不需要。
- `renderSlot` —— 需要再往下开子插槽时才用（多数页不用）。

## 样式变量

颜色与尺寸一律取外壳的 CSS 变量，明暗两套自动跟随，**不要在包内引入新色板**：

```text
--zy-bg  --zy-surface  --zy-sidebar  --zy-text  --zy-secondary  --zy-muted
--zy-line  --zy-accent  --zy-soft  --zy-hover  --zy-brand  --zy-brand-soft
--zy-action  --zy-action-hover  --zy-font
--zy-fs-meta  --zy-fs-sm  --zy-fs-base  --zy-fs-md  --zy-fs-lg  --zy-fs-xl  --zy-fs-display
```

正文用 `--zy-text`，次要文字 `--zy-secondary`，分隔线 `--zy-line`，
强调色 `--zy-accent`。挂在 `body[data-zhiyun]` 下写规则，主题切换时自然跟着变。

## 三条硬规矩

1. **类名加包内专属前缀**（`zyd-`、`zfb-`、`zs-nt-`）。裸状态类会与别的包撞车，
   而胜负只看挂载顺序 —— `npm run check:css` 拦的就是这个。
2. **不覆盖外壳的 `.zy-*` 规则**。要改就改自己的类；确实需要覆盖时，在同一个包内
   写在基规则之后。
3. **共享原语新增导出要同步两处**：`shell-ui/src/primitives.jsx` 与
   `shell-ui/src/client.jsx` 的显式清单。漏了会让使用方拿到 `undefined`。

## 宿主 Markdown 渲染器

`@deepseek-ai/dsh-client-ui-primitives` 的 `MarkdownText`：

```jsx
<MarkdownText text={markdown} labels={MARKDOWN_LABELS} />
```

- `labels` **必须传且必须是模块级常量** —— 渲染器按它的身份缓存组件表
- `variant` 取 `"body"`（文档排版）或 `"compact"`（紧凑，标题压成正文大小）
- 宿主**不给标题生成 id**，`[x](#foo)` 这种纯 fragment 链接会被 allowlist 降级成纯文本
- 原生 HTML 按字面文本渲染，不安全协议禁用

要覆盖它的排版时，注意宿主的 `.markdown` 类是 CSS Modules 哈希过的（产物里形如
`_markdown_1ypvv_5`），跟着它写规则会**静默失效**。在自己的容器类下写后代选择器。

---

> 依据 `packages/dsh-zhiyun-shell-workbench/src/model.js`、
> `src/components.jsx`、`src/style.css` 与宿主 `dsh-client-ui-primitives` 的导出整理。
