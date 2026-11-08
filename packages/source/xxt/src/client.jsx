/**
 * 「学习通」设置分区。
 *
 * # 这里要填的是 Cookie，不是密码
 *
 * 学习通的登录要扫码或过滑块验证，脚本做不了。所以唯一可行的路径是
 * 「浏览器登录 → 复制 Cookie → 粘进来」。此前这条路径只有终端命令和
 * `CHAOXING_COOKIE` 环境变量入口 —— 用户在界面上找不到它。
 *
 * # 路由协议（照抄本包 `src/index.js` 的约定，别自创）
 *
 * ```text
 *   GET  /api/zhiyun-xxt                      → { ok, value: 能力描述 }
 *   POST /api/zhiyun-xxt
 *        { type:'client-request', rpcId, payload:{ method:'xxt.importCookie', args:{ input } } }
 * ```
 *
 * `importCookie` 的参数名是 **`input`**（不是 `cookie`）—— 见 `src/index.js` 的
 * `const input = typeof args?.input === 'string' ? args.input : ''`。
 * 写错参数名不会报错，只会得到「没有收到 Cookie 内容」，那种失败最难查。
 */

import React, { useEffect, useState } from 'react';
import {
  Actions,
  Card,
  Field,
  Intro,
  PageTitle,
  Rows,
  Section,
  SETTINGS_CSS,
  StatusLine,
  TextArea,
  mountStyle,
  registerText,
} from '@lybx-leyw/dsh-zju-ui-shared';

const ROUTE_PATH = '/api/zhiyun-xxt';
const NAMESPACE = 'zju-source-xxt';

export const name = 'zhiyun-source-xxt-client';

/** 只要插槽。 */
export const inject = ['slots', 'locale'];

export const TEXT = {
  zh: {
    section: '学习通',
    intro: '学习通的登录要扫码或过滑块验证，脚本无法自动完成，所以这里的 Cookie 只能手动粘贴一次，过期后再粘。',
    statusTitle: '状态',
    cookieTitle: '学习通 Cookie',
    cookieHint: '在浏览器登录 chaoxing.com，打开任一请求的开发者工具，复制整条 Cookie（或它的 cURL）粘贴到这里。登录要扫码或过滑块验证，脚本无法自动完成。',
    placeholder: '粘贴 Cookie 或 cURL …',
    save: '保存并验证',
    check: '检查登录态',
    saved: '已导入',
    saving: '导入中…',
    checking: '检查中…',
    credentialState: '凭据',
    credentialReady: '已导入',
    credentialMissing: '未导入',
    notChecked: '未检查',
    loginState: '登录状态',
    loggedIn: '已登录',
    loggedOut: '未登录',
    unknown: '未知',
    empty: '请先粘贴 Cookie',
    failed: '操作失败',
  },
  en: {
    section: 'XueXiTong',
    intro: 'chaoxing.com sign-in requires a QR code or slider captcha that a script cannot complete, so the cookie is pasted here by hand and pasted again once it expires.',
    statusTitle: 'Status',
    cookieTitle: 'XueXiTong cookie',
    cookieHint: 'Sign in to chaoxing.com in a browser, open any request in DevTools, and paste the whole Cookie header (or its cURL) here. Its sign-in requires a QR code or slider captcha, which a script cannot complete.',
    placeholder: 'Paste the cookie or cURL …',
    save: 'Save and verify',
    check: 'Check session',
    saved: 'Imported',
    saving: 'Importing…',
    checking: 'Checking…',
    credentialState: 'Credential',
    credentialReady: 'imported',
    credentialMissing: 'not imported',
    notChecked: 'not checked',
    loginState: 'Session',
    loggedIn: 'signed in',
    loggedOut: 'not signed in',
    unknown: 'unknown',
    empty: 'Paste a cookie first',
    failed: 'Failed',
  },
  ja: {
    section: '学習通',
    intro: 'chaoxing.com のサインインは QR コードまたはスライダー認証が必要で、スクリプトでは完了できません。そのため Cookie はここで一度手動で貼り付け、期限切れのたびに貼り直します。',
    statusTitle: '状態',
    cookieTitle: '学習通の Cookie',
    cookieHint: 'ブラウザで chaoxing.com にサインインし、いずれかのリクエストを開発者ツールで開き、Cookie ヘッダー全体（またはその cURL）をここに貼り付けてください。サインインには QR コードまたはスライダー認証が必要で、スクリプトでは完了できません。',
    placeholder: 'Cookie または cURL を貼り付け…',
    save: '保存して検証',
    check: 'セッションを確認',
    saved: 'インポートしました',
    saving: 'インポート中…',
    checking: '確認中…',
    credentialState: '認証情報',
    credentialReady: 'インポート済み',
    credentialMissing: '未インポート',
    notChecked: '未確認',
    loginState: 'セッション',
    loggedIn: 'サインイン済み',
    loggedOut: '未サインイン',
    unknown: '不明',
    empty: '先に Cookie を貼り付けてください',
    failed: '失敗',
  },
  es: {
    section: 'XueXiTong',
    intro: 'El inicio de sesión en chaoxing.com requiere un código QR o un captcha deslizante que un script no puede completar, así que la cookie se pega aquí a mano y se vuelve a pegar cuando caduca.',
    statusTitle: 'Estado',
    cookieTitle: 'Cookie de XueXiTong',
    cookieHint: 'Inicia sesión en chaoxing.com en un navegador, abre cualquier petición en las herramientas de desarrollo y pega aquí la cabecera Cookie completa (o su cURL). Su inicio de sesión requiere un código QR o un captcha deslizante, que un script no puede completar.',
    placeholder: 'Pega la cookie o el cURL …',
    save: 'Guardar y verificar',
    check: 'Comprobar sesión',
    saved: 'Importada',
    saving: 'Importando…',
    checking: 'Comprobando…',
    credentialState: 'Credencial',
    credentialReady: 'importada',
    credentialMissing: 'no importada',
    notChecked: 'sin comprobar',
    loginState: 'Sesión',
    loggedIn: 'sesión iniciada',
    loggedOut: 'sesión cerrada',
    unknown: 'desconocido',
    empty: 'Pega primero una cookie',
    failed: 'Fallo',
  },
  fr: {
    section: 'XueXiTong',
    intro: 'La connexion à chaoxing.com exige un QR code ou un captcha à glissière qu’un script ne peut pas résoudre : le cookie se colle donc ici à la main, puis de nouveau à son expiration.',
    statusTitle: 'État',
    cookieTitle: 'Cookie XueXiTong',
    cookieHint: 'Connectez-vous à chaoxing.com dans un navigateur, ouvrez n’importe quelle requête dans les outils de développement et collez ici l’en-tête Cookie complet (ou son cURL). Sa connexion exige un QR code ou un captcha à glissière, qu’un script ne peut pas résoudre.',
    placeholder: 'Collez le cookie ou le cURL …',
    save: 'Enregistrer et vérifier',
    check: 'Vérifier la session',
    saved: 'Importé',
    saving: 'Importation…',
    checking: 'Vérification…',
    credentialState: 'Identifiant',
    credentialReady: 'importé',
    credentialMissing: 'non importé',
    notChecked: 'non vérifié',
    loginState: 'Session',
    loggedIn: 'connecté',
    loggedOut: 'déconnecté',
    unknown: 'inconnu',
    empty: 'Collez d’abord un cookie',
    failed: 'Échec',
  },
  de: {
    section: 'XueXiTong',
    intro: 'Die Anmeldung bei chaoxing.com erfordert einen QR-Code oder ein Schieberegler-Captcha, das ein Skript nicht lösen kann. Das Cookie wird daher hier von Hand eingefügt und nach Ablauf erneut.',
    statusTitle: 'Status',
    cookieTitle: 'XueXiTong-Cookie',
    cookieHint: 'Melden Sie sich in einem Browser bei chaoxing.com an, öffnen Sie eine beliebige Anfrage in den Entwicklerwerkzeugen und fügen Sie den vollständigen Cookie-Header (oder dessen cURL) hier ein. Die Anmeldung erfordert einen QR-Code oder ein Schieberegler-Captcha, das ein Skript nicht lösen kann.',
    placeholder: 'Cookie oder cURL einfügen …',
    save: 'Speichern und prüfen',
    check: 'Sitzung prüfen',
    saved: 'Importiert',
    saving: 'Wird importiert…',
    checking: 'Wird geprüft…',
    credentialState: 'Zugangsdaten',
    credentialReady: 'importiert',
    credentialMissing: 'nicht importiert',
    notChecked: 'nicht geprüft',
    loginState: 'Sitzung',
    loggedIn: 'angemeldet',
    loggedOut: 'nicht angemeldet',
    unknown: 'unbekannt',
    empty: 'Zuerst ein Cookie einfügen',
    failed: 'Fehlgeschlagen',
  },
  ru: {
    section: 'XueXiTong',
    intro: 'Вход на chaoxing.com требует QR-кода или капчи-ползунка, которые скрипт пройти не может, поэтому cookie вставляется здесь вручную и повторно после истечения срока.',
    statusTitle: 'Состояние',
    cookieTitle: 'Cookie XueXiTong',
    cookieHint: 'Войдите на chaoxing.com в браузере, откройте любой запрос в инструментах разработчика и вставьте сюда полный заголовок Cookie (или его cURL). Вход требует QR-кода или капчи-ползунка, которые скрипт пройти не может.',
    placeholder: 'Вставьте cookie или cURL …',
    save: 'Сохранить и проверить',
    check: 'Проверить сессию',
    saved: 'Импортировано',
    saving: 'Импорт…',
    checking: 'Проверка…',
    credentialState: 'Учётные данные',
    credentialReady: 'импортированы',
    credentialMissing: 'не импортированы',
    notChecked: 'не проверено',
    loginState: 'Сессия',
    loggedIn: 'вход выполнен',
    loggedOut: 'вход не выполнен',
    unknown: 'неизвестно',
    empty: 'Сначала вставьте cookie',
    failed: 'Ошибка',
  },
  pt: {
    section: 'XueXiTong',
    intro: 'O início de sessão em chaoxing.com exige um código QR ou um captcha deslizante que um script não consegue concluir, por isso o cookie é colado aqui à mão e novamente quando expira.',
    statusTitle: 'Estado',
    cookieTitle: 'Cookie do XueXiTong',
    cookieHint: 'Inicia sessão em chaoxing.com num navegador, abre qualquer pedido nas ferramentas de programador e cola aqui o cabeçalho Cookie completo (ou o seu cURL). O início de sessão exige um código QR ou um captcha deslizante, que um script não consegue concluir.',
    placeholder: 'Cola o cookie ou o cURL …',
    save: 'Guardar e verificar',
    check: 'Verificar sessão',
    saved: 'Importado',
    saving: 'A importar…',
    checking: 'A verificar…',
    credentialState: 'Credencial',
    credentialReady: 'importada',
    credentialMissing: 'não importada',
    notChecked: 'não verificada',
    loginState: 'Sessão',
    loggedIn: 'sessão iniciada',
    loggedOut: 'sessão terminada',
    unknown: 'desconhecido',
    empty: 'Cola primeiro um cookie',
    failed: 'Falhou',
  },
};

/** 递增的 rpcId：服务端会把它回显到错误里，便于对日志。 */
let rpcSeq = 0;

/**
 * 按本包约定发一条 client-request。
 *
 * @param method - `xxt.` 之后的方法名。
 * @param args - 动作参数。
 * @returns 服务端回的 `value`。
 */
async function rpc(method, args = {}) {
  rpcSeq += 1;
  const response = await fetch(ROUTE_PATH, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: `xxt-settings-${rpcSeq}`,
      payload: { method: `xxt.${method}`, args },
    }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error?.message ?? payload?.error ?? `HTTP ${response.status}`);
  }
  return payload?.value ?? payload;
}

export function SettingsSection({ t }) {
  const [cookie, setCookie] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  const refresh = async () => {
    try {
      const response = await fetch(ROUTE_PATH, { headers: { Accept: 'application/json' } });
      const payload = await response.json().catch(() => ({}));
      setStatus(payload?.value ?? payload);
    } catch { /* 保持上一份结论 */ }
  };

  useEffect(() => { void refresh(); }, []);

  const importCookie = async () => {
    if (cookie.trim().length === 0) { setMessage({ tone: 'bad', text: t('empty') }); return; }
    setBusy('save');
    setMessage(null);
    try {
      await rpc('importCookie', { input: cookie });
      setCookie('');
      setMessage({ tone: 'ok', text: t('saved') });
      await refresh();
    } catch (error) {
      setMessage({ tone: 'bad', text: `${t('failed')}: ${error.message}` });
    } finally { setBusy(null); }
  };

  const check = async () => {
    setBusy('check');
    try {
      const result = await rpc('checkLogin');
      // 把结果**留住**：原来这里丢掉返回值，再 refresh 又读回不含登录信息的描述，
      // 于是按钮点了界面上什么都不会变。
      setProbe(result?.authenticated === true
        ? { authenticated: true }
        : { authenticated: false, reason: result?.reason ?? null });
      await refresh();
    } catch (error) {
      setProbe({ authenticated: false, reason: String(error?.message ?? error) });
    } finally { setBusy(null); }
  };

  /**
   * `checkLogin()` 的**上一次结果**。
   *
   * 只由「检查登录态」按钮写入 —— `refresh()` 不该覆盖它：GET 返回的
   * `state` 只说明「Cookie 有没有导入」，不代表「还能不能用」。
   * 把两者混成一个字段正是原来那个 bug 的来源。
   *
   * `null` = 还没检查过（显示「未检查」），不是「未登录」。
   */
  const [probe, setProbe] = useState(null);
  /** Cookie 是否已导入（来自 GET 的 `state.configured`）。 */
  const configured = status?.state?.configured === true;

  // 结构与其余三个分区一致：Section(gap 12) → 标题 → 说明 → 卡片列表。
  // 之前是 Field + Actions 直接铺在页面上，同一个浮窗里两种设计语言并存。
  return React.createElement(Section, null,
    React.createElement(PageTitle, null, t('section')),
    React.createElement(Intro, null, t('intro')),
    React.createElement(Rows, null,
      // 卡片一：凭据（可展开，含 Cookie 输入与两个操作）。
      React.createElement(Card, {
        title: t('cookieTitle'),
        actions: React.createElement(Actions, null,
          React.createElement('button', { type: 'button', 'data-primary': '', disabled: busy !== null, onClick: importCookie },
            busy === 'save' ? t('saving') : t('save')),
          React.createElement('button', { type: 'button', disabled: busy !== null, onClick: check },
            busy === 'check' ? t('checking') : t('check'))),
      },
        React.createElement(TextArea, {
          value: cookie,
          onChange: setCookie,
          placeholder: t('placeholder'),
          ariaLabel: t('cookieTitle'),
          rows: 3,
        }),
        React.createElement('span', { className: 'zju-setting-hint' }, t('cookieHint')),
        message ? React.createElement('span', {
          className: 'zju-setting-hint',
          role: 'status',
          style: { color: message.tone === 'bad' ? '#e06c6c' : '#4caf7d' },
        }, message.text) : null),
      // 卡片二：状态。纯状态卡默认收起，与统一身份认证那边同一套约定。
      React.createElement(Card, {
        title: t('statusTitle'),
        defaultOpen: false,
      },
        // 第一行：Cookie 有没有导入。不发网络请求，反映「有没有」。
        React.createElement(StatusLine, {
          label: t('credentialState'),
          value: configured ? t('credentialReady') : t('credentialMissing'),
          tone: configured ? 'ok' : 'warn',
        }),
        // 第二行：真正的登录态，只由「检查登录态」写入。
        React.createElement(StatusLine, {
          label: t('loginState'),
          value: probe === null
            ? t('notChecked')
            : probe.authenticated === true ? t('loggedIn') : t('loggedOut'),
          tone: probe === null ? 'plain' : probe.authenticated === true ? 'ok' : 'warn',
        }))),
  );
}

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zjuXxtSettingsStyle', css: SETTINGS_CSS, label: 'zju: xxt settings styles' });
  const text = registerText(ctx, NAMESPACE, TEXT);
  ctx.effect(() => () => text.dispose(), 'zju: xxt settings i18n');
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'zju-source-xxt',
    order: 58,
    label: () => text.t('section'),
  }, () => React.createElement(SettingsSection, { t: text.t })));
}
