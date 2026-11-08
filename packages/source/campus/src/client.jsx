/**
 * 「学在浙大 / 拼题A」设置分区。
 *
 * # 这个分区只做一件事：拼题A 的 Cookie
 *
 * 学在浙大走 CAS，账号来自「浙大一卡通」分区（`dsh-zju-source-login`），这里不重复问。
 * 拼题A 是**另一回事**：它的登录要过短信验证，脚本无法自动完成，只能「浏览器登录 →
 * 复制 Cookie → 粘进来」。此前这条路只有终端命令和 `PTA_COOKIE` 环境变量两个入口，
 * 用户在界面上找不到它 —— 这个分区就是那个入口。
 *
 * # 服务端早已支持
 *
 * `POST /api/zhiyun-campus?pta-cookie`（需 `x-zhiyun-campus: 1` 头）一直是现成的，
 * 缺的只是前端。所以这里**不新增任何后端逻辑**，只把已有的路由接上。
 *
 * # 出口状态为什么也放这里
 *
 * 「连不上」是这一页最常被问的问题，而它通常不是密码错、是走了错的路（校外没绕
 * WebVPN、或校园站点被送去了全局代理）。把 `egress` 的事实摆在 Cookie 下面，
 * 用户不必去翻日志。
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
const ROUTE_PATH = '/api/zhiyun-campus';
/** 写操作必须带的自定义头（服务端用它挡 CSRF）。 */
const WRITE_HEADER = 'x-zhiyun-campus';
/** i18n namespace。**一包一个**，重复注册同名同语言会抛错。 */
const NAMESPACE = 'zju-source-campus';

export const name = 'zhiyun-source-campus-client';

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
    ptaState: '拼题A',    egressState: '出口',
    configured: '已配置',
    missing: '未配置',
    unknown: '未知',
    inside: '校内直连',
    outside: '校外',
    reprobe: '重新探测出口',
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
    ptaState: 'PTA',    egressState: 'Egress',
    configured: 'configured',
    missing: 'not configured',
    unknown: 'unknown',
    inside: 'on campus (direct)',
    outside: 'off campus',
    reprobe: 'Re-probe egress',
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
    egressState: '出口',
    configured: '設定済み',
    missing: '未設定',
    unknown: '不明',
    inside: '学内（直接接続）',
    outside: '学外',
    reprobe: '出口を再検出',
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
    egressState: 'Salida',
    configured: 'configurada',
    missing: 'no configurada',
    unknown: 'desconocido',
    inside: 'en el campus (directo)',
    outside: 'fuera del campus',
    reprobe: 'Volver a sondear la salida',
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
    egressState: 'Sortie',
    configured: 'configuré',
    missing: 'non configuré',
    unknown: 'inconnu',
    inside: 'sur le campus (direct)',
    outside: 'hors campus',
    reprobe: 'Resonder la sortie',
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
    egressState: 'Ausgang',
    configured: 'konfiguriert',
    missing: 'nicht konfiguriert',
    unknown: 'unbekannt',
    inside: 'auf dem Campus (direkt)',
    outside: 'außerhalb des Campus',
    reprobe: 'Ausgang erneut prüfen',
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
    egressState: 'Выход',
    configured: 'настроено',
    missing: 'не настроено',
    unknown: 'неизвестно',
    inside: 'в кампусе (напрямую)',
    outside: 'вне кампуса',
    reprobe: 'Повторить проверку выхода',
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
    egressState: 'Saída',
    configured: 'configurado',
    missing: 'não configurado',
    unknown: 'desconhecido',
    inside: 'no campus (direto)',
    outside: 'fora do campus',
    reprobe: 'Voltar a sondar a saída',
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

  const load = async () => {
    try {
      const response = await fetch(ROUTE_PATH, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      setStatus(await response.json());
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
      const payload = await post('pta-cookie', { cookie });
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
      const payload = await post('pta-cookie', { cookie: '' });
      setStatus((prev) => ({ ...prev, pta: payload.pta ?? prev?.pta }));
      setCookie('');
      setMessage({ tone: 'ok', text: t('cleared') });
    } catch (error) {
      setMessage({ tone: 'bad', text: `${t('failed')}: ${error.message}` });
    } finally { setBusy(null); }
  };

  const reprobe = async () => {
    setBusy('probe');
    try {
      const payload = await post('reprobe', {});
      setStatus((prev) => ({ ...prev, egress: payload.egress ?? prev?.egress }));
    } catch { /* 探测失败不阻断其它操作 */ }
    finally { setBusy(null); }
  };

  const pta = status?.pta ?? {};
  const egress = status?.egress ?? {};

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
      // 卡片二：三项状态与复测。与「输入」分开 —— 混在一张卡里会让值看起来属于输入框。
      React.createElement(Card, {
        title: t('statusTitle'),
        actions: React.createElement(Actions, null,
          React.createElement('button', { type: 'button', disabled: busy !== null, onClick: reprobe }, t('reprobe'))),
      },
        // `ptaStatus()` 只返回 `{ configured, names }` —— 没有 `ok`。
        // 原来判 `pta.ok` 永远 undefined，于是「已配 Cookie」也落进 else 显示「未知」。
        // 现在按真实字段判。它只说明「Cookie 在不在」，不是「能不能用」
        // —— 后者要真发一次请求；与学习通把两件事分开是同一个道理。
        React.createElement(StatusLine, {
          label: t('ptaState'),
          value: pta.configured === true ? t('configured')
            : pta.configured === false ? t('missing')
              : t('unknown'),
          tone: pta.configured === true ? 'ok' : 'warn',
        }),
        React.createElement(StatusLine, {
          label: t('egressState'),
          value: egress.campus === 'inside' ? t('inside')
            : egress.campus === 'outside' ? t('outside')
              : t('unknown'),
          tone: egress.degraded ? 'warn' : 'plain',
        }))),
  );
}

/** 挂载：注册字典与样式，再把分区塞进宿主的设置浮窗。 */
export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zjuCampusSettingsStyle', css: SETTINGS_CSS, label: 'zju: campus settings styles' });
  const text = registerText(ctx, NAMESPACE, TEXT);
  ctx.effect(() => () => text.dispose(), 'zju: campus settings i18n');
  // order 55：排在「浙大一卡通」(60) 之前 —— 同一批校园数据源里，这一项最常被问起。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'zju-source-campus',
    order: 55,
    label: () => text.t('section'),
  }, () => React.createElement(SettingsSection, { t: text.t })));
}
