/**
 * CC98 设置分区的客户端半边。
 *
 * # 这个分区管两件事
 *
 * 1. **账号密码**：CC98 论坛自己的账号（不是学号）。保存后交给宿主凭据服务。
 * 2. **登录状态**：确认那份凭据是否真的能读到数据。
 *
 * # 为什么凭据入口在这里、而不在「统一身份认证」那一页
 *
 * CC98 的账号体系与浙大统一认证完全独立（openid.cc98.org 的 OAuth2）：
 * 只用论坛的人可能没有学号身份，有学号的人论坛密码也可能另一个。放在同一页
 * 会让人以为填一次就都有了 —— 那是本仓早先踩过的坑：曾借一卡通那份记录去登
 * CC98，导致只有论坛账号的人永远登不进去，失败提示还把人指向「改一卡通密码」。
 *
 * # 密码的语义
 *
 * 输入框**永远从空开始**，不回填打码值：预填后接着打字会拼成
 * `********新密码`，保存「成功」而登录必然失败。所以用 `hasPassword`
 * 单独记「已存着」，提交时空值翻成 MASK = 不改。
 *
 * # 宿主侧不搬家
 *
 * 动作名（cc98-save / cc98-clear）与记录键仍由 login 包的宿主半边提供，
 * 只是入口从 login 的界面挪到本分区。行为完全不变，也不需要迁移数据。
 */
import React, { useEffect, useState } from 'react';
import {
  Actions,
  Card,
  Field,
  Intro,
  PageTitle,
  Rows,
  SETTINGS_CSS,
  Section,
  StatusLine,
  mountStyle,
  registerText,
} from '@lybx-leyw/dsh-zju-ui-shared';

/** 本包的数据路由（登录状态从这里读）。 */
const ROUTE_PATH = '/api/zhiyun-cc98';
/**
 * 凭据读写走 **login 包的宿主半边**：动作名与记录键都在那里。
 * 客户端只换入口，不搬服务 —— 免得两套记录键各存一份。
 */
const CREDENTIAL_ROUTE = '/_dsh/zhiyun-card';
/** 写操作的自定义头，服务端用它挡 CSRF。 */
const WRITE_HEADER = 'x-zhiyun-card';
/** 「沿用已存密码」的哨兵值。 */
const MASK = '********';
const NAMESPACE = 'zju-source-cc98';

export const name = 'zhiyun-source-cc98-client';

export const inject = ['slots', 'locale'];

export const TEXT = {
  zh: {
    section: 'CC98',
    intro: 'CC98 是独立站点，用论坛自己的账号（论坛 ID 或注册邮箱），不是学号。',
    accountLabel: 'CC98 账号',
    accountPlaceholder: '论坛 ID 或注册邮箱',
    accountHint: '不是学号 —— 论坛有自己的账号体系，两者可以完全不同。',
    passwordLabel: '密码',
    passwordPlaceholderNew: '填一次密码',
    passwordPlaceholderKeep: '留空则沿用已存的密码',
    passwordHintNew: '还没有存过密码，这一项必填。密码不会回传到这个页面。',
    passwordHintKeep: '已存着密码，这里留空即沿用；要换密码直接重填。密码不会回传到这个页面。',
    save: '保存',
    saving: '正在保存…',
    clear: '清除',
    clearing: '正在清除…',
    clearTitleReady: '清掉本机保存的 CC98 账号',
    clearTitleEmpty: '还没有可清除的账号',
    saved: '已保存。',
    cleared: '已清除。',
    emptyAccount: '请先填账号',
    failed: '保存失败',
    reading: '正在读取…',
    configuredAs: '已配置 · {username}',
    notConfigured: '未配置',
    credentialState: '凭据',
    credentialReady: '已保存',
    credentialMissing: '未保存',
    loginState: '登录状态',
    loggedIn: '已登录',
    loggedOut: '未登录',
    unknown: '未知',
    statusTitle: '状态',
    refresh: '刷新状态',
    refreshing: '刷新中…',
  },
  en: {
    section: 'CC98',
    intro: 'CC98 is a standalone site: it uses its own forum account (forum ID or registered email), not the student ID.',
    accountLabel: 'CC98 account',
    accountPlaceholder: 'Forum ID or registered email',
    accountHint: 'Not the student ID — the forum has its own account system, and the two can differ entirely.',
    passwordLabel: 'Password',
    passwordPlaceholderNew: 'Enter the password once',
    passwordPlaceholderKeep: 'Leave blank to keep the stored password',
    passwordHintNew: 'No password is stored yet, so this one is required. The password is never sent back to this page.',
    passwordHintKeep: 'A password is already stored — leave this blank to keep it, or type a new one to replace it. The password is never sent back to this page.',
    save: 'Save',
    saving: 'Saving…',
    clear: 'Clear',
    clearing: 'Clearing…',
    clearTitleReady: 'Remove the saved CC98 account from this machine',
    clearTitleEmpty: 'Nothing to clear yet',
    saved: 'Saved.',
    cleared: 'Cleared.',
    emptyAccount: 'Enter the account first',
    failed: 'Save failed',
    reading: 'Reading…',
    configuredAs: 'Configured · {username}',
    notConfigured: 'Not configured',
    credentialState: 'Credential',
    credentialReady: 'saved',
    credentialMissing: 'not saved',
    loginState: 'Session',
    loggedIn: 'signed in',
    loggedOut: 'not signed in',
    unknown: 'unknown',
    statusTitle: 'Status',
    refresh: 'Refresh',
    refreshing: 'Refreshing…',
  },
  ja: {
    section: 'CC98',
    intro: 'CC98 は独立したサイトで、学籍番号ではなくフォーラム独自のアカウント（フォーラム ID または登録メールアドレス）を使います。',
    accountLabel: 'CC98 アカウント',
    accountPlaceholder: 'フォーラム ID または登録メールアドレス',
    accountHint: '学籍番号ではありません。フォーラムは独自のアカウント体系を持ち、両者はまったく別物になり得ます。',
    passwordLabel: 'パスワード',
    passwordPlaceholderNew: 'パスワードを一度入力',
    passwordPlaceholderKeep: '空欄のままにすると保存済みのパスワードを使用',
    passwordHintNew: 'まだパスワードが保存されていないため、この項目は必須です。パスワードがこのページに返ることはありません。',
    passwordHintKeep: 'パスワードは保存済みです。空欄のままにすると既存のものを使用します。変更する場合は入力し直してください。パスワードがこのページに返ることはありません。',
    save: '保存',
    saving: '保存中…',
    clear: '消去',
    clearing: '消去中…',
    clearTitleReady: 'この端末に保存された CC98 アカウントを削除します',
    clearTitleEmpty: '消去できるアカウントはまだありません',
    saved: '保存しました。',
    cleared: '消去しました。',
    emptyAccount: '先にアカウントを入力してください',
    failed: '保存失敗',
    reading: '読み取り中…',
    configuredAs: '設定済み · {username}',
    notConfigured: '未設定',
    credentialState: '認証情報',
    credentialReady: '保存済み',
    credentialMissing: '未保存',
    loginState: 'セッション',
    loggedIn: 'サインイン済み',
    loggedOut: '未サインイン',
    unknown: '不明',
    statusTitle: '状態',
    refresh: '状態を更新',
    refreshing: '更新中…',
  },
  es: {
    section: 'CC98',
    intro: 'CC98 es un sitio independiente: usa su propia cuenta del foro (ID del foro o correo registrado), no el número de estudiante.',
    accountLabel: 'Cuenta de CC98',
    accountPlaceholder: 'ID del foro o correo registrado',
    accountHint: 'No es el número de estudiante: el foro tiene su propio sistema de cuentas y ambos pueden ser completamente distintos.',
    passwordLabel: 'Contraseña',
    passwordPlaceholderNew: 'Introduce la contraseña una vez',
    passwordPlaceholderKeep: 'Déjalo en blanco para conservar la contraseña guardada',
    passwordHintNew: 'Todavía no hay contraseña guardada, así que este campo es obligatorio. La contraseña nunca se devuelve a esta página.',
    passwordHintKeep: 'Ya hay una contraseña guardada: déjalo en blanco para conservarla o escribe una nueva. La contraseña nunca se devuelve a esta página.',
    save: 'Guardar',
    saving: 'Guardando…',
    clear: 'Borrar',
    clearing: 'Borrando…',
    clearTitleReady: 'Eliminar la cuenta de CC98 guardada en este equipo',
    clearTitleEmpty: 'Todavía no hay nada que borrar',
    saved: 'Guardada.',
    cleared: 'Borrada.',
    emptyAccount: 'Introduce primero la cuenta',
    failed: 'Error al guardar',
    reading: 'Leyendo…',
    configuredAs: 'Configurada · {username}',
    notConfigured: 'No configurada',
    credentialState: 'Credencial',
    credentialReady: 'guardada',
    credentialMissing: 'no guardada',
    loginState: 'Sesión',
    loggedIn: 'sesión iniciada',
    loggedOut: 'sesión cerrada',
    unknown: 'desconocido',
    statusTitle: 'Estado',
    refresh: 'Actualizar estado',
    refreshing: 'Actualizando…',
  },
  fr: {
    section: 'CC98',
    intro: 'CC98 est un site indépendant : il utilise son propre compte de forum (identifiant du forum ou adresse enregistrée), pas le numéro d’étudiant.',
    accountLabel: 'Compte CC98',
    accountPlaceholder: 'Identifiant du forum ou adresse enregistrée',
    accountHint: 'Ce n’est pas le numéro d’étudiant : le forum possède son propre système de comptes, et les deux peuvent être totalement différents.',
    passwordLabel: 'Mot de passe',
    passwordPlaceholderNew: 'Saisissez le mot de passe une fois',
    passwordPlaceholderKeep: 'Laisser vide pour conserver le mot de passe enregistré',
    passwordHintNew: 'Aucun mot de passe n’est encore enregistré : ce champ est donc obligatoire. Le mot de passe n’est jamais renvoyé à cette page.',
    passwordHintKeep: 'Un mot de passe est déjà enregistré : laissez vide pour le conserver, ou saisissez-en un nouveau. Le mot de passe n’est jamais renvoyé à cette page.',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    clear: 'Effacer',
    clearing: 'Effacement…',
    clearTitleReady: 'Supprimer le compte CC98 enregistré sur cette machine',
    clearTitleEmpty: 'Rien à effacer pour le moment',
    saved: 'Enregistré.',
    cleared: 'Effacé.',
    emptyAccount: 'Saisissez d’abord le compte',
    failed: 'Échec de l’enregistrement',
    reading: 'Lecture…',
    configuredAs: 'Configuré · {username}',
    notConfigured: 'Non configuré',
    credentialState: 'Identifiant',
    credentialReady: 'enregistré',
    credentialMissing: 'non enregistré',
    loginState: 'Session',
    loggedIn: 'connecté',
    loggedOut: 'déconnecté',
    unknown: 'inconnu',
    statusTitle: 'État',
    refresh: 'Actualiser l’état',
    refreshing: 'Actualisation…',
  },
  de: {
    section: 'CC98',
    intro: 'CC98 ist eine eigenständige Website: Sie verwendet das eigene Forumskonto (Forum-ID oder registrierte E-Mail), nicht die Matrikelnummer.',
    accountLabel: 'CC98-Konto',
    accountPlaceholder: 'Forum-ID oder registrierte E-Mail',
    accountHint: 'Nicht die Matrikelnummer – das Forum hat ein eigenes Kontosystem, und beides kann völlig verschieden sein.',
    passwordLabel: 'Passwort',
    passwordPlaceholderNew: 'Passwort einmal eingeben',
    passwordPlaceholderKeep: 'Leer lassen, um das gespeicherte Passwort zu behalten',
    passwordHintNew: 'Es ist noch kein Passwort gespeichert, daher ist dieses Feld erforderlich. Das Passwort wird nie an diese Seite zurückgegeben.',
    passwordHintKeep: 'Ein Passwort ist bereits gespeichert – leer lassen, um es zu behalten, oder ein neues eingeben. Das Passwort wird nie an diese Seite zurückgegeben.',
    save: 'Speichern',
    saving: 'Wird gespeichert…',
    clear: 'Löschen',
    clearing: 'Wird gelöscht…',
    clearTitleReady: 'Das gespeicherte CC98-Konto von diesem Rechner entfernen',
    clearTitleEmpty: 'Noch nichts zu löschen',
    saved: 'Gespeichert.',
    cleared: 'Gelöscht.',
    emptyAccount: 'Zuerst das Konto eingeben',
    failed: 'Speichern fehlgeschlagen',
    reading: 'Wird gelesen…',
    configuredAs: 'Konfiguriert · {username}',
    notConfigured: 'Nicht konfiguriert',
    credentialState: 'Zugangsdaten',
    credentialReady: 'gespeichert',
    credentialMissing: 'nicht gespeichert',
    loginState: 'Sitzung',
    loggedIn: 'angemeldet',
    loggedOut: 'nicht angemeldet',
    unknown: 'unbekannt',
    statusTitle: 'Status',
    refresh: 'Status aktualisieren',
    refreshing: 'Wird aktualisiert…',
  },
  ru: {
    section: 'CC98',
    intro: 'CC98 — самостоятельный сайт: он использует собственную учётную запись форума (ID форума или зарегистрированная почта), а не номер студенческого.',
    accountLabel: 'Учётная запись CC98',
    accountPlaceholder: 'ID форума или зарегистрированная почта',
    accountHint: 'Это не номер студенческого: у форума своя система учётных записей, и они могут полностью различаться.',
    passwordLabel: 'Пароль',
    passwordPlaceholderNew: 'Введите пароль один раз',
    passwordPlaceholderKeep: 'Оставьте пустым, чтобы сохранить сохранённый пароль',
    passwordHintNew: 'Пароль ещё не сохранён, поэтому это поле обязательно. Пароль никогда не возвращается на эту страницу.',
    passwordHintKeep: 'Пароль уже сохранён — оставьте поле пустым, чтобы сохранить его, или введите новый. Пароль никогда не возвращается на эту страницу.',
    save: 'Сохранить',
    saving: 'Сохранение…',
    clear: 'Очистить',
    clearing: 'Очистка…',
    clearTitleReady: 'Удалить сохранённую учётную запись CC98 с этого компьютера',
    clearTitleEmpty: 'Пока нечего очищать',
    saved: 'Сохранено.',
    cleared: 'Очищено.',
    emptyAccount: 'Сначала введите учётную запись',
    failed: 'Не удалось сохранить',
    reading: 'Чтение…',
    configuredAs: 'Настроено · {username}',
    notConfigured: 'Не настроено',
    credentialState: 'Учётные данные',
    credentialReady: 'сохранены',
    credentialMissing: 'не сохранены',
    loginState: 'Сессия',
    loggedIn: 'вход выполнен',
    loggedOut: 'вход не выполнен',
    unknown: 'неизвестно',
    statusTitle: 'Состояние',
    refresh: 'Обновить состояние',
    refreshing: 'Обновление…',
  },
  pt: {
    section: 'CC98',
    intro: 'O CC98 é um site independente: usa a própria conta do fórum (ID do fórum ou email registado), não o número de estudante.',
    accountLabel: 'Conta CC98',
    accountPlaceholder: 'ID do fórum ou email registado',
    accountHint: 'Não é o número de estudante — o fórum tem o seu próprio sistema de contas, e os dois podem ser completamente diferentes.',
    passwordLabel: 'Palavra-passe',
    passwordPlaceholderNew: 'Introduz a palavra-passe uma vez',
    passwordPlaceholderKeep: 'Deixa em branco para manter a palavra-passe guardada',
    passwordHintNew: 'Ainda não há palavra-passe guardada, por isso este campo é obrigatório. A palavra-passe nunca é devolvida a esta página.',
    passwordHintKeep: 'Já existe uma palavra-passe guardada — deixa em branco para a manter, ou escreve uma nova. A palavra-passe nunca é devolvida a esta página.',
    save: 'Guardar',
    saving: 'A guardar…',
    clear: 'Limpar',
    clearing: 'A limpar…',
    clearTitleReady: 'Remover a conta CC98 guardada neste computador',
    clearTitleEmpty: 'Ainda não há nada para limpar',
    saved: 'Guardada.',
    cleared: 'Limpa.',
    emptyAccount: 'Introduz primeiro a conta',
    failed: 'Falha ao guardar',
    reading: 'A ler…',
    configuredAs: 'Configurada · {username}',
    notConfigured: 'Não configurada',
    credentialState: 'Credencial',
    credentialReady: 'guardada',
    credentialMissing: 'não guardada',
    loginState: 'Sessão',
    loggedIn: 'sessão iniciada',
    loggedOut: 'sessão terminada',
    unknown: 'desconhecido',
    statusTitle: 'Estado',
    refresh: 'Atualizar estado',
    refreshing: 'A atualizar…',
  },
};

export function SettingsSection({ t }) {
  const [status, setStatus] = useState(null);
  const [account, setAccount] = useState(null);
  const [form, setForm] = useState({ username: '', password: '' });
  const [hasPassword, setHasPassword] = useState(false);
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  /**
   * 把宿主回的凭据视图落到界面。
   *
   * 密码框**永远留空**（见文件头）：只把「是否存过」记在 hasPassword 上。
   */
  const applyAccount = (view) => {
    setAccount({ configured: Boolean(view?.configured), username: view?.username ?? '' });
    setForm((current) => ({ username: view?.username ?? '', password: current.password }));
    setHasPassword(Boolean(view?.password));
  };

  useEffect(() => {
    let live = true;
    // 凭据视图与登录状态是两个端点：前者在 login 的半边，后者在本包的半边。
    void (async () => {
      try {
        const response = await fetch(CREDENTIAL_ROUTE, { headers: { Accept: 'application/json' } });
        if (response.ok && live) applyAccount((await response.json())?.cc98);
      } catch { /* 读不到就保持未配置，不把面板弄没 */ }
      try {
        const response = await fetch(ROUTE_PATH, { headers: { Accept: 'application/json' } });
        if (response.ok && live) {
          const payload = await response.json();
          // ⚠️ 与 `refresh()` 同样的信封剥离。**两条路径都要做** ——
          // 只改一条的表现是「首次打开显示未登录，点刷新才正常」，
          // 而用户大多数时候只看首次打开。
          setStatus(payload?.value ?? payload);
        }
      } catch { /* 同上 */ }
    })();
    return () => { live = false; };
  }, []);

  const working = busy !== null;
  const username = form.username.trim();
  const canSave = username.length > 0 && (form.password.length > 0 || hasPassword) && !working;

  const post = async (action, body) => {
    const response = await fetch(CREDENTIAL_ROUTE + '?' + action, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [WRITE_HEADER]: '1' },
      body: JSON.stringify(body ?? {}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.error ?? ('HTTP ' + response.status));
    return payload;
  };

  const save = async () => {
    if (username.length === 0) { setMessage({ tone: 'bad', text: t('emptyAccount') }); return; }
    setBusy('save');
    setMessage(null);
    try {
      const payload = await post('cc98-save', {
        username,
        // 留空 = 沿用已存的密码（与 login 的凭据写入同一套语义）。
        password: form.password.length > 0 ? form.password : MASK,
      });
      applyAccount(payload?.cc98);
      setForm((current) => ({ ...current, password: '' }));
      setMessage({ tone: 'ok', text: t('saved') });
    } catch (error) {
      setMessage({ tone: 'bad', text: t('failed') + ': ' + error.message });
    } finally {
      setBusy(null);
    }
  };

  const clear = async () => {
    setBusy('clear');
    setMessage(null);
    try {
      const payload = await post('cc98-clear', {});
      applyAccount(payload?.cc98);
      setForm({ username: '', password: '' });
      setMessage({ tone: 'ok', text: t('cleared') });
    } catch (error) {
      setMessage({ tone: 'bad', text: t('failed') + ': ' + error.message });
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    setBusy('refresh');
    try {
      const response = await fetch(ROUTE_PATH, { headers: { Accept: 'application/json' } });
      if (response.ok) {
        const payload = await response.json();
        // ⚠️ 本包的 GET 是 `{ ok: true, value: {...} }` 信封（与 xxt 同一套），
        // 而 campus 那边直接返回裸对象。**在这里统一剥掉 `value`**，
        // 取值处就只面对一种形状 —— 否则每个字段都要写 `a ?? b ?? c` 的多层兜底，
        // 少写一层就是「token 有效却显示未登录」（真机上正是如此）。
        setStatus(payload?.value ?? payload);
      }
    } catch { /* 保持上一份结论 */ } finally {
      setBusy(null);
    }
  };

  /**
   * 登录状态，取自**真实字段**。
   *
   * # 原来的 bug
   *
   * 判据是 `status?.value?.signedIn ?? status?.signedIn ?? status?.ok` ——
   * 三个字段都不存在：
   *
   *   - GET 返回 `{ ...describe(), status: { configured, authenticated, username, ... } }`
   *     所以登录态在 `status.status.authenticated`；
   *   - `signedIn` / `ok` 从头到尾没有过。
   *
   * 于是永远 `undefined`，界面恒显示「未知」。
   *
   * # 两个字段分开看
   *
   *   - `configured`：账号密码存没存（本机凭据）
   *   - `authenticated`：有没有有效的 access_token（能读数据）
   *
   * 「存了账号但 token 过期」是常见状态，合成一个布尔就说不清了。
   */
  // `refresh()` 已经把 GET 的 `value` 信封剥掉了，这里直接取 `status.status`。
  const state = status?.status ?? {};
  const configured = state.configured === true;
  const authenticated = state.authenticated === true;

  return (
    <Section>
      <PageTitle>{t('section')}</PageTitle>
      <Intro>{t('intro')}</Intro>

      <Rows>
        <Card
          title={account === null
            ? t('reading')
            : account.configured
              ? t('configuredAs').replace('{username}', account.username)
              : t('notConfigured')}
          actions={(
            <Actions>
              <button type="button" data-primary="" disabled={!canSave} onClick={() => { void save(); }}>
                {busy === 'save' ? t('saving') : t('save')}
              </button>
              <button
                type="button"
                disabled={working || account?.configured !== true}
                title={account?.configured === true ? t('clearTitleReady') : t('clearTitleEmpty')}
                onClick={() => { void clear(); }}
              >
                {busy === 'clear' ? t('clearing') : t('clear')}
              </button>
            </Actions>
          )}
        >
          <Field id="zcc98-account" label={t('accountLabel')} hint={t('accountHint')}>
            <input
              id="zcc98-account"
              className="zju-setting-input"
              type="text"
              autoComplete="off"
              spellCheck={false}
              maxLength={64}
              placeholder={t('accountPlaceholder')}
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              disabled={working}
            />
          </Field>
          <Field
            id="zcc98-password"
            label={t('passwordLabel')}
            hint={hasPassword ? t('passwordHintKeep') : t('passwordHintNew')}
          >
            <input
              id="zcc98-password"
              className="zju-setting-input"
              // type=password 只是遮蔽；加密与不回显由宿主凭据服务负责。
              type="password"
              autoComplete="new-password"
              placeholder={hasPassword ? t('passwordPlaceholderKeep') : t('passwordPlaceholderNew')}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              disabled={working}
            />
          </Field>
          {message !== null ? (
            <p className="zju-setting-hint" role="status">{message.text}</p>
          ) : null}
        </Card>

        <Card
          title={t('statusTitle')}
          // 纯状态卡默认收起：它只是确认「通没通」，不必常驻占版面。
          defaultOpen={false}
          actions={(
            <Actions>
              <button type="button" disabled={working} onClick={() => { void refresh(); }}>
                {busy === 'refresh' ? t('refreshing') : t('refresh')}
              </button>
            </Actions>
          )}
        >
          {/* 两行分开：账号存没存 与 token 有没有效 是两件事。
              「存了账号但 token 过期」很常见，合成一个布尔就说不清了。 */}
          <StatusLine
            label={t('credentialState')}
            value={configured ? t('credentialReady') : t('credentialMissing')}
            tone={configured ? 'ok' : 'warn'}
          />
          <StatusLine
            label={t('loginState')}
            value={authenticated ? t('loggedIn') : t('loggedOut')}
            tone={authenticated ? 'ok' : 'warn'}
          />
        </Card>
      </Rows>
    </Section>
  );
}

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zjuCc98SettingsStyle', css: SETTINGS_CSS, label: 'zju: cc98 settings styles' });
  const text = registerText(ctx, NAMESPACE, TEXT);
  ctx.effect(() => () => text.dispose(), 'zju: cc98 settings i18n');
  // order 64：排在统一身份认证（60）与教务（62）之后 —— CC98 是论坛，不是学业数据源。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'zju-source-cc98',
    order: 64,
    label: () => text.t('section'),
  }, () => React.createElement(SettingsSection, { t: text.t })));
}
