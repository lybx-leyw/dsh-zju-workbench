import React, { useEffect, useRef, useState } from 'react';
import { Empty, Icon, Mark, StudentAvatar, useStore } from 'dsh-zhiyun-shell-ui';
import { NAV, FULL_BLEED_PAGES, RAIL_DEFAULT, RAIL_ACCOUNT, matchingPages, pageSlot, visiblePages } from './model.js';

/** 导轨**下半组**（分隔线下方）固定了哪些页，记在 localStorage。 */
const PINNED_KEY = 'zhiyun.rail.pinned';

/**
 * 读用户固定到导轨下半组的页。
 *
 * ⚠️ 导轨**上半组**（`RAIL_DEFAULT`）是不可撤销的，所以这里存的是**下半组**的清单 ——
 * 旧版本存的是整份导轨清单（含今天/我的课…），直接沿用会把它们同时塞进下半组，
 * 导轨上出现两份。所以这里过滤掉上半组的 id（一次迁移，写在一行里）。
 *
 * 坏数据 / 无痕模式一律**退回空清单**而不是报错：这是外观偏好，取不到就当没固定过。
 */
function readPinned() {
  try {
    const raw = globalThis.localStorage?.getItem(PINNED_KEY);
    const parsed = raw === null || raw === undefined ? null : JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) {
      // 上半组不参与固定/取消固定，一并滤掉。`RAIL_ACCOUNT` 不再是页面，
      // 但老用户的 localStorage 里可能还留着 `'me'` 这类已删除的页 id，一并清掉。
      return parsed.filter((id) => !RAIL_DEFAULT.includes(id) && id !== RAIL_ACCOUNT && id !== 'me');
    }
  } catch { /* 坏 JSON / 无痕模式：当作没设过 */ }
  return [];
}

function writePinned(ids) {
  try { globalThis.localStorage?.setItem(PINNED_KEY, JSON.stringify(ids)); } catch { /* 无痕模式就算了 */ }
}

export function SearchDialog({ controller, open, onClose, pages }) {
  const dialog = useRef(null);
  const [query, setQuery] = useState('');
  const items = matchingPages(query, pages);
  useEffect(() => {
    if (open) { setQuery(''); dialog.current.showModal(); }
    else if (dialog.current.open) dialog.current.close();
  }, [open]);
  return <dialog className="zy-search-dialog" ref={dialog} aria-label="跳转到" onCancel={onClose} onClose={onClose} onClick={event => { if (event.target === dialog.current) onClose(); }}>
    <form method="dialog" onSubmit={event => { event.preventDefault(); if (items[0]) { controller.navigate(items[0].id); onClose(); } }}>
      <div className="zy-search-input"><Icon name="search"/><input aria-label="搜索页面" placeholder="想去哪里？" value={query} onChange={event => setQuery(event.target.value)} autoFocus/><button type="button" onClick={onClose} aria-label="关闭跳转"><kbd>Esc</kbd></button></div>
      <div className="zy-search-results">{items.length ? items.map(item => <button type="button" key={item.id} onClick={() => { controller.navigate(item.id); onClose(); }}><Icon name={item.icon}/><span>{item.label}<small>{item.hint}</small></span><Icon name="arrow" size={16}/></button>) : <p>没有找到这个页面</p>}</div>
    </form>
  </dialog>;
}

export function Sidebar({ collapsed, controller, renderSlot, activePage: active, hidden, account }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [tip, setTip] = useState(null);
  // 导轨上固定了哪些页（用户可以改，见 readPinned）。
  const [pinned, setPinned] = useState(readPinned);
  /**
   * 当前浮出的面板：`null` 或 `{ kind, top, left }`。
   *
   * 两个面板（「···」菜单、头像的账号面板）共用这一份状态，于是**同时只会开一个** ——
   * 分开存两份的话，点另一个不会收起前一个。`kind` 同时决定渲染哪一块内容。
   */
  const [menu, setMenu] = useState(null);
  // 账号对话框的开合由壳的控制器持有（页面里的登录按钮也要能打开它）。
  const accountOpen = useStore(account);
  const accountDialog = useRef(null);
  // 被取消的页不在侧栏、也不在跳转搜索里 —— 两处必须用同一份清单，否则会出现
  // 「侧栏看不到，但 Ctrl+K 能跳过去」的半坏状态。
  const pages = visiblePages(useStore(hidden));  useEffect(() => {
    function key(event) {
      if (active !== 'ask' && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); event.stopImmediatePropagation(); setSearchOpen(value => !value);
      }
    }
    document.addEventListener('keydown', key, true);
    return () => document.removeEventListener('keydown', key, true);
  }, [active]);

  // 面板打开时：点外面或按 Esc 关掉。两个监听都挂在 document 上 —— 面板与触发器
  // 都在 document 流之外（fixed），只能这样判。
  useEffect(() => {
    if (menu === null) return undefined;
    const onDown = (event) => {
      // 两个面板共用 `.zy-rail-menu`，两个触发器各一个类名：不忽略它们的话，
      // 点在面板内部或触发器上会先被关掉，再被 click 重新打开（闪一下）。
      if (event.target.closest?.('.zy-rail-menu') || event.target.closest?.('.zy-rail-more') || event.target.closest?.('.zy-rail-avatar')) return;
      setMenu(null);
    };
    const onKey = (event) => { if (event.key === 'Escape') setMenu(null); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [menu]);

  // 账号对话框跟着控制器里的开关走。`showModal()` 自己管焦点陷阱与 Esc
  // （Esc 触发 `cancel`，那里同步把状态关掉，否则会和状态不同步）。
  useEffect(() => {
    const dialog = accountDialog.current;
    if (!dialog) return;
    if (accountOpen && !dialog.open) dialog.showModal();
    else if (!accountOpen && dialog.open) dialog.close();
  }, [accountOpen]);

  const togglePin = (id) => {
    setPinned((current) => {
      const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      writePinned(next);
      return next;
    });
  };

  /**
   * 浮出一个贴按钮的面板。
   *
   * 坐标按按钮实测（fixed 定位逃出宿主列的裁剪，同提示）；面板比按钮高得多，
   * 所以纵向要**夹进视口**，否则在窗口下半部打开时会被切掉一截。
   * 高度按行数估算就够了 —— 每行 34px + 上下内边距，不依赖渲染后的测量。
   */
  const floatPanel = (kind, rows, event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const estimated = rows * 35 + 14;
    return {
      kind,
      top: Math.max(12, Math.min(rect.top, globalThis.innerHeight - estimated - 12)),
      left: rect.right + 10,
    };
  };
  /** 同一个触发器再点一次收起；点另一个触发器直接换成它。 */
  const togglePanel = (kind, rows) => (event) => setMenu(menu?.kind === kind ? null : floatPanel(kind, rows, event));

  /** 导轨的两组：上半组（固定、不可撤销）与下半组（用户固定的）。 */
  const primaryPages = pages.filter((page) => RAIL_DEFAULT.includes(page.id));
  const extraPages = pages.filter((page) => pinned.includes(page.id));
  /** 可管理的页 = 既不在上半组、也不是头像那一格：菜单里只列它们。 */
  const manageablePages = pages.filter((page) => !RAIL_DEFAULT.includes(page.id));

  /**
   * ⚠️ **侧栏不允许展开**（当前的产品决定）：这一列只有图标，名字靠悬停浮出。
   *
   * 宿主侧栏那一列默认是展开的（280px），所以挂载后要把它收回 56px；之后若从
   * 别处又把它拉开，这里也会再收回去 —— 展开态下我们只渲染导轨，那 280px 里会
   * 空出一大片，看着像坏了。
   *
   * `asked` 那道闸门是防重复调用：万一 `toggleSidebar()` 没能真把状态改过去，
   * 没有它就会每次渲染都调一次（宿主侧栏会抖）。
   */
  const asked = useRef(false);
  useEffect(() => {
    if (collapsed) { asked.current = false; return; }
    if (asked.current) return;
    asked.current = true;
    controller.toggleSidebar();
  }, [collapsed, controller]);

  /**
   * 导轨上的名字提示。
   *
   * ⚠️ 用 `position: fixed` + 实测坐标，不用 `absolute` + `left:100%`：
   *    宿主侧栏列是 `overflow:hidden` 的，那一列只有 56px 宽 ——
   *    absolute 的提示会被列本身剪掉（导轨自己设 `overflow:visible` 也没用，
   *    裁剪发生在祖先上）。fixed 定位不受祖先裁剪影响。
   *
   * 导轨既然不展开，名字就**只能**靠它看到 —— 这是这一版唯一的文字出口，
   * 所以每个可点元素（含品牌、搜索、明暗）都必须挂上。
   */
  const showTip = (event, label) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTip({ label, top: rect.top + rect.height / 2, left: rect.right + 10 });
  };
  const hideTip = () => setTip(null);
  const tipProps = (label) => ({
    onMouseEnter: (event) => showTip(event, label),
    onMouseLeave: hideTip,
    onFocus: (event) => showTip(event, label),
    onBlur: hideTip,
  });

  return <div className="zy-sidebar zy-collapsed" aria-label="智云主导航">
    {/* 「跳到主内容」。
        ⚠️ 必须留在**这里**（侧栏根节点的第一个孩子），不能挂到页面上：宿主的框架先渲染
           侧栏列、再渲染中间列，所以全页 DOM 顺序上侧栏在最前。放进 `.zy-page` 的话，
           它前面已经压着整个导轨和课程树，一次 Tab 跳不过去。
        导轨收起只是把这一列压到 56px，组件照常挂载；`position:fixed`（见 style.css）
        也不受那一列 `overflow:hidden` 影响，所以两种状态下它都排在最前。 */}
    <a className="zy-skip-link" href="#zy-main">跳到主内容</a>
    <aside className="zy-rail">
      {/* 品牌提示里带上学习空间的名字：侧栏不再展开后，原来底部那一行
          「独立学习空间 · <profile>」没有别的地方可放，挂在这里正好。 */}
      <button className="zy-rail-brand" title="智云 Pro · 今天" aria-label="智云 Pro · 今天" onClick={() => controller.navigate('today')} {...tipProps(`独立学习空间 · ${__ZHIYUN_PROFILE__}`)}><Mark compact/></button>
      {/* 「跳转到…」没有常驻按钮：只保留 Ctrl+K（下面那个 keydown 监听）。
          导轨上少一个图标，快捷键照旧。*/}
      {/* 导航分两组：默认固定组 → 「···」→ 分隔线 → 用户额外固定的页。
          分隔线只在真有额外固定项时出现（见 README 的「导轨」一节）。 */}
      <nav className="zy-rail-nav" aria-label="主要页面">{primaryPages.map(item => <button
        key={item.id}
        className={`zy-rail-item${active === item.id ? ' is-active' : ''}`}
        aria-current={active === item.id ? 'page' : undefined}
        aria-label={item.label}
        title={item.label}
        onClick={() => controller.navigate(item.id)}
        {...tipProps(item.label)}
      ><Icon name={item.icon}/></button>)}
        <button
          type="button"
          className={`zy-rail-item zy-rail-more${menu?.kind === 'more' ? ' is-active' : ''}`}
          aria-label="更多页面"
          aria-expanded={menu?.kind === 'more'}
          aria-haspopup="menu"
          onClick={togglePanel('more', manageablePages.length)}
          {...tipProps('更多页面')}
        ><Icon name="moreHorizontal"/></button>
        {extraPages.length > 0 && <span className="zy-rail-divider" role="presentation"/>}
        {extraPages.map(item => <button
          key={item.id}
          className={`zy-rail-item${active === item.id ? ' is-active' : ''}`}
          aria-current={active === item.id ? 'page' : undefined}
          aria-label={item.label}
          title={item.label}
          onClick={() => controller.navigate(item.id)}
          {...tipProps(item.label)}
        ><Icon name={item.icon}/></button>)}
      </nav>
      <div className="zy-sidebar-bottom">
        {/* Native settings/footer slots remain owned by the native sidebar in ask. */}
        {/* 明暗开关原先在页头上，页头去掉后它是唯一入口，挪到这里 ——
            全局控件放在全局导航里。aria-label 保持「切换明暗」不变：
            已有脚本与肌肉记忆都按这个名字找它。 */}
        <button className="zy-rail-item" title="切换明暗" aria-label="切换明暗" onClick={controller.toggleTheme} {...tipProps('切换明暗')}><Icon name="moon"/></button>
        {/* 账号：**最下方**，圆形头像。
            它不是图标而是"人"—— 用头像既表明是谁，也把账号入口与功能图标分开；
            所以位置固定在最底，和最上面那排页面图标不是一组。
            它是**账号入口而不是页面**：点开浮出账号面板（登录 / 设置）。
            早先这里是一个叫「个人」的页，那一页删掉之后头像不再跳页 ——
            它承载的两块内容都进了原生设置（「账号与数据」分区）。 */}
        <button
          type="button"
          className={`zy-rail-avatar${menu?.kind === 'account' ? ' is-active' : ''}`}
          aria-label="账号"
          aria-expanded={menu?.kind === 'account'}
          aria-haspopup="menu"
          title="账号"
          onClick={togglePanel('account', 3)}
          {...tipProps('账号')}
        ><StudentAvatar size={18}/></button>
      </div>
    </aside>

    {/* 「···」菜单：只列**可管理的页**（即不在导轨上半组的那些）。
        导轨上半组是固定的、不可撤销 —— 所以它们既不出现在这里，也没有图钉可点。
        菜单里的一行 = 一个候选：点图钉固定到导轨（出现在分隔线下方），点名字跳过去。
        不固定的页仍然进得去（这里就是入口），不会因为不在导轨上就消失。 */}
    {menu?.kind === 'more' && <div className="zy-rail-menu" role="menu" aria-label="更多页面" style={{ top: `${menu.top}px`, left: `${menu.left}px` }}>
      {manageablePages.map(item => {
        const on = pinned.includes(item.id);
        return <div key={item.id} className={`zy-rail-menu-row${on ? ' is-pinned' : ''}${active === item.id ? ' is-current' : ''}`}>
          <button type="button" role="menuitem" tabIndex={-1} className="zy-rail-menu-open" onClick={() => { controller.navigate(item.id); setMenu(null); }}>
            <Icon name={item.icon} size={17}/>{item.label}
          </button>
          <button
            type="button"
            tabIndex={-1}
            className="zy-rail-menu-pin"
            aria-pressed={on}
            aria-label={`${on ? '取消固定' : '固定'}「${item.label}」`}
            title={on ? '取消固定（从导轨上收走）' : '固定到导轨'}
            onClick={() => togglePin(item.id)}
          ><Icon name="pin" size={15}/></button>
        </div>;
      })}
    </div>}

    {/* 账号面板：头像点开的那一层。
        结构照 ChatGPT 的账号菜单：先一行身份（头像 + 名字 + 一句说明），
        再「登录 / 设置」两行。设置打开的是**宿主原生浮窗**，「账号与数据」是它里面的一个分区。

        ⚠️ 身份那一行是**静态**的（「智云课堂 / 浙大统一身份认证」），不显示
        "已连接 · 某某"。壳没有账号状态可用：那属于领域（`zhiyunStudyController`），
        而壳刻意不认识领域包 —— 一旦读它，「停用学习核心」会连坐把导航也拖垮。
        真实状态在对话框里（那段内容由本工作台的账号包提供）。 */}
    {menu?.kind === 'account' && <div className="zy-rail-menu zy-account-menu" role="menu" aria-label="账号" style={{ top: `${menu.top}px`, left: `${menu.left}px` }}>
      <div className="zy-account-head">
        <span className="zy-account-face"><StudentAvatar size={20}/></span>
        <span className="zy-account-id"><strong>智云课堂</strong><small>浙大统一身份认证</small></span>
      </div>
      <span className="zy-account-divider" role="presentation"/>
      <div className="zy-rail-menu-row">
        <button type="button" role="menuitem" tabIndex={-1} className="zy-rail-menu-open zy-account-open" onClick={() => { setMenu(null); controller.openAccount(); }}>
          <Icon name="signIn" size={17}/>登录
          <Icon name="chevron" size={14}/>
        </button>
      </div>
      <div className="zy-rail-menu-row">
        <button type="button" role="menuitem" tabIndex={-1} className="zy-rail-menu-open" onClick={() => { setMenu(null); controller.openSettings(); }}>
          <Icon name="gear" size={17}/>设置
        </button>
      </div>
    </div>}

    {tip && <span className="zy-rail-tip" role="presentation" style={{ top: `${tip.top}px`, left: `${tip.left}px` }}>{tip.label}</span>}
    <SearchDialog controller={controller} open={searchOpen} onClose={() => setSearchOpen(false)} pages={pages}/>

    {/* 账号对话框。正文（表单本身）由 `sidebar.account.signin` 插槽提供：
        壳不认识智云课堂的账号协议，只负责"什么时候把它显示出来"。

        它就在 `.zy-sidebar` 里面，这不影响表单里的按钮：壳开头那条
        `.zy-sidebar button {background:transparent;…}` 重置是 `(0,1,1)`，
        而页面包按钮用的 `body[data-zhiyun] .zs-button/.zs-primary` 是 `(0,2,0)` ——
        重置根本压不过它（真要挪出去也行，但没必要）。
        `showModal()` 还把它送进 top layer，祖先的 `overflow:hidden` 也裁不到。 */}
    <dialog
      className="zy-account-dialog"
      ref={accountDialog}
      aria-label="登录智云课堂"
      onCancel={controller.closeAccount}
      onClose={controller.closeAccount}
    >
      <div className="zy-account-dialog-head">
        <strong>登录智云课堂</strong>
        <button type="button" className="zy-account-dialog-close" aria-label="关闭" onClick={controller.closeAccount}><Icon name="close" size={16}/></button>
      </div>
      <div className="zy-account-dialog-body">{renderSlot('sidebar.account.signin', {})}</div>
    </dialog>
  </div>;
}

/**
 * 原生设置面板的宿主。
 *
 * 设置**就是**宿主那个浮窗：`settings.section` / `settings.action` 全都是它的子槽位，
 * 浮窗本身由它自己 portal 到 `body`。这里只把它的 store 动作交给壳（导轨「设置」
 * 按钮与账号菜单都用同一个入口），**不复制任何分组或表单**，插件的
 * `settings.section` 注册零改动。
 */
export function NativeSettingsHost({ NativeSettings, onActions, ...props }) {
  const { actions } = props;
  useEffect(() => { onActions(actions); }, [actions, onActions]);
  return <NativeSettings {...props}/>;
}
export function Page({ page, controller, renderSlot }) {
  const item = NAV.find(item => item.id === page);
  // 页面内容由各自的页面包注册进 `zhiyun.<page>.content`。壳不认识它们，
  // 所以这里的 fallback 不是「页面」而是「这个页面包没装」的占位 ——
  // 壳在场时导航、主题都照常可用。
  const missing = () => <Empty title={`${item.label}暂时不可用`}>这个页面由独立的插件包提供，当前未启用。</Empty>;
  // 页面契约仍由壳定义：`controller`（导航/主题）与 `renderSlot`（渲染它自己的子插槽）
  // 作为 owner props 交给页面组件 —— owner props 在宿主渲染顺序里最后展开，
  // 页面不必知道这些服务从哪来。
  //
  // ⚠️ 这里**没有页头**。原先每条页面上方都有一条 69px 的横条，写着页面名、
  //    日期、明暗开关与「问一问」。它扛的四件事里两件是冗余的：
  //      · 页面名 —— 侧栏本来就列着同一个名字、并且高亮着当前页；
  //      · 「问一问」—— 侧栏本来就是一项，还多占一个按钮位。
  //    明暗开关是唯一入口，已挪到侧栏底部（与「收起导航」并列）；日期是环境信息，
  //    去掉。省下的 69px 每页都在，其中笔记页那一栏面板正好拿它换高度。
  //
  // 应用型页面（笔记页的编辑器）不套版心：980px 上限 + 文章式内边距会把
  // 多栏面板挤成一张小卡片。见 model.js 的 FULL_BLEED_PAGES。
  const contentClass = FULL_BLEED_PAGES.includes(page) ? 'zy-content zy-content-flush' : 'zy-content';
  // 二级入口（`parent`）与回程：都是 NAV 里的字段，不另立清单 ——
  // 「课堂 → 生成」是子页，子页在导轨与 Ctrl+K 里都不出现（`sidebar: false`），
  // 所以它的唯一入口是主线页里这一行按钮，回程也必须由这里给（否则只能靠导轨离开）。
  const children = NAV.filter(entry => entry.parent === page);
  const parent = item?.parent ? NAV.find(entry => entry.id === item.parent) : undefined;
  return <div className="zy-page" data-page={page}>
    {/* skip link 的落点（见 Sidebar 里那个 `#zy-main`）。
        `tabIndex={-1}` 不是为了进 Tab 序列，而是让锚点跳转能把焦点**移进**这个容器：
        不写的话浏览器只滚动、焦点还留在链接上，再按一次 Tab 又从头绕回导轨。
        `-1` 同时保证它自己不出现在 Tab 序列里 —— 跳过导航之后，下一个 Tab 应该落到
        正文里的第一个可聚焦元素，而不是又退回这里。
        id 不会重复：产品页面注册到 `zhiyun.shell.page`，桥接按 `entryKey` 只挂当前一页。 */}
    <main className="zy-scroll" id="zy-main" tabIndex={-1}><div className={contentClass}>
      {parent && <button type="button" className="zy-page-back" onClick={() => controller.navigate(parent.id)}><Icon name="arrowLeft" size={14}/>{parent.label}</button>}
      {children.length > 0 && <div className="zy-page-subnav" role="group" aria-label={`${item.label}的更多入口`}>
        {children.map(child => <button type="button" key={child.id} onClick={() => controller.navigate(child.id)}>{child.label}<Icon name="arrow" size={14}/></button>)}
      </div>}
      {renderSlot(pageSlot(item ?? { id: page }), { controller, renderSlot }, { fallback: React.createElement(missing) })}
    </div></main>
  </div>;
}
