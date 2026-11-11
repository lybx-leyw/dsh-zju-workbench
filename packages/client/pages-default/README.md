# @lybx-leyw/dsh-zju-pages-default

把 `@lybx-leyw/dsh-pages` 的导航栏默认宽度从 64px 校准成 **51px**。

这是产品层的默认值修正，不改页面壳本身。

## Why this exists

`dsh-pages` is a general-purpose page shell; its 64px default is not every
product's default. Forking the shell or patching `node_modules` would be lost on
the next install, so the product ships its own default instead.

It also never overwrites a user's choice:

- the user has never touched the rail width → it becomes 51px;
- the user (or the manager's "reset width") already set a width → untouched.

The check reads the `railWidth` field in the shell's own preference document,
not "is it currently 64": 64 may be a deliberate choice and must not be rewritten.

## Install

```sh
npm install @lybx-leyw/dsh-zju-pages-default
```

Add it to the profile's `dsh.profile.bundles` **after** `@lybx-leyw/dsh-pages`:

```json
{
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@lybx-leyw/dsh-pages",
        "@lybx-leyw/dsh-zju-pages-default"
      ]
    }
  }
}
```

## Notes

- Requires `@lybx-leyw/dsh-pages`; without it the package does nothing.
- The directory name in the source repo is `packages/client/pages-default/`;
  the published package name is `@lybx-leyw/dsh-zju-pages-default`.
- No host-side behaviour; the whole package is one client effect.

## License

UNLICENSED — this package is part of the workbench and is not published to npm yet.
The `license` field says `UNLICENSED` on purpose: the publish guard (`tests/publish-guard.test.mjs`)
requires a package to drop both `private: true` **and** any institutional name before it
can ship, so a placeholder MIT header here would only hide that step.

## 导轨顶部那只鲸鱼：每一页的「收起侧栏」

首页左上角那只鲸鱼点一下收起原生侧栏。以前这只在 home 页可点，其他页只是同一个
位置的静态装饰 —— 用户看到的是「同一个位置，一页能点、其他页不能点」。

现在每一页都有：

| 页面 | 点一下做什么 |
| --- | --- |
| `home` | 收起 / 展开**原生**侧栏（宿主的 `layout.toggleSidebar`） |
| 论文 / 笔记 / 文档 / 学习 | 收起 / 展开**这一页自己的**侧栏 |
| 插件 / 页面管理 / 规划 / 题库 | 不注册 → 渲染裸鲸鱼，与加这个功能之前逐像素相同 |

### 页面怎么把侧栏接进来

页面**不认识**导轨，导轨也**不认识**任何具体页面：`packages/client/*` 之间有
`tests/repo/page-isolation.test.mjs` 守着，不许互相 import。所以这条线走
`ui-shared` 的单向契约：

```jsx
import { useRegisterPageSidebar } from '@lybx-leyw/dsh-zju-ui-shared';

// 必须在组件顶部的所有提前 return 之前（hook 数量不能变）。
const [open, setOpen] = useState(true);
const toggle = useCallback(() => setOpen(v => !v), []);
useRegisterPageSidebar('notes', { expanded: open, toggle, label: open ? '收起文件树' : '展开文件树' });
```

产品层那一侧只有一句 `usePageSidebar(pageId)`。页面没登记（没有侧栏、还没挂载完、
或者这一页没装）时，导轨退回裸鲸鱼 —— **不登记就是默认路径**，不会出现一个按了
没反应的按钮。

`label` 不是可选的装饰：导轨那个按钮的 `aria-label` / `title` 必须说清「点一下是
收起还是展开」，否则读屏用户永远听到「收起侧边栏」，而它当时其实会展开。

### 视觉证据

`docs/evidence/` 下是同一台实例、1440×900、浅色主题的前后对照：`before-*` 是改动前
（导轨那格只是一个不可点的鲸鱼 svg），`after-*-expanded` / `after-*-collapsed` 是改动后
点一次的结果。
