import React, { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { Empty, Icon, Mark, StudentAvatar, useStore } from 'dsh-zhiyun-shell-ui';
import { NAV, FULL_BLEED_PAGES, RAIL_DEFAULT, RAIL_ACCOUNT, activePage, matchingPages, visiblePages } from './model.js';

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
      // 上半组与「个人」（头像那一格）都不参与固定/取消固定，一并滤掉。
      return parsed.filter((id) => !RAIL_DEFAULT.includes(id) && id !== RAIL_ACCOUNT);
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

export function Sidebar({ collapsed, controller, renderSlot, usePanelInfo, hidden, account }) {
  const active = activePage(usePanelInfo(info => info.activePanelId));
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
  const pages = visiblePages(useStore(hidden));
  useEffect(() => {
    function key(event) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setSearchOpen(value => !value); }
    }
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, []);

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
  const manageablePages = pages.filter((page) => !RAIL_DEFAULT.includes(page.id) && page.id !== RAIL_ACCOUNT);
  /** 头像那一格对应的页（被取消时不显示）。 */
  const accountPage = pages.find((page) => page.id === RAIL_ACCOUNT) ?? null;

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
        {/* ⚠️ 类名保持 `zy-settings-host`：样式表里有一条 `.zy-settings-host{display:none}`
            刻意把**原生**设置面板藏在侧栏（可见的设置面归「个人」页）。
            这里换个名字就会让它重新露出来。 */}
        <div className="zy-settings-host">{renderSlot('sidebar.settings', { wide: false })}</div>
        {/* 扩展入口（`sidebar.footer.action`）保留挂载点：仓库里现在没有包注册它，
            渲染出来是空的；留着是为了将来有人注册时不至于**静默**丢掉。 */}
        <div className="zy-rail-actions">{renderSlot('sidebar.footer.action', { wide: false })}</div>
        {/* 明暗开关原先在页头上，页头去掉后它是唯一入口，挪到这里 ——
            全局控件放在全局导航里。aria-label 保持「切换明暗」不变：
            已有脚本与肌肉记忆都按这个名字找它。 */}
        <button className="zy-rail-item" title="切换明暗" aria-label="切换明暗" onClick={controller.toggleTheme} {...tipProps('切换明暗')}><Icon name="moon"/></button>
        {/* 个人：**最下方**，圆形头像。
            它不是图标而是"人"—— 用头像既表明是谁，也把账号入口与功能图标分开；
            所以位置固定在最底，和最上面那排页面图标不是一组。
            点它是**浮出账号面板**（登录 / 设置），不再直接跳页：个人页是设置面，
            而这里最常用的动作是登录，先问一句更省事。停在个人页时头像仍高亮。 */}
        {accountPage && <button
          type="button"
          className={`zy-rail-avatar${menu?.kind === 'account' || active === accountPage.id ? ' is-active' : ''}`}
          aria-label="账号"
          aria-expanded={menu?.kind === 'account'}
          aria-haspopup="menu"
          title="账号"
          onClick={togglePanel('account', 4)}
          {...tipProps('账号')}
        ><StudentAvatar size={18}/></button>}
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
        再一行「登录」开对话框、一行「设置」进个人页。

        ⚠️ 身份那一行是**静态**的（「智云课堂 / 浙大统一身份认证」），不显示
        "已连接 · 某某"。壳没有账号状态可用：那属于领域（`zhiyunStudyController`），
        而壳刻意不认识领域包 —— 一旦读它，「停用学习核心」会连坐把导航也拖垮。
        真实状态在对话框里（那段内容由页面包提供，它本来就拿着领域控制器）。 */}
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
        <button type="button" role="menuitem" tabIndex={-1} className="zy-rail-menu-open" onClick={() => { setMenu(null); controller.navigate('me'); }}>
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

/** Keep the native shell alive for onboarding, recovery and shortcuts; its
 * section renderers move into Personal without copying their forms or data. */
export function PersonalSettingsBridge(props) {
  const { NativeSettings, useSections, renderSlot, actions, controller } = props;
  const sections = useSections(rows => rows);
  const shell = props.useStore(state => state);
  const [target, setTarget] = useState(null);
  useEffect(() => {
    const find = () => setTarget(document.getElementById('zy-personal-settings'));
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (!shell.open) return;
    controller.navigate('me');
    actions.close();
  }, [shell.open, controller, actions]);
  return <><NativeSettings {...props}/>{target && createPortal(<div className="zy-settings-groups">{sections.map(section => <details className="zy-settings-group" key={section.id} data-settings-section={section.id}>
    <summary><span className="zy-settings-icon"><Icon name={/model|provider|agent/.test(section.id) ? 'chat' : /permission/.test(section.id) ? 'check' : /plugin|module/.test(section.id) ? 'layers' : 'user'}/></span><span><strong>{section.id === 'models' ? 'AI 服务' : section.id === 'plugins' ? '功能与插件' : section.id === 'agent-presets' ? 'AI 使用偏好' : section.label}</strong><small>{/model|provider/.test(section.id) ? '配置问一问使用的 AI 服务' : /permission/.test(section.id) ? '管理 AI 可以执行的操作' : /plugin|module/.test(section.id) ? '管理学习空间的扩展能力' : /agent/.test(section.id) ? '选择模型、工具与权限的组合' : '调整应用与使用偏好'}</small></span><Icon name="chevron" size={16}/></summary>
    <div className="zy-settings-body">{renderSlot('settings.section', { close: actions.close }, { only: section.id })}{section.id === 'general' && <div className="zy-settings-document">{renderSlot('settings.action', {})}</div>}</div>
  </details>)}</div>, target)}</>;
}
export function Page({ page, controller, renderSlot }) {
  const item = NAV.find(item => item.id === page);
  // 页面内容由各自的页面包注册进 `zhiyun.<page>.content`。壳不认识它们，
  // 所以这里的 fallback 不是「页面」而是「这个页面包没装」的占位 ——
  // 壳在场时导航、主题都照常可用。
  const missing = () => <Empty title={`${item.label}暂时不可用`}>这个页面由独立的插件包提供，当前未启用。</Empty>;
  // 页面契约仍由壳定义：`controller`（导航/主题）与 `renderSlot`（渲染它自己的子插槽，
  // 比如个人页里的 `zhiyun.me.account`）作为 owner props 交给页面组件 ——
  // owner props 在宿主渲染顺序里最后展开，页面不必知道这些服务从哪来。
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
  return <div className="zy-page" data-page={page}>
    {/* skip link 的落点（见 Sidebar 里那个 `#zy-main`）。
        `tabIndex={-1}` 不是为了进 Tab 序列，而是让锚点跳转能把焦点**移进**这个容器：
        不写的话浏览器只滚动、焦点还留在链接上，再按一次 Tab 又从头绕回导轨。
        `-1` 同时保证它自己不出现在 Tab 序列里 —— 跳过导航之后，下一个 Tab 应该落到
        正文里的第一个可聚焦元素，而不是又退回这里。
        id 不会重复：七个页面各注册一个 `main` 面板，宿主按 `entryKey` 只挂当前那一个
        （见 client.jsx 的 `ctx.slots.register({ name: 'main', key: … })`）。 */}
    <main className="zy-scroll" id="zy-main" tabIndex={-1}><div className={contentClass}>{renderSlot(`zhiyun.${page}.content`, { controller, renderSlot }, { fallback: React.createElement(missing) })}</div></main>
  </div>;
}

/**
 * 「问一问」面板的盒子：侧栏右边那一列（宿主的中间栏）。
 * 汉堡和抽屉都锚在它的左上角，而不是视口的左上角 —— Windows 标题栏会把这一列往下推，
 * 锚在视口上按钮就会漂进标题栏。
 */
function useAskPanelBox() {
  const [box, setBox] = useState({ left: 0, top: 0, width: 0, height: 0, radius: '0px' });
  useLayoutEffect(() => {
    const measure = () => {
      const sidebar = document.querySelector('.zy-sidebar');
      // 侧栏根节点外面可能还有插槽包一层。顺着父级走到网格那一格，它的下一个兄弟才是问一问所在的中间栏。
      let column = sidebar;
      while (column?.parentElement && getComputedStyle(column.parentElement).display !== 'grid') column = column.parentElement;
      const panel = column?.nextElementSibling ?? sidebar?.parentElement?.nextElementSibling;
      if (!(panel instanceof HTMLElement)) {
        const edge = sidebar ? Math.round(sidebar.getBoundingClientRect().right) : 0;
        setBox({ left: edge, top: 0, width: Math.max(0, window.innerWidth - edge), height: window.innerHeight, radius: '0px' });
        return;
      }
      const rect = panel.getBoundingClientRect();
      setBox({
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        radius: getComputedStyle(panel).borderTopLeftRadius || '0px',
      });
    };
    measure();
    const sidebar = document.querySelector('.zy-sidebar');
    let column = sidebar;
    while (column?.parentElement && getComputedStyle(column.parentElement).display !== 'grid') column = column.parentElement;
    const panel = column?.nextElementSibling;
    const observer = new ResizeObserver(measure);
    if (sidebar) observer.observe(sidebar);
    if (column instanceof HTMLElement && column !== sidebar) observer.observe(column);
    if (panel instanceof HTMLElement) observer.observe(panel);
    window.addEventListener('resize', measure);
    return () => { observer.disconnect(); window.removeEventListener('resize', measure); };
  }, []);
  return box;
}

/** 当前会话：0.2 里「主面板在看哪个会话」由 uiWorkspace.selection 持久化。 */
function useCurrentSession(uiWorkspace, sessions) {
  const sessionId = useSyncExternalStore(
    listener => uiWorkspace.selection?.subscribe(listener) ?? (() => {}),
    () => uiWorkspace.selection?.getSnapshot?.()?.sessionId,
    () => undefined,
  );
  const sessionList = useStore(sessions.list);
  const summary = sessionId === undefined ? undefined : sessionList.byId?.[sessionId];
  return { sessionId, title: summary === undefined || summary.blank === true ? '' : (summary.displayTitle ?? '') };
}

/**
 * 问一问会话头的 leading：跟会话名排在同一行，标题在它右边，不再盖住名字。
 * 挂在宿主的 `conversation.header.leading`（这一列在会话名之前，问一问才挂载）。
 */
export function AskMenuButton({ drawer }) {
  const open = useSyncExternalStore(drawer.subscribe, drawer.getSnapshot, drawer.getSnapshot);
  return <button type="button" className="zy-topbar zy-topbar-menu" aria-expanded={open} aria-controls="zy-session-drawer" aria-label="会话" title="会话" onClick={() => drawer.toggle()}><span className="zy-topbar-glyph"><Icon name="menu" size={18}/></span></button>;
}

/**
 * 会话抽屉挂在 `shell.overlay`，只在问一问显示。开关是会话头里的 {@link AskMenuButton}。
 */
export function AskChrome({ drawer, sessions, workspaces, uiWorkspace, usePanelInfo, getLearningSpace }) {
  const active = activePage(usePanelInfo(info => info.activePanelId));
  const box = useAskPanelBox();
  const open = useSyncExternalStore(drawer.subscribe, drawer.getSnapshot, drawer.getSnapshot);
  if (active !== 'ask') return null;
  return <SessionDrawer open={open} box={box} drawer={drawer} sessions={sessions} workspaces={workspaces} uiWorkspace={uiWorkspace} getLearningSpace={getLearningSpace}/>;
}

/**
 * 会话抽屉：贴着问一问面板的左缘，拉出这一列的整高。
 *
 * 顶栏是「会话」和新建。遮罩只盖这一列，滑出动画也被这一列裁住，不会扫过导航栏。
 * 开关不浮在这一层上：它在会话头的 leading 里，和会话名并排。
 *
 * 说明位置放的是相对时间而不是「N 条消息」（宿主的列表投影没有条数）。
 * 菜单是「归档」：宿主没有删除接口，归档会把这条从列表里拿掉（登记槽还在，设置里可以恢复）。
 * 正在看的那条被归档后，不要马上再开一条空白会话，否则只是历史没了、壳还在。
 */
export function SessionDrawer({ open, box, sessions, workspaces, uiWorkspace, drawer, getLearningSpace }) {
  const [menu, setMenu] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const drawerRef = useRef(null);
  const sessionList = useStore(sessions.list);
  const workspaceList = useStore(workspaces.list);
  const { sessionId } = useCurrentSession(uiWorkspace, sessions);
  useEffect(() => {
    if (!open) { setMenu(null); setRenaming(null); setError(''); return; }
    const onKey = event => { if (event.key === 'Escape') { if (menu) setMenu(null); else drawer.close(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, menu, drawer]);
  useEffect(() => {
    if (!menu) return;
    const onPointer = event => {
      const target = event.target;
      if (target instanceof Element && target.closest('.zy-drawer-menu, .zy-drawer-more')) return;
      setMenu(null);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [menu]);
  // 所有 hook 都在此之上；下面只做纯计算，早期 return 不再改变 hook 数量。
  // 「哪个工作区是这个学习空间」由领域状态包（dsh-zhiyun-core-study）回答：
  // 它没有激活时这里拿不到服务，抽屉就只显示空列表 —— 导航与页面都还在。
  const learningSpace = getLearningSpace?.();
  const space = learningSpace?.pickLearningWorkspace(workspaceList.items, learningSpace.title);
  if (space === undefined || box.height === 0) return null;
  const rows = learningSpace.sessionRows(space, sessionList, 60, workspaceList.archivedSessionIds);
  const menuRow = menu === null ? undefined : rows.find(row => row.id === menu.id);
  const startNew = () => { setError(''); drawer.close(); uiWorkspace.startSession(space.workspaceId); };
  const openSession = id => { setError(''); drawer.close(); uiWorkspace.openSession(id); };
  const archiveRow = id => {
    setMenu(null);
    const current = String(id) === String(sessionId);
    if (current) drawer.holdEmptySession();
    Promise.resolve(uiWorkspace.archiveSession(id)).catch(() => {
      if (current) drawer.releaseEmptySession();
      setError('归档失败');
    });
  };
  const commitRename = async id => {
    const title = draft.trim();
    setRenaming(null);
    const binding = sessions.binding(id);
    if (binding === undefined || title === '') return;
    const result = await binding.session.rename(title);
    if (result !== undefined && result.ok === false) setError(result.error?.message ?? '重命名失败');
  };
  const toggleMenu = (event, id) => {
    if (menu?.id === id) { setMenu(null); return; }
    const button = event.currentTarget.getBoundingClientRect();
    const host = drawerRef.current?.getBoundingClientRect();
    if (!host) return;
    const width = 148;
    const height = 84;
    const top = host.bottom - button.bottom < height + 8 ? button.top - host.top - height - 4 : button.bottom - host.top + 4;
    const left = Math.min(Math.max(8, button.right - host.left - width), Math.max(8, host.width - width - 8));
    setMenu({ id, top, left });
  };
  return <div className="zy-drawer-layer" data-open={open} style={{ left: box.left, top: box.top, width: box.width, height: box.height, borderTopLeftRadius: box.radius }}>
    <div className="zy-drawer-scrim" data-open={open} onClick={() => drawer.close()}/>
    <aside className="zy-drawer" id="zy-session-drawer" ref={drawerRef} data-open={open} aria-hidden={!open} aria-label="会话">
      <header className="zy-drawer-head">
        <strong>会话</strong>
        <button className="zy-drawer-add" title="新建会话" aria-label="新建会话" onClick={startNew}><Icon name="plus" size={18}/></button>
      </header>
      <div className="zy-drawer-list" role="list" onScroll={() => setMenu(null)}>
        {error && <p className="zy-drawer-error" role="alert">{error}</p>}
        {rows.length === 0 && <div className="zy-drawer-empty"><Icon name="chat" size={22}/><p>还没有会话</p></div>}
        {rows.map(row => <div key={row.id} role="listitem" className={`zy-drawer-row${String(row.id) === String(sessionId) ? ' is-current' : ''}`}>
          {renaming === row.id
            ? <input className="zy-drawer-input" autoFocus aria-label="会话名称" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') commitRename(row.id); if (event.key === 'Escape') setRenaming(null); }} onBlur={() => commitRename(row.id)}/>
            : <button className="zy-drawer-open" title={row.title || '新会话'} onClick={() => openSession(row.id)}>
                <Icon name="chat" size={18}/>
                <span className="zy-drawer-text">
                  <span className={`zy-drawer-name${row.title ? '' : ' is-blank'}`}>{row.title || '新会话'}</span>
                  <small className="zy-drawer-meta">{learningSpace.relativeLabel(row.updatedAt) || '暂无消息'}</small>
                </span>
              </button>}
          <button className="zy-drawer-more" type="button" aria-expanded={menu?.id === row.id} aria-haspopup="menu" title="更多" aria-label="更多操作" onClick={event => toggleMenu(event, row.id)}><Icon name="more" size={16}/></button>
        </div>)}
      </div>
      {menuRow && <div className="zy-drawer-menu" style={{ top: menu.top, left: menu.left }} role="menu">
        {sessions.binding(menuRow.id) !== undefined && <button type="button" role="menuitem" onClick={() => { setMenu(null); setRenaming(menuRow.id); setDraft(menuRow.title); }}>重命名</button>}
        <button type="button" role="menuitem" className="is-danger" onClick={() => archiveRow(menuRow.id)}>归档</button>
      </div>}
    </aside>
  </div>;
}


