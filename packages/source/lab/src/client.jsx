/**
 * 「实验课平台」设置分区。
 *
 * # 为什么它需要自己的分区（而不是并进「浙大一卡通」）
 *
 * 这个包是 `auth: "own"`：**它有自己的账号体系**。用户名通常就是学号，
 * 但**密码与统一身份认证不是同一个** —— 实验课平台是独立的一套。
 *
 * 所以它必须能单独配：并进一卡通会让用户拿 CAS 密码去登，一直失败，
 * 而他不会知道原因（他会以为自己一卡通密码填错了）。
 *
 * 这与拼题A / 学习通 / CC98 的处理是同一条：**一个数据源一组凭证，就占一个分区**。
 *
 * # 路由协议（照本包 `src/index.js`）
 *
 * ```text
 *   GET  /api/zhiyun-lab   → 读能力描述（含 status）
 *   POST /api/zhiyun-lab   { action: 'save-account', input: { username, password } }
 *   POST /api/zhiyun-lab   { action: 'clear-account' }
 *   POST /api/zhiyun-lab   { action: 'status' }
 * ```
 *
 * 动作名带连字符（`save-account`），与 `src/index.js` 的 `handlers` 表一致 ——
 * 写错不会报「未知动作」以外的线索，所以两边必须逐字对齐。
 */

import React, { useCallback, useEffect, useState } from 'react';
import {
  Actions,
  Card,
  Field,
  Intro,
  PageTitle,
  Rows,
  Section,
  StatusLine,
  mountStyle,
  registerText,
} from '@lybx-leyw/dsh-zju-ui-shared';

const ROUTE_PATH = '/api/zhiyun-lab';
const NAMESPACE = 'zju-source-lab';
const SECTION_ID = 'zju-source-lab';

export const name = 'zhiyun-source-lab-client';

/** 只要插槽与本地化。 */
export const inject = ['slots', 'locale'];

/**
 * 文案。
 *
 * 只做中英两种：本仓其余数据源分区（`pta` / `xxt` / `cc98`）也是这个范围。
 * 缺的语言由宿主回退到 `en`。
 */
export const TEXT = {
  zh: {
    section: '实验课平台',
    intro: '实验课平台用的是它**自己**的账号密码（与「浙大一卡通」不是同一份）。用户名通常是学号。',
    accountLabel: '用户名',
    accountHint: '通常是学号',
    passwordLabel: '密码',
    passwordHint: '实验课平台的密码，不是统一身份认证的密码',
    saved: '已保存。下次读取实验课时会用这份账号登录。',
    cleared: '已清除。实验课相关功能会退回未配置状态。',
    save: '保存',
    clear: '清除',
    saving: '保存中…',
    clearing: '清除中…',
    configuredAs: '已配置 · {username}',
    notConfigured: '未配置',
    empty: '请填写用户名与密码',
    failed: '保存失败',
    statusTitle: '连接状态',
    statusOk: '已登录',
    statusNeedsLogin: '还没登录（首次读取时自动登录）',
    statusNeedsCredential: '还没配账号',
    statusUnknown: '未检测',
    statusDisabled: '数据源未启用',
    statusTimeout: '探测超时',
    check: '检测连接',
    checking: '检测中…',
    statusLine: '登录状态',
    checkOk: '连接成功，账号可用',
    checkFailed: '连接失败',
    checkFailedUnknown: '平台没有给出原因',
  },
  en: {
    section: 'Lab courses',
    intro: 'The lab platform uses its OWN credentials (not the ZJU unified sign-in). The username is usually your student ID.',
    accountLabel: 'Username',
    accountHint: 'usually your student ID',
    passwordLabel: 'Password',
    passwordHint: 'the lab platform password, not your CAS password',
    saved: 'Saved. Lab reads will use this account.',
    cleared: 'Cleared. Lab features return to unconfigured.',
    save: 'Save',
    clear: 'Clear',
    saving: 'Saving…',
    clearing: 'Clearing…',
    configuredAs: 'Configured · {username}',
    notConfigured: 'Not configured',
    empty: 'Enter both username and password',
    failed: 'Save failed',
    statusTitle: 'Connection',
    statusOk: 'Signed in',
    statusNeedsLogin: 'Not signed in yet (signs in on first read)',
    statusNeedsCredential: 'No account configured',
    statusUnknown: 'Not checked',
    statusDisabled: 'Source not installed',
    statusTimeout: 'Check timed out',
    check: 'Check connection',
    checking: 'Checking…',
    statusLine: 'Sign-in state',
    checkOk: 'Connected — the account works',
    checkFailed: 'Connection failed',
    checkFailedUnknown: 'the platform gave no reason',
  },
  ja: {
    section: '実験科目',
    intro: '実験科目プラットフォームは**独自**のアカウントを使います（統一認証とは別）。ユーザー名は通常学籍番号です。',
    accountLabel: 'ユーザー名',
    accountHint: '通常は学籍番号',
    passwordLabel: 'パスワード',
    passwordHint: '実験科目のパスワード（統一認証ではありません）',
    saved: '保存しました。次回の読み取りでこのアカウントを使います。',
    cleared: '削除しました。未設定の状態に戻ります。',
    save: '保存',
    clear: '削除',
    saving: '保存中…',
    clearing: '削除中…',
    configuredAs: '設定済み · {username}',
    notConfigured: '未設定',
    empty: 'ユーザー名とパスワードを入力してください',
    failed: '保存に失敗しました',
    statusTitle: '接続状態',
    statusOk: 'ログイン済み',
    statusNeedsLogin: '未ログイン（初回読み取り時にログイン）',
    statusNeedsCredential: 'アカウント未設定',
    statusUnknown: '未確認',
    statusDisabled: 'データソース未有効',
    statusTimeout: '確認タイムアウト',
    check: '接続を確認',
    checking: '確認中…',
    statusLine: 'ログイン状態',
    checkOk: '接続成功。アカウントは使用可能',
    checkFailed: '接続に失敗しました',
    checkFailedUnknown: 'プラットフォームからの理由はありません',
  },
  es: {
    section: 'Cursos de laboratorio',
    intro: 'La plataforma de laboratorio usa sus **propias** credenciales (no el inicio de sesión unificado). El usuario suele ser el número de estudiante.',
    accountLabel: 'Usuario',
    accountHint: 'normalmente tu número de estudiante',
    passwordLabel: 'Contraseña',
    passwordHint: 'la contraseña del laboratorio, no la de CAS',
    saved: 'Guardado. Las lecturas usarán esta cuenta.',
    cleared: 'Borrado. Vuelve a sin configurar.',
    save: 'Guardar',
    clear: 'Borrar',
    saving: 'Guardando…',
    clearing: 'Borrando…',
    configuredAs: 'Configurado · {username}',
    notConfigured: 'Sin configurar',
    empty: 'Introduce usuario y contraseña',
    failed: 'Error al guardar',
    statusTitle: 'Conexión',
    statusOk: 'Sesión iniciada',
    statusNeedsLogin: 'Sin sesión (se inicia en la primera lectura)',
    statusNeedsCredential: 'Sin cuenta',
    statusUnknown: 'Sin comprobar',
    statusDisabled: 'Fuente no instalada',
    statusTimeout: 'Tiempo agotado',
    check: 'Comprobar conexión',
    checking: 'Comprobando…',
    statusLine: 'Estado de sesión',
    checkOk: 'Conectado: la cuenta funciona',
    checkFailed: 'Error de conexión',
    checkFailedUnknown: 'la plataforma no dio motivo',
  },
  fr: {
    section: 'Cours de laboratoire',
    intro: 'La plateforme de laboratoire utilise ses **propres** identifiants (pas la connexion unifiée). Le nom d\'utilisateur est généralement le numéro d\'étudiant.',
    accountLabel: 'Identifiant',
    accountHint: 'généralement votre numéro d\'étudiant',
    passwordLabel: 'Mot de passe',
    passwordHint: 'celui du laboratoire, pas celui du CAS',
    saved: 'Enregistré. Les lectures utiliseront ce compte.',
    cleared: 'Supprimé. Retour à non configuré.',
    save: 'Enregistrer',
    clear: 'Supprimer',
    saving: 'Enregistrement…',
    clearing: 'Suppression…',
    configuredAs: 'Configuré · {username}',
    notConfigured: 'Non configuré',
    empty: 'Saisissez identifiant et mot de passe',
    failed: 'Échec de l\'enregistrement',
    statusTitle: 'Connexion',
    statusOk: 'Connecté',
    statusNeedsLogin: 'Non connecté (connexion à la première lecture)',
    statusNeedsCredential: 'Aucun compte',
    statusUnknown: 'Non vérifié',
    statusDisabled: 'Source non installée',
    statusTimeout: 'Délai dépassé',
    check: 'Vérifier la connexion',
    checking: 'Vérification…',
    statusLine: 'État de connexion',
    checkOk: 'Connecté — le compte fonctionne',
    checkFailed: 'Échec de la connexion',
    checkFailedUnknown: 'la plateforme n’a pas donné de raison',
  },
  de: {
    section: 'Laborkurse',
    intro: 'Die Laborplattform nutzt **eigene** Zugangsdaten (nicht die zentrale Anmeldung). Der Benutzername ist meist die Matrikelnummer.',
    accountLabel: 'Benutzername',
    accountHint: 'meist die Matrikelnummer',
    passwordLabel: 'Passwort',
    passwordHint: 'das Laborpasswort, nicht das CAS-Passwort',
    saved: 'Gespeichert. Lesezugriffe nutzen dieses Konto.',
    cleared: 'Gelöscht. Zurück auf nicht konfiguriert.',
    save: 'Speichern',
    clear: 'Löschen',
    saving: 'Speichern…',
    clearing: 'Löschen…',
    configuredAs: 'Konfiguriert · {username}',
    notConfigured: 'Nicht konfiguriert',
    empty: 'Benutzername und Passwort eingeben',
    failed: 'Speichern fehlgeschlagen',
    statusTitle: 'Verbindung',
    statusOk: 'Angemeldet',
    statusNeedsLogin: 'Nicht angemeldet (Anmeldung beim ersten Lesen)',
    statusNeedsCredential: 'Kein Konto',
    statusUnknown: 'Nicht geprüft',
    statusDisabled: 'Quelle nicht installiert',
    statusTimeout: 'Zeitüberschreitung',
    check: 'Verbindung prüfen',
    checking: 'Prüfe…',
    statusLine: 'Anmeldestatus',
    checkOk: 'Verbunden — das Konto funktioniert',
    checkFailed: 'Verbindung fehlgeschlagen',
    checkFailedUnknown: 'die Plattform gab keinen Grund an',
  },
  ru: {
    section: 'Лабораторные курсы',
    intro: 'Лабораторная платформа использует **свои** учётные данные (не единый вход). Имя пользователя обычно — номер студента.',
    accountLabel: 'Имя пользователя',
    accountHint: 'обычно номер студента',
    passwordLabel: 'Пароль',
    passwordHint: 'пароль платформы, не пароль CAS',
    saved: 'Сохранено. Чтения будут использовать этот аккаунт.',
    cleared: 'Удалено. Возврат к не настроенному состоянию.',
    save: 'Сохранить',
    clear: 'Удалить',
    saving: 'Сохранение…',
    clearing: 'Удаление…',
    configuredAs: 'Настроено · {username}',
    notConfigured: 'Не настроено',
    empty: 'Введите имя пользователя и пароль',
    failed: 'Не удалось сохранить',
    statusTitle: 'Соединение',
    statusOk: 'Вход выполнен',
    statusNeedsLogin: 'Нет входа (выполнится при первом чтении)',
    statusNeedsCredential: 'Нет аккаунта',
    statusUnknown: 'Не проверено',
    statusDisabled: 'Источник не установлен',
    statusTimeout: 'Тайм-аут',
    check: 'Проверить соединение',
    checking: 'Проверка…',
    statusLine: 'Состояние входа',
    checkOk: 'Подключено — аккаунт работает',
    checkFailed: 'Не удалось подключиться',
    checkFailedUnknown: 'платформа не указала причину',
  },
  pt: {
    section: 'Cursos de laboratório',
    intro: 'A plataforma de laboratório usa credenciais **próprias** (não o login unificado). O utilizador é habitualmente o número de estudante.',
    accountLabel: 'Utilizador',
    accountHint: 'habitualmente o número de estudante',
    passwordLabel: 'Palavra-passe',
    passwordHint: 'a do laboratório, não a do CAS',
    saved: 'Guardado. As leituras usarão esta conta.',
    cleared: 'Removido. Volta a não configurado.',
    save: 'Guardar',
    clear: 'Remover',
    saving: 'A guardar…',
    clearing: 'A remover…',
    configuredAs: 'Configurado · {username}',
    notConfigured: 'Não configurado',
    empty: 'Introduza utilizador e palavra-passe',
    failed: 'Falha ao guardar',
    statusTitle: 'Ligação',
    statusOk: 'Sessão iniciada',
    statusNeedsLogin: 'Sem sessão (inicia na primeira leitura)',
    statusNeedsCredential: 'Sem conta',
    statusUnknown: 'Não verificado',
    statusDisabled: 'Fonte não instalada',
    statusTimeout: 'Tempo esgotado',
    check: 'Verificar ligação',
    checking: 'A verificar…',
    statusLine: 'Estado da sessão',
    checkOk: 'Ligado — a conta funciona',
    checkFailed: 'Falha na ligação',
    checkFailedUnknown: 'a plataforma não indicou o motivo',
  },
};

/**
 * 调一次本包的路由。
 *
 * @param action - 动作名（空串表示 GET 读能力描述）。
 * @param input - POST 时的参数。
 * @returns 路由返回的 `value`（或整个响应体）。
 */
async function lab(action = 'status', input = undefined) {
  // ⚠️ **一律 POST，并且必须带 `action`。**
  //
  // 这个路由（`src/index.js`）不区分 GET/POST：它总是读请求体里的 `action`，
  // 没有就报「不认识的操作」。先前这里在 `action` 为空时发 GET —— 服务端拿到
  // 空 action，前端 catch 住错误又保持 `status = null`，于是界面**恒显示「未检测」**，
  // 而用户明明配过账号。
  const response = await fetch(ROUTE_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(input === undefined ? { action } : { action, input }),
  });
  const payload = await response.json().catch(() => ({}));
  if (payload?.ok === false) {
    throw Object.assign(new Error(payload?.error?.message ?? '请求失败'), {
      code: payload?.error?.code,
    });
  }
  return payload?.value ?? payload;
}

/**
 * 设置分区本体。
 *
 * @param props.t - 取文案的函数。
 */
export function SettingsSection({ t }) {
  const [status, setStatus] = useState(null);
  const [form, setForm] = useState({ username: '', password: '' });
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);
  /**
   * 两张卡片的展开状态 —— **由「配没配」决定**。
   *
   * 配好了就收起凭证表单、展开状态卡；没配则反过来。
   * 这里要能跟着异步读回来的 `status` 变，所以不能用 `defaultOpen`
   * （它是 useState 的初值，只在挂载时生效一次）。
   *
   * `undefined` = 还没读到 status，这时按默认（凭证展开）走。
   */
  const [credentialOpen, setCredentialOpen] = useState(undefined);
  const [statusOpen, setStatusOpen] = useState(undefined);

  const refresh = useCallback(async () => {
    try {
      const value = await lab('status');
      setStatus(value ?? null);
      // 配过 → 收起凭证、展开状态；没配 → 反过来。
      const configured = value?.configured === true || value?.loggedIn === true;
      setCredentialOpen(!configured);
      setStatusOpen(configured);
    } catch {
      /* 读不到就保持上一份结论 —— 不该把整块变成错误 */
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    if (!form.username.trim() || !form.password) {
      setMessage({ tone: 'bad', text: t('empty') });
      return;
    }
    setBusy('save');
    setMessage(null);
    try {
      await lab('save-account', { username: form.username.trim(), password: form.password });
      // 密码框清空：与一卡通那块同一个理由 —— 留着会让下次输入被**追加**。
      setForm((prev) => ({ ...prev, password: '' }));
      setMessage({ tone: 'ok', text: t('saved') });
      await refresh();
    } catch (error) {
      setMessage({ tone: 'bad', text: `${t('failed')}: ${error.message}` });
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setBusy('clear');
    setMessage(null);
    try {
      await lab('clear-account');
      setForm({ username: '', password: '' });
      setMessage({ tone: 'ok', text: t('cleared') });
      await refresh();
    } catch (error) {
      setMessage({ tone: 'bad', text: `${t('failed')}: ${error.message}` });
    } finally {
      setBusy(null);
    }
  };

  /**
   * 探测连接：真的登录一次。
   *
   * `status()` 是**本机会话快照**（不联网）；要让「到底能不能用」有个诚实答案，
   * 得走一次 `login()`。代价是一次网络请求，所以只在用户点按钮时做。
   */
  /**
   * 「检测连接」：**真的登录一次**。
   *
   * # 先前这个是假的
   *
   * 它只调 `status`（读内存快照，不联网），然后把按钮文字设成「检测连接」——
   * 用户点了以为测过了，实际什么都没发生。那是「界面上有个动作，但它不做那件事」。
   *
   * 现在调 `verify`：强制重登一次，真的打到平台。代价是一次网络请求，
   * 所以只在用户点按钮时做。
   */
  const check = async () => {
    setBusy('check');
    setMessage(null);
    try {
      const result = await lab('verify');
      if (result?.ok) {
        setStatus({
          loggedIn: true,
          configured: true,
          username: result.username ?? '',
          ...(result.name ? { name: result.name } : {}),
        });
        setMessage({ tone: 'ok', text: t('checkOk') });
      } else {
        setStatus({
          loggedIn: false,
          configured: result?.configured === true,
          username: status?.username ?? '',
        });
        // 如实给出平台的拒绝原因 —— 那才是用户要的信息。
        setMessage({
          tone: 'bad',
          text: `${t('checkFailed')}: ${result?.error ?? t('checkFailedUnknown')}`,
        });
      }
    } catch (error) {
      setMessage({ tone: 'bad', text: `${t('checkFailed')}: ${error.message}` });
    } finally {
      setBusy(null);
    }
  };

  const configured = status?.loggedIn || status?.configured;
  const tone = status?.loggedIn ? 'ok' : 'warn';

  return (
    <Section>
      <PageTitle>{t('section')}</PageTitle>
      <Intro>{t('intro')}</Intro>

      <Rows>
        <Card
          title={t('section')}
          detail={configured
            ? t('configuredAs').replace('{username}', status?.username ?? '')
            : t('notConfigured')}
          open={credentialOpen}
          onOpenChange={setCredentialOpen}
          actions={(
            <Actions>
              <button
                type="button"
                data-primary=""
                disabled={busy !== null}
                onClick={() => { void save(); }}
              >
                {busy === 'save' ? t('saving') : t('save')}
              </button>
              <button
                type="button"
                disabled={busy !== null || !configured}
                onClick={() => { void clear(); }}
              >
                {busy === 'clear' ? t('clearing') : t('clear')}
              </button>
            </Actions>
          )}
        >
          <Field id="zcd-lab-account" label={t('accountLabel')} hint={t('accountHint')}>
            <input
              id="zcd-lab-account"
              className="zju-setting-input"
              type="text"
              autoComplete="username"
              value={form.username}
              onChange={(event) => setForm((prev) => ({ ...prev, username: event.target.value }))}
            />
          </Field>
          <Field id="zcd-lab-password" label={t('passwordLabel')} hint={t('passwordHint')}>
            <input
              id="zcd-lab-password"
              className="zju-setting-input"
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(event) => setForm((prev) => ({ ...prev, password: event.target.value }))}
            />
          </Field>
          {message && <Intro>{message.text}</Intro>}
        </Card>

        <Card
          title={t('statusTitle')}
          open={statusOpen}
          onOpenChange={setStatusOpen}
          actions={(
            <Actions>
              <button type="button" disabled={busy !== null} onClick={() => { void check(); }}>
                {busy === 'check' ? t('checking') : t('check')}
              </button>
            </Actions>
          )}
        >
          <StatusLine
            label={t('statusLine')}
            value={status === null
              ? t('statusUnknown')
              : status.loggedIn
                ? t('statusOk')
                : status.configured
                  ? t('statusNeedsLogin')
                  : t('statusNeedsCredential')}
            tone={tone}
          />
        </Card>
      </Rows>
    </Section>
  );
}

/**
 * 注册设置分区。
 *
 * `order` 取 62：一卡通是 60、拼题A 是 56，实验课平台排在它们之后 ——
 * 它是次要数据源，最常被问的是「教务和一卡通」，不是为了实验课。
 *
 * @param ctx - 客户端上下文。
 */
export function apply(ctx) {
  const text = registerText(ctx, NAMESPACE, TEXT);
  ctx.effect(() => () => text.dispose(), 'zju: lab settings i18n');

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: 62,
    label: () => text.t('section'),
  }, () => React.createElement(SettingsSection, { t: text.t })));
}
