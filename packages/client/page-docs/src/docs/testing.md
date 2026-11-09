# 测试与验证

单测不强制，但强烈建议：改动出错时其他人能立刻发现，也才敢动这个包。

## 单测放在哪、怎么写

放仓库根目录的 `tests/<名字>.test.mjs`。`npm test` 就是 `node --test tests/*.test.mjs`，
文件名必须匹配 `*.test.mjs`。

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { scanHeadings } from '../packages/dsh-zhiyun-page-docs/src/outline.js';

test('围栏代码块里的 ## 不算标题', () => {
  const markdown = ['# 甲', '```', '## 不是标题', '```', '## 真标题'].join('\n');
  assert.deepEqual(scanHeadings(markdown), [{ depth: 2, text: '真标题' }]);
});
```

三条硬要求：**直接 import 源码**（不经构建产物）、**不需要宿主**、**不连网**。
这样任何人都能用一条命令跑完，不会因为"我这没装宿主"而跳过。

需要外部真值的用例，把夹具放在包内的 `fixtures/`，并在注释里写明生成方式。

## 三种验证，各有各的域

| 命令 | 管什么 | 什么时候跑 |
| --- | --- | --- |
| `npm test` | 纯函数与模块契约 | 每次改动 |
| `npm run check:css` | 样式表顺序隐患 | 改了样式表 |
| `npm run test:host` | 插槽、导航、主题在真实宿主里的表现 | 改了插槽、导航、主题或宿主适配 |

`test:host` 会在 `artifacts/` 留下报告与截图。**它替代不了手动看一遍** ——
"这一页能用"和"这一页好用"是两件事，后者只能自己点。

## 样式顺序检查在防什么

每个客户端包都把自己那份 CSS 挂成一个独立的 `<style>`。同特异性的规则撞在同一
元素上时，**胜负只取决于挂载顺序** —— 而顺序由插件的加载时机决定，不是你能直接控制的。

`npm run check:css` 检查三类：

1. **跨包冲突**：两个包用同特异性的选择器争同一个属性、且值不同
2. **同包内 `@media` 倒序**：媒体查询写在它要覆盖的基规则之前 → 那条覆盖是死规则
3. **简写与长写争同一块地盘**：`margin` 与 `margin-top` 这类

真踩过的形状：两个媒体查询被整块留在共享原语包里（那个包永远最先挂载），
移动端的覆盖全部失效，窄屏上字号一直是 24px 而非 18px。**单看那个包是好的**，
装到一起才错。

规避办法很简单：**给本包的类名加专属前缀**。选择器里没有共同的记号时，
检查器就判定"不可能命中同一元素"，天然不参与那场竞争。

## 提交前的手动验收

1. `npm test` 全绿
2. 改了样式 → `npm run check:css` 全绿
3. 改了插槽/导航/主题 → `npm run test:host`，看报告与截图
4. `npm start`（或 `npm run dev`）后用真实数据走一遍那一页
5. 按「个人信息与提交」自查一遍改动

第 4 条不能省。自动化能看到"元素在不在"，看不到"读着累不累"。

---

> 内容摘写自 `docs/contributing/CONTRIBUTING.md` 第 3.2、4.5 节，以及
> `scripts/check-css-order.mjs` 的注释。
