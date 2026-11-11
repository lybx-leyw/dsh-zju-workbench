/**
 * 「浙大邮箱」设置分区。
 *
 * # 为什么它是独立分区，不并进「浙大一卡通」
 *
 * 邮箱用的是**它自己的账号与密码**（`auth: "own"`）。它和统一身份认证
 * 不是同一套凭据 —— 把两块并在一起会让用户以为「填了一卡通就能收信」，
 * 然后在校外遇到认证失败时无从判断是哪一份不对。
 *
 * 这与拼题A / 学习通 / 实验课平台是同一条：**一个数据源一组凭证，占一个分区**。
 *
 * # 这一页不替邮箱裁决账号形态
 *
 * 服务端接受学号、完整地址还是别的写法，**我们不知道**。所以输入框不做格式
 * 裁决，只要求非空 —— 猜错格式会报一个「格式不对」，而用户填的其实是对的。
 * 真正的判据是「点检测连接，IMAP 认不认」。
 *
 * 同理，密码框也不假设它是哪一种密码（客户端专用密码 / 邮箱自己的密码 /
 * 其它服务端认的串）。判断权在 IMAP。
 *
 * # 路由协议（照本包 `src/index.js`）
 *
 * ```text
 *   POST /api/zhiyun-mail   { action: 'mail.snapshot' }
 *   POST /api/zhiyun-mail   { action: 'mail.saveAccount', input: { address, password } }
 *   POST /api/zhiyun-mail   { action: 'mail.clearAccount' }
 *   POST /api/zhiyun-mail   { action: 'mail.test' }
 * ```
 *
 * 动作名是 `mail.xxx`（与方法表一致），写错不会报「未知动作」以外的线索，
 * 所以两边必须逐字对齐。
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
  registerText,
} from '@lybx-leyw/dsh-zju-ui-shared';

const ROUTE_PATH = '/api/zhiyun-mail';
const NAMESPACE = 'zju-source-mail';
const SECTION_ID = 'zju-source-mail';

export const name = 'zhiyun-source-mail-client';

/** 只要插槽与本地化。 */
export const inject = ['slots', 'locale'];

/**
 * 文案。
 *
 * 8 种语言是硬要求：本仓的 `i18n-locales.test.mjs` 会检查每个设置分区的
 * 字典键集合与 `en` 完全一致，漏一种会让守卫变红。
 */
export const TEXT = {
  zh: {
    section: '浙大邮箱',
    intro: '邮箱用**16 位客户端专用密码**认证（在邮箱网页版「设置 → 安全设置 → 客户端专用密码」生成），与「浙大一卡通」不是同一份。',
    accountLabel: '邮箱账号',
    accountHint: '完整地址，如 1234567890@zju.edu.cn',
    passwordLabel: '客户端专用密码',
    passwordHint: '16 位，在邮箱网页版生成（不是统一身份认证密码）',
    saved: '已保存。下次读取邮件时会用这份账号连接。',
    cleared: '已清除。邮箱相关功能会退回未配置状态。',
    save: '保存',
    clear: '清除',
    saving: '保存中…',
    clearing: '清除中…',
    configuredAs: '已配置 · {address}',
    notConfigured: '未配置',
    empty: '请填写邮箱账号与密码',
    failed: '保存失败',
    statusTitle: '连接状态',
    statusLine: '邮箱连接',
    statusReady: '已配置，尚未连接',
    statusConnected: '已连接',
    statusNeedsCredential: '还没配账号',
    statusUnknown: '未检测',
    check: '检测连接',
    checking: '检测中…',
    checkOk: '连接成功：IMAP 与 SMTP 都通过了认证',
    checkFailed: '连接失败',
    checkFailedUnknown: '服务器没有给出原因',
  },
  en: {
    section: 'ZJU Mail',
    intro: 'Mail authenticates with a 16-character app password (generate one at Settings → Security → App password in the mail web UI). This is not the ZJU unified sign-in.',
    accountLabel: 'Mail account',
    accountHint: 'full address, e.g. 1234567890@zju.edu.cn',
    passwordLabel: 'App password',
    passwordHint: '16 characters, generated in the mail web UI (not your CAS password)',
    saved: 'Saved. Mail reads will use this account.',
    cleared: 'Cleared. Mail features return to unconfigured.',
    save: 'Save',
    clear: 'Clear',
    saving: 'Saving…',
    clearing: 'Clearing…',
    configuredAs: 'Configured · {address}',
    notConfigured: 'Not configured',
    empty: 'Enter both account and password',
    failed: 'Save failed',
    statusTitle: 'Connection',
    statusLine: 'Mail connection',
    statusReady: 'Configured, not connected yet',
    statusConnected: 'Connected',
    statusNeedsCredential: 'No account configured',
    statusUnknown: 'Not checked',
    check: 'Check connection',
    checking: 'Checking…',
    checkOk: 'Connected: IMAP and SMTP both authenticated',
    checkFailed: 'Connection failed',
    checkFailedUnknown: 'the server gave no reason',
  },
  ja: {
    section: '浙大メール',
    intro: 'メールは16桁の**クライアント専用パスワード**で認証します（メールのウェブ画面「設定 → セキュリティ → クライアント専用パスワード」で生成）。統一認証とは別です。',
    accountLabel: 'メールアカウント',
    accountHint: '完全なアドレス（例 1234567890@zju.edu.cn）',
    passwordLabel: 'クライアント専用パスワード',
    passwordHint: '16桁、メールのウェブ画面で生成（統一認証のパスワードではありません）',
    saved: '保存しました。次回の読み取りでこのアカウントを使います。',
    cleared: '削除しました。メール機能は未設定に戻ります。',
    save: '保存',
    clear: '削除',
    saving: '保存中…',
    clearing: '削除中…',
    configuredAs: '設定済み · {address}',
    notConfigured: '未設定',
    empty: 'アカウントとパスワードを入力してください',
    failed: '保存に失敗しました',
    statusTitle: '接続状態',
    statusLine: 'メール接続',
    statusReady: '設定済み・未接続',
    statusConnected: '接続済み',
    statusNeedsCredential: 'アカウント未設定',
    statusUnknown: '未確認',
    check: '接続を確認',
    checking: '確認中…',
    checkOk: '接続成功：IMAP と SMTP の両方が認証されました',
    checkFailed: '接続に失敗しました',
    checkFailedUnknown: 'サーバーからの理由はありません',
  },
  es: {
    section: 'Correo ZJU',
    intro: 'El correo se autentica con una **contraseña de aplicación de 16 caracteres** (genérala en Ajustes → Seguridad → Contraseña de aplicación). No es el inicio de sesión unificado.',
    accountLabel: 'Cuenta de correo',
    accountHint: 'dirección completa, p. ej. 1234567890@zju.edu.cn',
    passwordLabel: 'Contraseña de aplicación',
    passwordHint: '16 caracteres, generada en la web del correo (no la de CAS)',
    saved: 'Guardado. Las lecturas usarán esta cuenta.',
    cleared: 'Borrado. El correo vuelve a sin configurar.',
    save: 'Guardar',
    clear: 'Borrar',
    saving: 'Guardando…',
    clearing: 'Borrando…',
    configuredAs: 'Configurado · {address}',
    notConfigured: 'Sin configurar',
    empty: 'Introduce cuenta y contraseña',
    failed: 'Error al guardar',
    statusTitle: 'Conexión',
    statusLine: 'Conexión de correo',
    statusReady: 'Configurado, sin conectar',
    statusConnected: 'Conectado',
    statusNeedsCredential: 'Sin cuenta',
    statusUnknown: 'Sin comprobar',
    check: 'Comprobar conexión',
    checking: 'Comprobando…',
    checkOk: 'Conectado: IMAP y SMTP autenticados',
    checkFailed: 'Error de conexión',
    checkFailedUnknown: 'el servidor no dio motivo',
  },
  fr: {
    section: 'Courriel ZJU',
    intro: 'Le courriel s’authentifie avec un **mot de passe d’application de 16 caractères** (à générer dans Réglages → Sécurité). Ce n’est pas la connexion unifiée.',
    accountLabel: 'Compte de courriel',
    accountHint: 'adresse complète, ex. 1234567890@zju.edu.cn',
    passwordLabel: 'Mot de passe d’application',
    passwordHint: '16 caractères, généré dans l’interface web (pas celui du CAS)',
    saved: 'Enregistré. Les lectures utiliseront ce compte.',
    cleared: 'Supprimé. Le courriel revient à non configuré.',
    save: 'Enregistrer',
    clear: 'Supprimer',
    saving: 'Enregistrement…',
    clearing: 'Suppression…',
    configuredAs: 'Configuré · {address}',
    notConfigured: 'Non configuré',
    empty: 'Saisissez le compte et le mot de passe',
    failed: 'Échec de l’enregistrement',
    statusTitle: 'Connexion',
    statusLine: 'Connexion courriel',
    statusReady: 'Configuré, non connecté',
    statusConnected: 'Connecté',
    statusNeedsCredential: 'Aucun compte',
    statusUnknown: 'Non vérifié',
    check: 'Vérifier la connexion',
    checking: 'Vérification…',
    checkOk: 'Connecté : IMAP et SMTP authentifiés',
    checkFailed: 'Échec de la connexion',
    checkFailedUnknown: 'le serveur n’a pas donné de raison',
  },
  de: {
    section: 'ZJU-Mail',
    intro: 'Mail authentifiziert sich mit einem **16-stelligen App-Passwort** (erzeugen unter Einstellungen → Sicherheit). Das ist nicht die zentrale Anmeldung.',
    accountLabel: 'Mail-Konto',
    accountHint: 'vollständige Adresse, z. B. 1234567890@zju.edu.cn',
    passwordLabel: 'App-Passwort',
    passwordHint: '16 Zeichen, in der Web-Oberfläche erzeugt (nicht das CAS-Passwort)',
    saved: 'Gespeichert. Lesezugriffe nutzen dieses Konto.',
    cleared: 'Gelöscht. Mail ist wieder nicht konfiguriert.',
    save: 'Speichern',
    clear: 'Löschen',
    saving: 'Speichern…',
    clearing: 'Löschen…',
    configuredAs: 'Konfiguriert · {address}',
    notConfigured: 'Nicht konfiguriert',
    empty: 'Konto und Passwort eingeben',
    failed: 'Speichern fehlgeschlagen',
    statusTitle: 'Verbindung',
    statusLine: 'Mail-Verbindung',
    statusReady: 'Konfiguriert, nicht verbunden',
    statusConnected: 'Verbunden',
    statusNeedsCredential: 'Kein Konto',
    statusUnknown: 'Nicht geprüft',
    check: 'Verbindung prüfen',
    checking: 'Prüfe…',
    checkOk: 'Verbunden: IMAP und SMTP authentifiziert',
    checkFailed: 'Verbindung fehlgeschlagen',
    checkFailedUnknown: 'der Server nannte keinen Grund',
  },
  ru: {
    section: 'Почта ZJU',
    intro: 'Почта аутентифицируется **16-символьным паролем приложения** (создаётся в веб-интерфейсе: Настройки → Безопасность). Это не единый вход.',
    accountLabel: 'Учётная запись почты',
    accountHint: 'полный адрес, напр. 1234567890@zju.edu.cn',
    passwordLabel: 'Пароль приложения',
    passwordHint: '16 символов, создаётся в веб-интерфейсе (не пароль CAS)',
    saved: 'Сохранено. Чтения будут использовать эту запись.',
    cleared: 'Удалено. Почта вернулась в не настроенное состояние.',
    save: 'Сохранить',
    clear: 'Удалить',
    saving: 'Сохранение…',
    clearing: 'Удаление…',
    configuredAs: 'Настроено · {address}',
    notConfigured: 'Не настроено',
    empty: 'Введите логин и пароль',
    failed: 'Не удалось сохранить',
    statusTitle: 'Соединение',
    statusLine: 'Соединение почты',
    statusReady: 'Настроено, не подключено',
    statusConnected: 'Подключено',
    statusNeedsCredential: 'Нет учётной записи',
    statusUnknown: 'Не проверено',
    check: 'Проверить соединение',
    checking: 'Проверка…',
    checkOk: 'Подключено: IMAP и SMTP прошли проверку',
    checkFailed: 'Не удалось подключиться',
    checkFailedUnknown: 'сервер не указал причину',
  },
  pt: {
    section: 'Correio ZJU',
    intro: 'O correio autentica com uma **palavra-passe de aplicação de 16 caracteres** (gere em Definições → Segurança). Não é o login unificado.',
    accountLabel: 'Conta de correio',
    accountHint: 'endereço completo, ex. 1234567890@zju.edu.cn',
    passwordLabel: 'Palavra-passe de aplicação',
    passwordHint: '16 caracteres, gerada na interface web (não a do CAS)',
    saved: 'Guardado. As leituras usarão esta conta.',
    cleared: 'Removido. O correio volta a não configurado.',
    save: 'Guardar',
    clear: 'Remover',
    saving: 'A guardar…',
    clearing: 'A remover…',
    configuredAs: 'Configurado · {address}',
    notConfigured: 'Não configurado',
    empty: 'Introduza conta e palavra-passe',
    failed: 'Falha ao guardar',
    statusTitle: 'Ligação',
    statusLine: 'Ligação de correio',
    statusReady: 'Configurado, sem ligação',
    statusConnected: 'Ligado',
    statusNeedsCredential: 'Sem conta',
    statusUnknown: 'Não verificado',
    check: 'Verificar ligação',
    checking: 'A verificar…',
    checkOk: 'Ligado: IMAP e SMTP autenticados',
    checkFailed: 'Falha na ligação',
    checkFailedUnknown: 'o servidor não indicou o motivo',
  },
};

/**
 * 调一次本包的路由。
 *
 * ⚠️ **一律 POST，且必须带 `action`**：这个路由（`src/index.js`）不区分
 * GET/POST，它总是读请求体里的 `action`，没有就报「不认识的操作」。
 *
 * @param action - 动作名（`mail.snapshot` 等）。
 * @param input - 参数。
 * @returns 路由返回的 `value`。
 */
async function rpc(action, input = undefined) {
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
  const [form, setForm] = useState({ address: '', password: '' });
  const [busy, setBusy] = useState(null);
  const [message, setMessage] = useState(null);

  /**
   * 两张卡片的展开状态 —— 与其余数据源分区同一套规矩：
   * 配好收起凭证、展开状态；没配则反过来。
   *
   * `undefined` = 还没读到 status，按默认走。不能用 `defaultOpen`：它是
   * `useState` 初值，只在挂载时生效，而配置状态是异步读回来的。
   */
  const [credentialOpen, setCredentialOpen] = useState(undefined);
  const [statusOpen, setStatusOpen] = useState(undefined);

  const refresh = useCallback(async () => {
    try {
      const value = await rpc('mail.snapshot');
      setStatus(value ?? null);
      const configured = value?.ready === true;
      setCredentialOpen(!configured);
      setStatusOpen(configured);
    } catch {
      /* 读不到就保持上一份结论 —— 不该把整块变成错误 */
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const save = async () => {
    if (!form.address.trim() || !form.password) {
      setMessage({ tone: 'bad', text: t('empty') });
      return;
    }
    setBusy('save');
    setMessage(null);
    try {
      await rpc('mail.saveAccount', { address: form.address.trim(), password: form.password });
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
      await rpc('mail.clearAccount');
      setForm({ address: '', password: '' });
      setMessage({ tone: 'ok', text: t('cleared') });
      await refresh();
    } catch (error) {
      setMessage({ tone: 'bad', text: `${t('failed')}: ${error.message}` });
    } finally {
      setBusy(null);
    }
  };

  /**
   * 「检测连接」：**真的连一次** IMAP + SMTP。
   *
   * `snapshot` 只读本地状态，不联网 —— 拿它当「检测」等于什么都没测。
   * 这一下真的做认证，所以只在用户点按钮时执行。
   */
  const check = async () => {
    setBusy('check');
    setMessage(null);
    try {
      const result = await rpc('mail.test');
      if (result?.imap && result?.smtp) {
        setStatus({ ready: true, connected: true, address: result.address ?? '' });
        setMessage({ tone: 'ok', text: t('checkOk') });
      } else {
        setMessage({
          tone: 'bad',
          text: `${t('checkFailed')}: ${result?.error ?? t('checkFailedUnknown')}`,
        });
      }
      await refresh();
    } catch (error) {
      setMessage({ tone: 'bad', text: `${t('checkFailed')}: ${error.message}` });
    } finally {
      setBusy(null);
    }
  };

  const configured = status?.ready === true;
  const connected = status?.connected === true;

  return (
    <Section>
      <PageTitle>{t('section')}</PageTitle>
      <Intro>{t('intro')}</Intro>

      <Rows>
        <Card
          open={credentialOpen}
          onOpenChange={setCredentialOpen}
          title={t('section')}
          detail={configured
            ? t('configuredAs').replace('{address}', status?.address ?? '')
            : t('notConfigured')}
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
          <Field id="zcd-mail-account" label={t('accountLabel')} hint={t('accountHint')}>
            <input
              id="zcd-mail-account"
              className="zju-setting-input"
              type="text"
              autoComplete="username"
              value={form.address}
              onChange={(event) => setForm((prev) => ({ ...prev, address: event.target.value }))}
            />
          </Field>
          <Field id="zcd-mail-password" label={t('passwordLabel')} hint={t('passwordHint')}>
            <input
              id="zcd-mail-password"
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
          open={statusOpen}
          onOpenChange={setStatusOpen}
          title={t('statusTitle')}
          actions={(
            <Actions>
              <button type="button" disabled={busy !== null || !configured} onClick={() => { void check(); }}>
                {busy === 'check' ? t('checking') : t('check')}
              </button>
            </Actions>
          )}
        >
          <StatusLine
            label={t('statusLine')}
            value={status === null
              ? t('statusUnknown')
              : connected
                ? t('statusConnected')
                : configured
                  ? t('statusReady')
                  : t('statusNeedsCredential')}
            tone={connected ? 'ok' : 'warn'}
          />
        </Card>
      </Rows>
    </Section>
  );
}

/**
 * 注册设置分区。
 *
 * `order` 取 66：一卡通 60、实验课平台 62、CC98 64 —— 邮箱排在它们之后，
 * 它是独立账号，且不参与每日的课程/作业流程。
 *
 * @param ctx - 客户端上下文。
 */
export function apply(ctx) {
  const text = registerText(ctx, NAMESPACE, TEXT);
  ctx.effect(() => () => text.dispose(), 'zju: mail settings i18n');

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: SECTION_ID,
    order: 66,
    label: () => text.t('section'),
  }, () => React.createElement(SettingsSection, { t: text.t })));
}
