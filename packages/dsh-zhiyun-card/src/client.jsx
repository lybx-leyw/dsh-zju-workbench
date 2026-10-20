// 「浙大一卡通」的设置分区（客户端半边）。
//
// # 它为什么在设置里，而不在某一页里
//
// 这份凭证是**智云课堂与学在浙大共用**的：进课堂上课要用它，看待办也要用它。
// 挂在任何一个页面上，都会让另一件事看起来"也得先去那一页登录一次"。设置是
// 两件不相关的事唯一的公共落点，所以它住在这里。
//
// 与 `dsh-zhiyun-card` 的宿主半边分工：**凭据只在宿主那边读写**（加密、不回显），
// 这个文件只负责把用户填的两个字段 POST 过去，再把它回的"已配置 / 未配置"画出来。
// 客户端一行持久化都不碰 —— 凭证不进任何浏览器侧的存储，配置页刷新一次就重新从
// 宿主读（见 `load` 那一段），所以"页面里能翻到上次的密码"这件事不可能发生。
//
// # 两个容易写错的地方
//
//   1. **不能包 `<details>` / `.zy-settings-group`。** 壳里的 `PersonalSettingsBridge`
//      已经为每个 `settings.section` 画好了外层折叠分组（图标 + 标题 + 副标题 + chevron），
//      再包一层就是"壳套壳"两个折叠框、两个标题。本组件直接返回 `<form>`。
//      参考 `dsh-zhiyun-page-paper/src/SettingsSection.jsx`。
//   2. **常量从 `./shared.js` 取，不从 `./index.js` 取。** 那个文件是宿主半边，
//      import 它会把 `apply` 与 `node:fs` 一起打进浏览器产物（见 `shared.js` 顶部）。
import React, { useCallback, useEffect, useState } from 'react';
import { Icon, Notice, mountStyle } from 'dsh-zhiyun-ui-primitives';
import css from './style.css';
import { MASK, ROUTE_PATH, WRITE_HEADER, errorText } from './shared.js';

export const name = 'zhiyun-card-client';

/** 只要插槽：这一块不依赖任何领域服务，凭据由宿主半边负责。 */
export const inject = ['slots'];

/**
 * 一次设置路由往返。
 *
 * 失败一律抛宿主给的原话：账号能不能含空格、密码长度上限这些规则的真源在宿主，
 * 页面自己再判一遍只会让"页面说能存"和"宿主拒绝"两句话对不上。
 * 拆 `error` 对象的活交给 `errorText`（`{ code, message }` 直接 `new Error` 会变成
 * `[object Object]`，用户看到的是一句没有任何信息量的话）。
 *
 * @param action - `''`（读取）/ `'save'` / `'clear'`。
 * @param body - POST 的请求体。
 * @returns 解析后的 JSON。
 */
async function settings(action = '', body) {
  const method = body ? 'POST' : 'GET';
  const response = await fetch(`${ROUTE_PATH}${action ? `?${action}` : ''}`, {
    method,
    headers: body ? { 'content-type': 'application/json', [WRITE_HEADER]: '1' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  // 宿主异常时可能回空 body（不是 JSON），别让 `response.json()` 的抛错盖住状态码
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(errorText(payload.error, response.status));
  return payload;
}

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunCardStyle', css, label: 'zhiyun: card settings styles' });

  // order 60：一卡通是**所有浙大数据的源头**（课堂、学在浙大待办都靠它），
  // 排在拼题A（65）与个人中转站（70）之前 —— 那两项各自是独立来源，缺了只影响一处。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'zhiyun-card',
    order: 60,
    // 用户明确要的完整写法（"一卡通只是简写"）。这句话也是规划页报错文案里的
    // 指路名，改名会让那条指引指向不存在的入口。
    label: () => '浙大一卡通',
  }, SettingsSection));
}

/**
 * 设置分区本体。
 *
 * 两块**独立**的凭据：浙大一卡通（统一身份认证）与 WebVPN 上网账号。
 * 它们共用同一套读写口径（保存 / 留空沿用 / 清除），所以由同一组状态驱动，
 * 只在提交时带上不同的动作名。
 *
 * 为什么必须分成两块显示而不是塞进一个表单：它们是**两套系统的两个密码**。
 * 合成一块，用户会以为"填一次就都有了"，然后在校外遇到登录失败时
 * 无从判断到底是哪一个不对。
 */
export function SettingsSection() {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ username: '', password: '' });
  // 两个按钮各有各的忙态：保存时不该把「清除」也灰掉（用户可能想改成空）
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  /**
   * WebVPN 那块的状态。与一卡通完全分开 —— 两套凭据、两个密码、两种失效原因。
   */
  const [vpnStatus, setVpnStatus] = useState(null);
  const [vpnForm, setVpnForm] = useState({ username: '', password: '' });
  const [vpnHasPassword, setVpnHasPassword] = useState(false);
  /**
   * 宿主那边是否已存着密码（决定提交时留空该翻成打码值还是报错）。
   *
   * ⚠️ 必须声明在 `applyCard` **之前**：那个 `useCallback` 的体里引用了
   *    `setHasPassword`，虽然只在调用时求值（不会真的踩 TDZ），但本仓有过
   *    "const 写在引用它的 useMemo 之后 → 首次渲染白屏"的先例
   *    （见 `dsh-zhiyun-page-planning/src/client.jsx` 里 `openTodos` 那段）。
   *    顺序写对是零成本的，不值得为它赌一次。
   */
  const [hasPassword, setHasPassword] = useState(false);

  /**
   * 把宿主回的 `card` 落到界面。
   *
   * ⚠️ **密码框永远从空开始，不预填打码值。** 宿主回的是 `********`（配过）或空串
   * （没配过），把它填进输入框看着很直观，但用户接着打字时新密码会被**追加**在
   * `********` 后面 —— 宿主收到「********新密码」，保存"成功"而登录必然失败
   * （除非再加"聚焦即全选"这类补丁，而那仍然会在没聚焦就粘贴时出错）。
   * 所以这里把"有一个密码"记在 `hasPassword` 上，输入框留空 + 文案说明，
   * 提交时空值就翻译成打码值 = 不改。这与论文页"密钥明文永不回传、留空即沿用"
   * 的语义是同一套。
   */
  const applyCard = useCallback((card) => {
    setStatus({ configured: Boolean(card?.configured), username: card?.username ?? '' });
    setForm({ username: card?.username ?? '', password: '' });
    setHasPassword(Boolean(card?.password));
  }, []);

  /** 同上，用于 WebVPN 那块。 */
  const applyVpn = useCallback((vpn) => {
    setVpnStatus({ configured: Boolean(vpn?.configured), username: vpn?.username ?? '' });
    setVpnForm({ username: vpn?.username ?? '', password: '' });
    setVpnHasPassword(Boolean(vpn?.password));
  }, []);

  useEffect(() => {
    // 组件卸载后再 setState 是 React 的常见告警来源；`live` 让迟到的那次直接作废。
    let live = true;
    settings('').then(
      (payload) => {
        if (!live) return;
        applyCard(payload.card);
        applyVpn(payload.webvpn);
      },
      (failure) => {
        if (!live) return;
        // 读不到**不等于**没配：状态条说"未配置"会让用户以为凭据丢了，去重填一遍。
        setStatus((current) => current ?? { configured: false, username: '' });
        setVpnStatus((current) => current ?? { configured: false, username: '' });
        setMessage({ kind: 'error', text: failure.message });
      },
    );
    return () => { live = false; };
  }, [applyCard, applyVpn]);

  /**
   * 保存一份凭据。
   *
   * @param kind - `'card'` 或 `'webvpn'`：决定打哪个动作名、读哪一份表单。
   */
  const saveOne = async (kind) => {
    const isVpn = kind === 'webvpn';
    const source = isVpn ? vpnForm : form;
    const hasSaved = isVpn ? vpnHasPassword : hasPassword;
    setBusy(isVpn ? 'vpn-save' : 'save');
    setMessage(null);
    try {
      const payload = await settings(isVpn ? 'webvpn-save' : 'save', {
        username: source.username,
        // 留空 = 沿用已存的密码。翻成打码值是宿主约定的"不改"表示法；没存过密码
        // 却传打码值，宿主会明确拒绝（"还没有保存过密码，请填写一次"），
        // 那句话比页面自己编一句更准确。
        password: source.password ? source.password : MASK,
      });
      if (isVpn) applyVpn(payload.webvpn); else applyCard(payload.card);
      setMessage({
        kind: 'ok',
        text: isVpn
          ? 'WebVPN 上网账号已保存。只有在校外访问学在浙大时才会用到它。'
          : '已保存。智云课堂与学在浙大都会用这一份凭证。',
      });
    } catch (failure) {
      setMessage({ kind: 'error', text: failure.message });
    } finally {
      setBusy(null);
    }
  };

  /** 清除一份凭据。 */
  const clearOne = async (kind) => {
    const isVpn = kind === 'webvpn';
    setBusy(isVpn ? 'vpn-clear' : 'clear');
    setMessage(null);
    try {
      const payload = await settings(isVpn ? 'webvpn-clear' : 'clear', {});
      if (isVpn) applyVpn(payload.webvpn); else applyCard(payload.card);
      setMessage({
        kind: 'ok',
        text: isVpn ? 'WebVPN 上网账号已清除。' : '已清除。两处都会退回"还没登录"的状态。',
      });
    } catch (failure) {
      setMessage({ kind: 'error', text: failure.message });
    } finally {
      setBusy(null);
    }
  };

  /** 能否保存一份凭据：填了新密码，或留空（= 沿用已存的）。 */
  const canSaveWith = (source, hasSaved) =>
    Boolean(source.username.trim()) && (Boolean(source.password) || hasSaved);

  const configured = Boolean(status?.configured);
  const working = busy !== null;
  /**
   * 能否保存。
   *
   * 两种合法输入：填了新密码，或者留空（= 沿用已存的）。所以"留空"只在**已存过密码**
   * 时才放行 —— 首次配置留空的话宿主一定拒（"还没有保存过密码，请填写一次"），
   * 而"点得下去、点了报错"比"点不下去 + 一句说明"更让人以为是自己填错了。
   * 其余规则（含空格、超长）仍由宿主判断，页面不重复实现一遍。
   */
  const canSave = canSaveWith(form, hasPassword) && !working;
  const canSaveVpn = canSaveWith(vpnForm, vpnHasPassword) && !working;

  return (
    <div className="zcd-form">
      <form className="zcd-block" onSubmit={(event) => { event.preventDefault(); void saveOne('card'); }}>
      {/* 说明文字写在最前：这一块唯一的"反直觉"之处是两处共用一份凭证，
          不说明的话用户会以为还要去课堂再登一次。 */}
      <p className="zcd-lead">
        这里是<strong>浙大统一身份认证</strong>的学号与密码（CAS 认的那一套）。
        填一次即可 —— <strong>智云课堂与学在浙大共用这一份凭证</strong>，不必分别填写。
      </p>

      <p className={`zcd-status ${configured ? 'zcd-status-ok' : ''}`} role="status" aria-live="polite">
        <span className="zcd-status-dot" aria-hidden="true" />
        {status === null
          ? '正在读取…'
          : configured
            ? `已配置 · ${status.username}`
            : '未配置'}
      </p>

      <label className="zcd-field">
        <span>账号</span>
        <input
          name="username"
          type="text"
          inputMode="text"
          autoComplete="username"
          spellCheck={false}
          maxLength={64}
          placeholder="统一身份认证账号"
          value={form.username}
          onChange={(event) => setForm({ ...form, username: event.target.value })}
          disabled={working}
          required
        />
        <small>学号本身不是秘密，所以它会回显出来 —— 用来确认配的是哪个账号。</small>
      </label>

      <label className="zcd-field">
        <span>密码</span>
        <input
          name="password"
          // type=password 只是**遮蔽**，不是加密；真正的加密与不回显由宿主凭据服务做
          type="password"
          autoComplete="new-password"
          placeholder={hasPassword ? '留空则沿用已存的密码' : '填一次密码'}
          value={form.password}
          onChange={(event) => setForm({ ...form, password: event.target.value })}
          disabled={working}
          aria-describedby="zcd-password-hint"
        />
        {/* 打码值**不预填进输入框**（见 `applyCard` 上的说明）：预填后接着打字会
            拼成「********新密码」，保存成功但登录必然失败。所以"有个密码"这件事
            由这一行文字说明，输入框保持干净。 */}
        <small id="zcd-password-hint">
          {hasPassword
            ? <>已存着密码，这里<strong>留空即沿用</strong>；要换密码直接重填。</>
            : <>还没有存过密码，这一项必填。</>}
          {' '}密码里的空格是密码的一部分，不会被裁掉。密码不会回传到这个页面。
        </small>
      </label>

      {/* 保存与清除分开：清除不可撤销（两处都会退回未登录），所以它靠后、样式也更淡，
          不与主按钮抢注意力。它只清账号密码，不碰任何课程数据。 */}
      <div className="zcd-foot">
        <button type="submit" className="zcd-btn zcd-btn-primary" disabled={!canSave}>
          <Icon name="check" size={15} />
          {busy === 'save' ? '正在保存…' : '保存'}
        </button>
        <button
          type="button"
          className="zcd-btn zcd-btn-quiet"
          onClick={() => void clearOne('card')}
          disabled={working || !configured}
          title={configured ? '清掉本机保存的账号密码' : '还没有可清除的凭证'}
        >
          {busy === 'clear' ? '正在清除…' : '清除'}
        </button>
      </div>
      </form>

      {/* ─────────────────────────────── WebVPN 上网账号 ───────────────────────────────
          单独一块，理由见组件顶部：这是**另一套系统的另一个密码**。
          默认收起（`<details>`）：在校内根本用不到，摊开会让这一页变长一半。 */}
      <details className="zcd-block zcd-vpn">
        <summary>
          <strong>WebVPN 上网账号</strong>
          <small>{vpnStatus === null
            ? '正在读取…'
            : vpnStatus.configured
              ? `已配置 · ${vpnStatus.username}`
              : '未配置（只在校外需要）'}</small>
        </summary>

        <p className="zcd-lead">
          在校外（不在校园网）访问学在浙大时，需要经过学校的 WebVPN 网关。
          网关认的是<strong>「上网账号」</strong>，它与上面的统一身份认证<strong>是两套系统</strong>：
          账号通常都是学号，但密码可能不一样。校内不需要填这一块。
        </p>

        <label className="zcd-field">
          <span>上网账号</span>
          <input
            type="text"
            autoComplete="username"
            spellCheck={false}
            maxLength={64}
            placeholder="上网账号（通常与学号相同）"
            value={vpnForm.username}
            onChange={(event) => setVpnForm({ ...vpnForm, username: event.target.value })}
            disabled={working}
          />
        </label>

        <label className="zcd-field">
          <span>上网密码</span>
          <input
            type="password"
            autoComplete="new-password"
            placeholder={vpnHasPassword ? '留空则沿用已存的密码' : '填一次上网密码'}
            value={vpnForm.password}
            onChange={(event) => setVpnForm({ ...vpnForm, password: event.target.value })}
            disabled={working}
          />
          <small>
            {vpnHasPassword
              ? <>已存着密码，<strong>留空即沿用</strong>。</>
              : <>还没存过上网密码。</>}
            {' '}不是统一身份认证的密码 —— 若不确定，先在浏览器登录一次 webvpn.zju.edu.cn 试试。
          </small>
        </label>

        <div className="zcd-foot">
          <button
            type="button"
            className="zcd-btn zcd-btn-primary"
            onClick={() => void saveOne('webvpn')}
            disabled={!canSaveVpn}
          >
            <Icon name="check" size={15} />
            {busy === 'vpn-save' ? '正在保存…' : '保存上网账号'}
          </button>
          <button
            type="button"
            className="zcd-btn zcd-btn-quiet"
            onClick={() => void clearOne('webvpn')}
            disabled={working || !vpnStatus?.configured}
            title={vpnStatus?.configured ? '清掉本机保存的上网账号' : '还没有可清除的凭证'}
          >
            {busy === 'vpn-clear' ? '正在清除…' : '清除'}
          </button>
        </div>
      </details>

      {message?.kind === 'error' && <Notice>{message.text}</Notice>}
      {message?.kind === 'ok' && <p className="zcd-msg" role="status">{message.text}</p>}
    </div>
  );
}
