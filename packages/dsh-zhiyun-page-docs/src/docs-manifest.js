// 「文档」页的目录清单：分区 → 页。
//
// # 这份清单是纯数据，不 import 任何 markdown
//
// 正文的 import 全部集中在 `docs-content.js` 一处（那里 `import xxx from './docs/xxx.md'`）。
// 分开的好处是这份清单能被裸 Node 直接 import —— `tests/docs-page.test.mjs` 用它来核对
// 「清单里的每一页都真有对应文件」「文件开头的 `# 标题` 与清单里的标题一致」，
// 而这些检查不需要构建、不需要宿主、不需要浏览器。
//
// # 正文从哪来
//
// 全部是**本包内置的副本**（`src/docs/*.md`），不是运行时去读仓库的 `docs/` 目录。
// 内容摘写自 `docs/contributing/CONTRIBUTING.md` 与 `docs/contributing/AGENTS.md`，
// 每篇末尾都标了源路径。取舍与"怎么保证两份不漂"写在包内 README 里。

/** 分区顺序即左侧目录的显示顺序，也决定翻页的先后。 */
export const SECTIONS = Object.freeze([
  {
    id: 'start',
    label: '入门',
    pages: [
      {
        id: 'overview',
        title: '项目概览',
        summary: '这个工作台是什么、由哪些包拼起来、一页能看见什么',
        file: 'overview.md',
      },
      {
        id: 'setup',
        title: '安装与启动',
        summary: '装独立宿主、装依赖、构建启动，以及桌面壳怎么开',
        file: 'setup.md',
      },
      {
        id: 'config',
        title: '常用配置与排查',
        summary: '端口、宿主路径、数据目录，以及起不来时先看哪里',
        file: 'config.md',
      },
    ],
  },
  {
    id: 'collab',
    label: '协作',
    pages: [
      {
        id: 'vibe',
        title: 'Vibe coding 参与指南',
        summary: '不写代码也能参与：让 AI 起实例，你只负责体验、提问题与验收',
        file: 'vibe.md',
        // 这一篇不是摘写，是维护者口述后整理的 —— 页脚得照实说，
        // 不然读者会去 `docs/contributing/` 里找一份根本不存在的东西。
        source: '本页由项目维护者口述、文档页整理，没有对应的仓库原文；具体规则以其余各篇为准。',
      },
      {
        id: 'owners',
        title: 'Owner 机制',
        summary: '三种模式、声明放在哪、怎么读到自己那份归属',
        file: 'owners.md',
      },
      {
        id: 'plugin',
        title: '写一个插件包',
        summary: '一个页面包的四个文件、两个半边，以及插槽怎么接',
        file: 'plugin.md',
      },
      {
        id: 'testing',
        title: '测试与验证',
        summary: '纯函数单测、样式顺序检查，以及真机验收',
        file: 'testing.md',
      },
      {
        id: 'attribution',
        title: '第三方来源与协议',
        summary: '参考别人之前先看许可证，引入多少记多少',
        file: 'attribution.md',
      },
      {
        id: 'privacy',
        title: '个人信息与提交',
        summary: '公开仓库的六类红线，以及提交前要跑一遍的自查',
        file: 'privacy.md',
      },
    ],
  },
  {
    id: 'reference',
    label: '参考',
    pages: [
      {
        id: 'layout',
        title: '仓库目录结构',
        summary: '每个顶层目录放什么，插件的宿主半边与浏览器半边在哪',
        file: 'layout.md',
      },
      {
        id: 'shell',
        title: '外壳契约速查',
        summary: '导航、插槽名、整幅铺开的判定，与样式变量的清单',
        file: 'shell.md',
      },
    ],
  },
]);

/** 默认打开的那一页。 */
export const DEFAULT_PAGE = 'overview';
