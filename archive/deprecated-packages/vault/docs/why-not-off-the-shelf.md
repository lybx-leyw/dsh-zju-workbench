# 为什么没有用现成的 Obsidian 解析库

按仓库约定（[AGENTS.md](../../../docs/contributing/AGENTS.md) 第 3.3 节），
引入任何外部实现之前必须先找现成的。本包找过，结论是**都不能用**，理由如下。
日后若有人想换掉自研解析，先读这一页，避免重复调研。

## 调研过的候选（都是 MIT）

| 包 | 版本 | 定位 | 为什么不用 |
| --- | --- | --- | --- |
| [`obsidian-vault-parser`](https://github.com/coffee-cup/obsidian-vault-parser) | 0.4.1 | 读整个 Obsidian 库，产出 links / backLinks / tags | **只认 ASCII**，见下 |
| [`remark-wiki-link`](https://github.com/landakram/remark-wiki-link) | 2.0.1 | remark 生态的 wiki 链接 → AST 节点 | 只是**渲染**：产出 `wikiLink` 节点与 `href`，不做反向链接、不做图谱、不索引全库。要给 remark 用，而本包跑在 Node 里、不与 Markdown 渲染管线耦合 |
| [`micromark-extension-wiki-link`](https://github.com/landakram/micromark-extension-wiki-link) | 0.0.4 | micromark 底层 token 扩展 | 同上，且层级更低（要自己接 mdast/hast） |

## 决定性的一条：`obsidian-vault-parser` 只认 ASCII

它的链接解析就一个正则（`src/files.ts`，2026-10 核对）：

```js
const linkRegex = /\[\[([a-zA-Z0-9\s-]+\|?[a-zA-Z0-9\s]*)\]\]/g;
```

字符类只有 `a-zA-Z0-9\s-` —— **中文笔记名一个都匹配不到**。而本工作台的用户
笔记名几乎必然是中文（「概率论」「大数定律」「第三章-极限」）。

实测一下就很直观。用它的原正则跑几种写法：

| 输入 | 结果 |
| --- | --- |
| `[[大数定律]]` | **未命中** |
| `[[概率论\|概率]]` | **未命中** |
| `[[笔记#小节]]` | **未命中** |
| `[[MyNote]]` | 命中 `mynote` |
| `[[My Note\|Alias]]` | 命中 `my note` |

也就是说：库里放「概率论.md」与「大数定律.md」，正文写 `[[大数定律]]`，
它返回**空数组** —— 链接整条丢失，反向链接与图谱全是空的，
而界面不会报错（它只是"没找到链接"）。对中文用户来说这是**静默失效**。

另外它还有三处不满足本仓需要：

1. **必须读磁盘**（`readVault(path)` 走 `glob` + `fs`）。本仓的领域包一律零 IO，
   笔记内容由宿主存储栈保管（见 `src/host.js` 的说明）。
2. **不做 `#锚点`**（`[[笔记#小节]]`、`[[笔记#^块id]]`）与 `![[嵌入]]` 的区分。
3. **不做代码块排除** —— 代码示例里的 `[[x]]` 会被当成真链接。

## 所以本仓自研的部分与边界

`src/parse/links.js` 与 `src/index/vault-index.js` 是**自己写的**，只做这几件事：

- **Unicode 安全的语法解析**：中文标签/笔记名、`|别名`、`#标题`、`#^块引用`、
  `![[嵌入]]`、行内标签（要求 `#` 前有分隔符，避开「第#3章」）、
  代码块/行内代码/行内数学/URL 的排除区。
- **双向能力**：反向链接、未解析链接（分 `missing` / `ambiguous`）、孤立节点、图谱出入度。
- **重命名改链**：三种形态（裸链接、带别名、带锚点）都要改，且**不误改同名但指向别处的链接**。

这些都是"数据形状"层面的东西，不是通用 Markdown 渲染，所以没有现成包能直接替。
所有边界都有测试钉住（`tests/vault.test.mjs`，32 项）。

## 日后再调研时先看这两条

1. 有没有包**支持 Unicode 笔记名**（拿中文名跑一遍它的解析函数就知道）。
2. 它是**渲染插件**还是**库索引器**。本包要的是后者 —— 反向链接与图谱必须全库重算，
   单篇渲染阶段拿不到。
