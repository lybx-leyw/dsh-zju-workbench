/**
 * 给 `@lybx-leyw/dsh-pages` 的「页面管理」页做版式重排 —— **只改排布与层次，不改配色**。
 *
 * # 要解决的问题：大面积空白
 *
 * 页面壳原版把内容锁在 `max-width:960px` 居中，在 1600px 的窗口里左右各空 335px
 * （实测只用到 57% 宽度），垂直也只填了 71%。视觉上就是「界面很大、内容缩在中间一竖条」，
 * 没有层次。产品版式改成**用满宽度 + 三段式**：
 *
 *   1. 满宽的标题区（标题 + 说明 + 一条分隔线）；
 *   2. 满宽的设置条（导航位置 / 导航宽度并排成一张卡片里的一行）；
 *   3. 三张分组卡片**并排**（顶部组 / 回收组 / 底部组），每张内部是一条条页面行。
 *
 * 分组的数量由页面壳决定（固定三组），用 `grid-template-columns: repeat(3, ...)` 让它们
 * 铺满整行；窄屏逐级退成两列、一列。
 *
 * # 为什么是外挂 CSS
 *
 * 页面壳是锁版本的 npm 依赖（`0.1.3`），源码在 `node_modules` 里，改它下次安装就丢。
 * 这一页的 DOM 自带 `data-pages-manager` 容器与 `pm-*` 类名，是页面壳留出的稳定锚点。
 *
 * # 特异性：为什么每条规则都以 `:root` 开头
 *
 * 页面壳把自己的 `<style>` 渲染在 `[data-pages-manager]` **内部**，每次重渲染重新插入，
 * DOM 顺序上永远排在我们（放在 `head` 的）后面 —— 同特异性下它会赢。加一层 `:root`
 * 祖先即稳定压过（(0,2,1) vs (0,1,1)），**不用 `!important`**：那会把用户与主题自己的
 * 覆盖一起钉死，而这里只是产品默认值。
 *
 * # 不改的东西
 *
 * 配色一律沿用页面壳已用的 `--dsw-alias-*` 令牌（浅色/深色主题自动跟随）；`aria-*`、
 * `role`、拖拽语义、可聚焦顺序全部不动。
 */

/**
 * 页面管理页的样式表。
 *
 * 所有规则都以 `:root [data-pages-manager]` 为根 —— 既压过页面壳自己的样式，
 * 也绝不外溢到别的页面。
 */
export const MANAGER_CSS = `
/* ============ 背景：对齐 DSH home 页 ============ */
/* 页面壳给业务页内容区铺的是 --dsw-alias-bg-layer-2，而 DSH 原生 home 页的底色是
   --dsw-alias-bg-base。暗色下两者分别是 #2c2c2e 与 #151517 —— 差一整级，于是页面
   管理页看起来比 home 页「亮了一块」。这里把内容区拉回 home 页那一级。

   ⚠️ 亮色主题下所有 bg-* 令牌**都是纯白 #fff**（实测 bgBase / bgLayer1 / bgLayer2 /
   bgLayer3 / settingsCardFill 全等于 #fff）。也就是说亮色下「靠底色层级差」这条路
   根本不存在：卡片和背景天生同色。DSH 自己在这个主题下靠两样东西区分区块 ——
   描边色，以及比纯白暗一级的实色填充（原生设置里是 rgb(245,246,247)）。
   所以卡片填充用 --zju-card-fill 这个派生值，两种主题各自成立。 */
:root [data-dsh-pages-shell] > section[aria-label] > [data-dsh-pages-content],
:root [data-pages-manager]{
  background:var(--dsw-alias-bg-base,#fff);
}
/* ============ 骨架：满宽 + 三列网格 ============ */
:root [data-pages-manager]{
  /* 卡片描边色：从前景令牌派生，浅色/深色主题都成立（原因见文件头 CARD_BORDER 说明） */
  --zju-card-border:color-mix(in srgb, var(--dsw-alias-label-primary,#0f1115) 30%, transparent);
  /* 卡片填充：暗色下用 layer-2（比底色亮一级）；亮色下两者都是纯白，改由 4% 前景色
     压暗一点点，得到与原生设置分区同一档的 rgb(245,246,247) 观感。 */
  --zju-card-fill:color-mix(in srgb, var(--dsw-alias-label-primary,#0f1115) 4%, var(--dsw-alias-bg-base,#fff));
  display:grid;
  /* 三个分组各自一列，铺满可用宽度；上限放宽到 1560 以免超宽屏上一行过长 */
  grid-template-columns:repeat(3,minmax(0,1fr));
  gap:18px 16px;
  box-sizing:border-box;
  width:100%;
  max-width:1560px;
  margin:0 auto;
  padding:clamp(20px,2.4vw,32px) clamp(20px,2.4vw,32px) 48px;
  line-height:1.55;
  align-items:start;
  overflow-wrap:anywhere;
}
:root [data-pages-manager] *{
  box-sizing:border-box;
  min-width:0;
}
/* 页头标题与说明按产品要求去掉：这一页的入口就在导轨上（图标+悬停标题），
   页面里再写一遍「页面管理」和大段说明属于重复。整块 header 只含 h2 + p，
   没有别的语义内容，所以直接不生成盒子；连带它下面的分隔线一起省掉。 */
:root [data-pages-manager] > header{
  display:none;
}

/* ============ 设置条：两张 label 并成一排卡片 ============ */
:root [data-pages-manager] > section:has(> label){
  grid-column:1 / -1;
  margin:0;
}
/* 两个设置 section 各自是一张卡；用「同排」把它们横过来 */
:root [data-pages-manager] > section:has(> label) > label{
  display:grid;
  grid-template-columns:minmax(80px,auto) 1fr auto;
  align-items:center;
  gap:8px 14px;
  padding:12px 16px;
  border:1px solid var(--zju-card-border,#00000047);
  border-radius:var(--dsw-radius-md,12px);
  background:var(--zju-card-fill,var(--dsw-alias-bg-layer-2,#fff));
}
:root [data-pages-manager] > section:has(> label) > label > span{
  font-size:13px;
  font-weight:500;
  color:var(--dsw-alias-label-primary,#0f1115);
  white-space:nowrap;
}
:root [data-pages-manager] > section:has(> label) > label > :is(select,input[type=range]){
  justify-self:start;
}
:root [data-pages-manager] > section:has(> label) > label > output{
  justify-self:end;
  min-width:52px;
  text-align:right;
  font:12px ui-monospace,SFMono-Regular,Menlo,monospace;
  color:var(--dsw-alias-label-secondary,#61666b);
}

/* 滑杆：收成中性轨道 + 小圆拖柄，去掉默认控件的艳色 */
:root [data-pages-manager] input[type=range]{
  appearance:none;-webkit-appearance:none;
  width:min(320px,100%);
  height:20px;
  background:transparent;
  cursor:pointer;
}
:root [data-pages-manager] input[type=range]::-webkit-slider-runnable-track{
  height:4px;
  border-radius:999px;
  background:var(--dsw-alias-border-l3,#0000001f);
}
:root [data-pages-manager] input[type=range]::-webkit-slider-thumb{
  appearance:none;-webkit-appearance:none;
  width:14px;height:14px;
  margin-top:-5px;
  border-radius:999px;
  border:1px solid var(--dsw-alias-border-l3,#0000001f);
  /* 拖柄用 layer-2：暗色下比 bg-base 亮一级，才看得出这一颗是滑块 */
  background:var(--zju-card-fill,var(--dsw-alias-bg-layer-2,#fff));
  box-shadow:0 1px 2px #0000001f;
}
:root [data-pages-manager] input[type=range]:focus-visible{
  outline:2px solid var(--dsw-alias-brand-primary,#0f1115);
  outline-offset:4px;
  border-radius:999px;
}

/* ============ 分组：三张并排的卡片 ============ */
:root [data-pages-manager] > section:not(:has(> label)){
  margin:0;
  padding:14px;
  /* 分组卡片是全页最主要的视觉单元，描边用略深的一档，再加一层极淡投影把卡片托起来 */
  border:1px solid var(--zju-card-border,#00000047);
  border-radius:var(--dsw-radius-md,12px);
  background:var(--zju-card-fill,var(--dsw-alias-bg-layer-2,#fff));
  box-shadow:0 1px 2px color-mix(in srgb, var(--dsw-alias-label-primary,#0f1115) 6%, transparent);
  /* 卡片自身滚动：分组很长时不会把整页拉得老高 */
  max-height:calc(100vh - 340px);
  min-height:132px;
  overflow:auto;
}
/* 分组标题：小号大写字 + 计数胶囊 */
:root [data-pages-manager] > section:not(:has(> label)) > h3{
  display:flex;
  align-items:center;
  gap:8px;
  margin:0 0 10px;
  font-size:11px;
  font-weight:600;
  letter-spacing:.09em;
  text-transform:uppercase;
  color:var(--dsw-alias-label-secondary,#61666b);
}
:root [data-pages-manager] > section:not(:has(> label)) > h3 > span{
  display:inline-grid;
  place-items:center;
  min-width:18px;height:18px;
  padding:0 5px;
  border-radius:999px;
  background:var(--dsw-alias-interactive-bg-hover,#2631480f);
  font:11px/1 ui-monospace,SFMono-Regular,Menlo,monospace;
  letter-spacing:0;
  opacity:1;
}

/* ============ 行：窄列里改成上下两段 ============ */
:root [data-pages-manager] ul{
  display:flex;
  flex-direction:column;
  gap:2px;
  margin:0;
  padding:0;
  list-style:none;
  min-height:0;
  border-radius:var(--dsw-radius-sm,8px);
}
:root [data-pages-manager] li{
  /* 三列布局下每列只有约 420px，横排六个控件会挤成一团 —— 改上下两段 */
  display:flex;
  flex-direction:column;
  align-items:stretch;
  gap:6px;
  padding:8px 10px;
  border:1px solid transparent;
  border-radius:var(--dsw-radius-sm,8px);
  background:transparent;
  transition:background .12s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1));
}
:root [data-pages-manager] li:not(.pm-empty):hover{
  background:var(--dsw-alias-interactive-bg-hover,#2631480f);
}
:root [data-pages-manager] .pm-identity{
  display:flex;
  align-items:center;
  gap:8px;
  flex:1 1 auto;
}
/* 拖柄平时不占视线，悬停/聚焦才显形 */
:root [data-pages-manager] .pm-grip{
  width:12px;
  flex:none;
  text-align:center;
  color:var(--dsw-alias-label-caption,#adb2b8);
  opacity:0;
  user-select:none;
  transition:opacity .12s var(--ds-ease-in-out,cubic-bezier(.4,0,.2,1));
}
:root [data-pages-manager] li:hover .pm-grip,
:root [data-pages-manager] li:focus-within .pm-grip{
  opacity:1;
}
:root [data-pages-manager] .pm-icon{
  display:grid;
  place-items:center;
  width:22px;height:22px;
  flex:none;
  /* 与导轨同一套图形：描边跟随当前文字色，行悬停时不会突然变色 */
  color:var(--dsw-alias-label-primary,#0f1115);
}
:root [data-pages-manager] .pm-icon svg{
  /* 与导轨、与各页面插件声明的图标同一规格（19px / 24 网格 / 1.65 描边） */
  width:19px;height:19px;
}
:root [data-pages-manager] .pm-name{
  display:block;
  font-size:13px;
  font-weight:500;
  line-height:1.35;
}
:root [data-pages-manager] .pm-id{
  display:block;
  margin-top:1px;
  font-size:10.5px;
  color:var(--dsw-alias-label-caption,#adb2b8);
}

/* ============ 操作区：一行次要按钮 + 主操作 ============ */
:root [data-pages-manager] .pm-actions{
  display:flex;
  flex-wrap:wrap;
  align-items:center;
  gap:2px;
  width:100%;
  max-width:100%;
  flex:0 0 auto;
  padding-left:20px;
}
:root [data-pages-manager] .pm-actions button,
:root [data-pages-manager] .pm-actions select{
  min-height:26px;
  border:1px solid transparent;
  border-radius:6px;
  background:transparent;
  color:var(--dsw-alias-label-secondary,#61666b);
  font:inherit;
  font-size:11.5px;
  line-height:1.4;
  padding:2px 6px;
  cursor:pointer;
}
:root [data-pages-manager] .pm-actions button:hover:not(:disabled){
  background:var(--dsw-alias-interactive-bg-hover,#2631480f);
  color:var(--dsw-alias-label-primary,#0f1115);
}
:root [data-pages-manager] .pm-actions button:disabled{
  opacity:.3;
  cursor:not-allowed;
}
/* 方向键：等宽正方，视觉上自成一组 */
:root [data-pages-manager] .pm-actions button[aria-label^="上移"],
:root [data-pages-manager] .pm-actions button[aria-label^="下移"],
:root [data-pages-manager] .pm-actions button[aria-label^="移到最前"]{
  width:26px;
  padding:0;
  font-size:12px;
}
/* 分组下拉：与按钮同高同圆角，箭头留出位置 */
:root [data-pages-manager] .pm-actions select{
  appearance:none;-webkit-appearance:none;
  padding:2px 22px 2px 7px;
  border-color:var(--dsw-alias-settings-card-stroke,#00000029);
  background-color:var(--dsw-alias-bg-base,#fff);
  background-image:linear-gradient(45deg,transparent 50%,currentColor 50%),linear-gradient(135deg,currentColor 50%,transparent 50%);
  background-position:calc(100% - 12px) 52%,calc(100% - 8px) 52%;
  background-size:4px 4px,4px 4px;
  background-repeat:no-repeat;
}
/*「打开」是这一行真正的主操作，给它实体感 */
:root [data-pages-manager] .pm-actions button[aria-label^="打开"]{
  margin-left:auto;
  padding:2px 10px;
  border-color:var(--dsw-alias-settings-card-stroke,#00000029);
  background:var(--dsw-alias-bg-base,#fff);
  color:var(--dsw-alias-label-primary,#0f1115);
  font-weight:500;
}
:root [data-pages-manager] .pm-actions button[aria-label^="打开"]:hover:not(:disabled){
  background:var(--dsw-alias-interactive-bg-hover,#2631480f);
}
:root [data-pages-manager] :is(button,select):focus-visible{
  outline:2px solid var(--dsw-alias-brand-primary,#0f1115);
  outline-offset:2px;
}

/* ============ 空状态：一行轻提示 ============ */
:root [data-pages-manager] .pm-empty{
  min-height:0;
  padding:10px;
  border:0;
  border-radius:var(--dsw-radius-sm,8px);
  background:var(--dsw-alias-interactive-bg-hover,#2631480f);
  font-size:12px;
  color:var(--dsw-alias-label-caption,#adb2b8);
}

/* ============ 拖拽反馈：细线代替厚色条 ============ */
:root [data-pages-manager] li[data-insert=before]{
  box-shadow:inset 0 2px var(--dsw-alias-brand-primary,#0f1115);
}
:root [data-pages-manager] li[data-insert=after]{
  box-shadow:inset 0 -2px var(--dsw-alias-brand-primary,#0f1115);
}
:root [data-pages-manager] li[data-dragging=true]{
  opacity:.35;
}

/* ============ 响应式：三列 → 两列 → 一列 ============ */
@media(max-width:1180px){
  :root [data-pages-manager]{
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
  :root [data-pages-manager] > section:not(:has(> label)){
    max-height:none;
  }
}
@media(max-width:760px){
  :root [data-pages-manager]{
    grid-template-columns:minmax(0,1fr);
    gap:14px;
  }
  :root [data-pages-manager] > section:has(> label) > label{
    grid-template-columns:1fr;
    justify-items:start;
  }
  :root [data-pages-manager] > section:has(> label) > label > output{
    justify-self:start;
  }
  /* 单列时空间充裕，行恢复成横排 */
  :root [data-pages-manager] li{
    flex-direction:row;
    flex-wrap:wrap;
    align-items:center;
  }
  :root [data-pages-manager] .pm-actions{
    width:auto;
    flex:1 1 auto;
    justify-content:flex-end;
    padding-left:0;
  }
}
`;

/**
 * 把上面那份样式挂进文档。
 *
 * 用 `<style>` 内联而不是 `<link>`：只有几 KB，省一次请求，也和页面壳自己注入样式的
 * 方式一致。挂载点选 `head` 末尾；即便它排在页面壳的 `<style>` 之前，靠 `:root`
 * 加权也压得住（原因见文件头）。
 *
 * @param doc - 文档对象，默认 `globalThis.document`。
 * @returns 还原函数。
 */
export function installManagerStyle(doc = globalThis.document) {
  if (doc?.createElement === undefined || doc.head === undefined) return () => {};
  // 幂等：重复安装只保留一份，避免多次挂载后规则重复堆积。
  for (const existing of doc.querySelectorAll('style[data-zju-manager-style]') ?? []) {
    existing.remove?.();
  }
  const style = doc.createElement('style');
  style.dataset.zjuManagerStyle = '';
  style.textContent = MANAGER_CSS;
  doc.head.append(style);
  return () => style.remove?.();
}



