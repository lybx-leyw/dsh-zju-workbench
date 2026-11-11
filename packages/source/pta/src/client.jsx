/**
 * 「拼题A」设置分区。
 *
 * # 为什么这个分区属于 `source/pta`，而不是原来的 `source/campus`
 *
 * **设置分区跟着凭证走。** 拼题A 有自己的凭证（Cookie，且只能手动粘贴），
 * 所以它该有自己的分区；而学在浙大走 CAS、账号来自「浙大一卡通」
 * （`dsh-zju-source-login`），不需要也不该在这里重复问。
 *
 * 拆包前这两件事装在一个 `campus` 包里，于是「拼题A」这个分区名下面
 * 其实还有一个跟它无关的学在浙大。拆开之后一个包一件事，分区也就对上了。
 *
 * # 这个分区只做一件事：拼题A 的 Cookie
 *
 * 它的登录要过短信验证，脚本无法自动完成，只能「浏览器登录 → 复制 Cookie →
 * 粘进来」。此前这条路只有终端命令和 `PTA_COOKIE` 环境变量两个入口，
 * 用户在界面上找不到它 —— 这个分区就是那个入口。
 *
 * # 路由
 *
 * `POST /api/zhiyun-pta?cookie`（需 `x-zhiyun-pta: 1` 头）。
 *
 * # 为什么这一页没有「出口状态」
 *
 * 拆包前 campus 那版这里还有一行「出口：校内直连 / 校外」。那是
 * `zhiyunEgress`（tier 0）的事实，而拼题A 是**公网站**
 * （`hosts.js` 把它归 `PUBLIC_HOSTS`），本来就不该被网关改写。
 * 把无关读数摆进这一页，用户会以为「出口错了」是 Cookie 失效的原因。
 * 需要看出口状态时去「浙大统一身份认证」分区，那里才是它该在的地方。
 */

import React, { useEffect, useState } from 'react';
import {
  Actions,
  Card,
  Intro,
  PageTitle,
  Rows,
  SETTINGS_CSS,
  Section,
  StatusLine,
  TextArea,
  mountStyle,
  registerText,
} from '@lybx-leyw/dsh-zju-ui-shared';

/** 与本包 `index.js` 的 `ROUTE_PATH` 一致。 */
const ROUTE_PATH = '/api/zhiyun-pta';
/** 写操作必须带的自定义头（服务端用它挡 CSRF）。 */
const WRITE_HEADER = 'x-zhiyun-pta';
/** i18n namespace。**一包一个**，重复注册同名同语言会抛错。 */
const NAMESPACE = 'zju-source-pta';

export const name = 'zhiyun-source-pta-client';

/** 只要插槽：设置分区不依赖任何领域服务。 */
export const inject = ['slots', 'locale'];

/** 双语字典。键名与组件里 `t('…')` 一一对应。 */
export const TEXT = {
  zh: {
    section: '拼题A',
    intro: '拼题A（pintia.cn）的登录需要短信验证码，脚本无法自动完成，所以这里的 Cookie 只能手动粘贴一次，过期后再粘。',
    ptaTitle: '拼题A Cookie',
    ptaHint: '在浏览器登录 pintia.cn，打开任一请求的开发者工具，复制整条 Cookie（或它的 cURL）粘贴到这里。它的登录要过短信验证，脚本无法自动完成，所以只能手动粘一次；过期后再粘。',
    ptaPlaceholder: '粘贴 Cookie 或 cURL …',
    save: '保存',
    clear: '清除',
    saved: '已保存',
    cleared: '已清除',
    saving: '保存中…',
    statusTitle: '当前状态',
    ptaState: '拼题A',
    configured: '已配置',
    missing: '未配置',
    unknown: '未知',
    emptyCookie: '请先粘贴 Cookie',
    failed: '操作失败',
  },
  en: {
    section: 'PTA',
    intro: 'pintia.cn sign-in requires an SMS code that a script cannot complete, so the cookie is pasted here by hand and pasted again once it expires.',
    ptaTitle: 'PTA cookie',
    ptaHint: 'Sign in to pintia.cn in a browser, open any request in DevTools, and paste the whole Cookie header (or its cURL) here. Its sign-in needs an SMS code, which a script cannot complete — so it is a manual paste, repeated when it expires.',
    ptaPlaceholder: 'Paste the cookie or cURL …',
    save: 'Save',
    clear: 'Clear',
    saved: 'Saved',
    cleared: 'Cleared',
    saving: 'Saving…',
    statusTitle: 'Status',
    ptaState: 'PTA',
    configured: 'configured',
    missing: 'not configured',
    unknown: 'unknown',
    emptyCookie: 'Paste a cookie first',
    failed: 'Failed',
  },
  ja: {
    section: 'PTA',
    intro: 'pintia.cn のサインインは SMS コードが必要で、スクリプトでは完了できません。そのため Cookie はここで手動で貼り付け、期限切れのたびに貼り直します。',
    ptaTitle: 'PTA の Cookie',
    ptaHint: 'ブラウザで pintia.cn にサインインし、いずれかのリクエストを開発者ツールで開き、Cookie ヘッダー全体（またはその cURL）をここに貼り付けてください。サインインには SMS コードが必要で、スクリプトでは完了できません。',
    ptaPlaceholder: 'Cookie または cURL を貼り付け…',
    save: '保存',
    clear: '消去',
    saved: '保存しました',
    cleared: '消去しました',
    saving: '保存中…',
    statusTitle: '状態',
    ptaState: 'PTA',
    configured: '設定済み',
    missing: '未設定',
    unknown: '不明',
    emptyCookie: '先に Cookie を貼り付けてください',
    failed: '失敗',
  },
  es: {
    section: 'PTA',
    intro: 'El inicio de sesión en pintia.cn requiere un código SMS que un script no puede completar, así que la cookie se pega aquí a mano y se vuelve a pegar cuando caduca.',
    ptaTitle: 'Cookie de PTA',
    ptaHint: 'Inicia sesión en pintia.cn en un navegador, abre cualquier petición en las herramientas de desarrollo y pega aquí la cabecera Cookie completa (o su cURL). Su inicio de sesión requiere un código SMS, que un script no puede completar.',
    ptaPlaceholder: 'Pega la cookie o el cURL …',
    save: 'Guardar',
    clear: 'Borrar',
    saved: 'Guardada',
    cleared: 'Borrada',
    saving: 'Guardando…',
    statusTitle: 'Estado',
    ptaState: 'PTA',
    configured: 'configurada',
    missing: 'no configurada',
    unknown: 'desconocido',
    emptyCookie: 'Pega primero una cookie',
    failed: 'Fallo',
  },
  fr: {
    section: 'PTA',
    intro: 'La connexion à pintia.cn exige un code SMS qu’un script ne peut pas saisir : le cookie se colle donc ici à la main, puis de nouveau à son expiration.',
    ptaTitle: 'Cookie PTA',
    ptaHint: 'Connectez-vous à pintia.cn dans un navigateur, ouvrez n’importe quelle requête dans les outils de développement et collez ici l’en-tête Cookie complet (ou son cURL). Sa connexion exige un code SMS, qu’un script ne peut pas saisir.',
    ptaPlaceholder: 'Collez le cookie ou le cURL …',
    save: 'Enregistrer',
    clear: 'Effacer',
    saved: 'Enregistré',
    cleared: 'Effacé',
    saving: 'Enregistrement…',
    statusTitle: 'État',
    ptaState: 'PTA',
    configured: 'configuré',
    missing: 'non configuré',
    unknown: 'inconnu',
    emptyCookie: 'Collez d’abord un cookie',
    failed: 'Échec',
  },
  de: {
    section: 'PTA',
    intro: 'Die Anmeldung bei pintia.cn erfordert einen SMS-Code, den ein Skript nicht eingeben kann. Das Cookie wird daher hier von Hand eingefügt und nach Ablauf erneut.',
    ptaTitle: 'PTA-Cookie',
    ptaHint: 'Melden Sie sich in einem Browser bei pintia.cn an, öffnen Sie eine beliebige Anfrage in den Entwicklerwerkzeugen und fügen Sie den vollständigen Cookie-Header (oder dessen cURL) hier ein. Die Anmeldung erfordert einen SMS-Code, den ein Skript nicht eingeben kann.',
    ptaPlaceholder: 'Cookie oder cURL einfügen …',
    save: 'Speichern',
    clear: 'Löschen',
    saved: 'Gespeichert',
    cleared: 'Gelöscht',
    saving: 'Wird gespeichert…',
    statusTitle: 'Status',
    ptaState: 'PTA',
    configured: 'konfiguriert',
    missing: 'nicht konfiguriert',
    unknown: 'unbekannt',
    emptyCookie: 'Zuerst ein Cookie einfügen',
    failed: 'Fehlgeschlagen',
  },
  ru: {
    section: 'PTA',
    intro: 'Вход на pintia.cn требует SMS-кода, который скрипт ввести не может, поэтому cookie вставляется здесь вручную и повторно после истечения срока.',
    ptaTitle: 'Cookie PTA',
    ptaHint: 'Войдите на pintia.cn в браузере, откройте любой запрос в инструментах разработчика и вставьте сюда полный заголовок Cookie (или его cURL). Вход требует SMS-кода, который скрипт ввести не может.',
    ptaPlaceholder: 'Вставьте cookie или cURL …',
    save: 'Сохранить',
    clear: 'Очистить',
    saved: 'Сохранено',
    cleared: 'Очищено',
    saving: 'Сохранение…',
    statusTitle: 'Состояние',
    ptaState: 'PTA',
    configured: 'настроено',
    missing: 'не настроено',
    unknown: 'неизвестно',
    emptyCookie: 'Сначала вставьте cookie',
    failed: 'Ошибка',
  },
  pt: {
    section: 'PTA',
    intro: 'O início de sessão em pintia.cn exige um código SMS que um script não consegue introduzir, por isso o cookie é colado aqui à mão e novamente quando expira.',
    ptaTitle: 'Cookie do PTA',
    ptaHint: 'Inicia sessão em pintia.cn num navegador, abre qualquer pedido nas ferramentas de programador e cola aqui o cabeçalho Cookie completo (ou o seu cURL). O início de sessão exige um código SMS, que um script não consegue introduzir.',
    ptaPlaceholder: 'Cola o cookie ou o cURL …',
    save: 'Guardar',
    clear: 'Limpar',
    saved: 'Guardado',
    cleared: 'Limpo',
    saving: 'A guardar…',
    statusTitle: 'Estado',
    ptaState: 'PTA',
    configured: 'configurado',
    missing: 'não configurado',
    unknown: 'desconhecido',
    emptyCookie: 'Cola primeiro um cookie',
    failed: 'Falhou',
  },
};

/**
 * 设置分区本体。
 *
 * @param props.t - 取词函数（由 {@link apply} 注入，保证跟随界面语言）。
 */
export function SettingsSection({ t }) {
  const [cookie, setCookie] = useState('');
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  /**
   * 两张卡片的展开状态 —— 由「配没配」决定：配好收起输入、展开状态，反之亦然。
   *
   * `undefined` = 还没读到 status，按默认走。不能用 `defaultOpen` ——
   * 它是 useState 初值，只在挂载时生效，而配置状态是异步读回来的。
   */
  const [credentialOpen, setCredentialOpen] = useState(undefined);
  const [statusOpen, setStatusOpen] = useState(undefined);

  const load = async () => {
    try {
      const response = await fetch(ROUTE_PATH, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      const payload = await response.json();
      setStatus(payload);
      const configured = payload?.pta?.configured === true;
      setCredentialOpen(!configured);
      setStatusOpen(configured);
    } catch { /* 读不到就保持上一份结论，不把面板弄没 */ }
  };

  useEffect(() => { void load(); }, []);

  const post = async (action, body) => {
    const response = await fetch(`${ROUTE_PATH}?${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [WRITE_HEADER]: '1' },
      body: JSON.stringify(body ?? {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error ?? `HTTP ${response.status}`);
    return payload;
  };

  const save = async () => {
    if (cookie.trim().length === 0) { setMessage({ tone: 'bad', text: t('emptyCookie') }); return; }
    setBusy('save');
    setMessage(null);
    try {
      const payload = await post('cookie', { cookie });
      setStatus((prev) => ({ ...prev, pta: payload.pta ?? prev?.pta }));
      setCookie('');
      setMessage({ tone: 'ok', text: t('saved') });
    } catch (error) {
      setMessage({ tone: 'bad', text: `${t('failed')}: ${error.message}` });
    } finally { setBusy(null); }
  };

  const clear = async () => {
    setBusy('clear');
    setMessage(null);
    try {
      const payload = await post('cookie', { cookie: '' });
      setStatus((prev) => ({ ...prev, pta: payload.pta ?? prev?.pta }));
      setCookie('');
      setMessage({ tone: 'ok', text: t('cleared') });
    } catch (error) {
      setMessage({ tone: 'bad', text: `${t('failed')}: ${error.message}` });
    } finally { setBusy(null); }
  };

  const pta = status?.pta ?? {};

  // 结构与官方 Models 分区一致（`.ref/.../ModelsSection.tsx`）：
  //   Section(gap 12) → PageTitle(16/24 500) → Intro(14/22) → Rows(gap 8) → Card(0.5px 边/20px 圆角)
  // 之前直接把标题和卡片并列，间距靠各自 margin 拼，与官方节奏不一致。
  return React.createElement(Section, null,
    React.createElement(PageTitle, null, t('section')),
    React.createElement(Intro, null, t('intro')),
    React.createElement(Rows, null,
      // 卡片一：凭据输入与操作。
      React.createElement(Card, {
        title: t('ptaTitle'),
        detail: t('ptaHint'),
        open: credentialOpen,
        onOpenChange: setCredentialOpen,
        actions: React.createElement(Actions, null,
          React.createElement('button', { type: 'button', 'data-primary': '', disabled: busy !== null, onClick: save },
            busy === 'save' ? t('saving') : t('save')),
          React.createElement('button', { type: 'button', disabled: busy !== null, onClick: clear }, t('clear'))),
      },
        React.createElement(TextArea, {
          value: cookie,
          onChange: setCookie,
          placeholder: t('ptaPlaceholder'),
          ariaLabel: t('ptaTitle'),
          rows: 3,
        }),
        message ? React.createElement('span', {
          className: 'zju-setting-hint',
          'data-tone': message.tone,
          style: { color: message.tone === 'bad' ? '#e06c6c' : '#4caf7d' },
        }, message.text) : null),
      // 卡片二：Cookie 状态。与「输入」分开 —— 混在一张卡里会让值看起来属于输入框。
      //
      // ⚠️ 这里**只有** Cookie 状态，没有「出口」那一行。
      //   出口状态属于 `zhiyunEgress`（tier 0），本包不碰网络出口判定；
      //   而拼题A 是公网站（`hosts.js` 归 `PUBLIC_HOSTS`），本来也不该被网关改写。
      //   把无关读数摆进这一页，用户会以为「出口错了」是 Cookie 失效的原因。
      React.createElement(Card, {
        title: t('statusTitle'),
        open: statusOpen,
        onOpenChange: setStatusOpen,
      },
        // `ptaStatus()` 只返回 `{ configured, names }` —— 没有 `ok`。
        // 按真实字段判。它只说明「Cookie 在不在」，不是「能不能用」
        // —— 后者要真发一次请求；把网络抖动误报成「过期」是这一页最容易骗到人的错误。
        React.createElement(StatusLine, {
          label: t('ptaState'),
          value: pta.configured === true ? t('configured')
            : pta.configured === false ? t('missing')
              : t('unknown'),
          tone: pta.configured === true ? 'ok' : 'warn',
        }))),
  );
}

/** 挂载：注册字典与样式，再把分区塞进宿主的设置浮窗。 */
export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zjuCampusSettingsStyle', css: SETTINGS_CSS, label: 'zju: campus settings styles' });
  const text = registerText(ctx, NAMESPACE, TEXT);
  ctx.effect(() => () => text.dispose(), 'zju: campus settings i18n');
  // order 56：紧跟「浙大一卡通」(60) 之后、学习通(58) 之前。
  // `campus` 退役前它占着 55，两个同时存在会撞号，所以这里取 56。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'zju-source-pta',
    order: 56,
    label: () => text.t('section'),
  }, () => React.createElement(SettingsSection, { t: text.t })));
}
