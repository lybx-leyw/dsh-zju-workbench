// 「浙大一卡通」的设置分区（客户端半边）。
//
// # 它为什么在设置里，而不在某一页里
//
// 这份凭证是**智云课堂与学在浙大共用**的：进课堂上课要用它，看待办也要用它。
// 挂在任何一个页面上，都会让另一件事看起来"也得先去那一页登录一次"。设置是
// 两件不相关的事唯一的公共落点，所以它住在这里。
//
// 与 `@lybx-leyw/dsh-zju-source-login` 的宿主半边分工：**凭据只在宿主那边读写**（加密、不回显），
// 这个文件只负责把用户填的两个字段 POST 过去，再把它回的"已配置 / 未配置"画出来。
// 客户端一行持久化都不碰 —— 凭证不进任何浏览器侧的存储，配置页刷新一次就重新从
// 宿主读（见 `load` 那一段），所以"页面里能翻到上次的密码"这件事不可能发生。
//
// # 两个容易写错的地方
//
//   1. **不能包 `<details>` / `.zw-settings-group`。** 壳里的 `PersonalSettingsBridge`
//      已经为每个 `settings.section` 画好了外层折叠分组（图标 + 标题 + 副标题 + chevron），
//      再包一层就是"壳套壳"两个折叠框、两个标题。本组件直接返回 `<form>`。
//      参考 `@lybx-leyw/dsh-zju-page-paper/src/SettingsSection.jsx`。
//   2. **常量从 `./shared.js` 取，不从 `./index.js` 取。** 那个文件是宿主半边，
//      import 它会把 `apply` 与 `node:fs` 一起打进浏览器产物（见 `shared.js` 顶部）。
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
import css from './style.css';
import { MASK, ROUTE_PATH, WRITE_HEADER, errorText } from './shared.js';

export const name = 'zw-login-client';

/** 只要插槽：这一块不依赖任何领域服务，凭据由宿主半边负责。 */
export const inject = ['slots', 'locale'];

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

/**
 * 分区标题的双语字典。
 *
 * # 为什么改用 `registerText` 而不是自己判语言
 *
 * 上一版读 `locale.language`，而 0.2.2-rc.1 的真实字段是 `getLocale().active`
 * —— 于是永远走兜底分支，标题恒为中文（界面明明是英文）。同时这个包没把
 * `locale` 写进 `inject`，连取都取不到（会被注入门禁拒绝）。
 *
 * `registerText` 内部走宿主的 `locale.bind(ns)`，语言判断与回退链都交给宿主。
 *
 * # 为什么只翻标题
 *
 * 面板正文有几十条文案（保存 / 清除 / 各类错误说明）。逐条翻译需要审一遍
 * 中文措辞，是另一件事；但「标题不翻」会直接表现为「设置页一列中文挂在
 * 英文界面里」，所以先把它接上。正文仍是中文，这是**已知且有意**的中间状态。
 */
const TEXT = {
  zh: {
    section: '浙大统一身份认证',
    intro: '这里填的是浙大统一身份认证（CAS）的学号与密码。智云课堂与学在浙大共用这一份，填一次即可。',
    accountLabel: '账号',
    accountHint: '学号本身不是秘密，所以会回显出来 —— 用来确认配的是哪个账号。',
    accountPlaceholder: '统一身份认证账号',
    passwordLabel: '密码',
    passwordHintNew: '还没有存过密码，这一项必填。密码里的空格是密码的一部分，不会被裁掉；密码不会回传到这个页面。',
    passwordHintKeep: '已存着密码，这里留空即沿用；要换密码直接重填。密码里的空格是密码的一部分，不会被裁掉；密码不会回传到这个页面。',
    secretStateReady: '已存密码',
    secretStateEmpty: '无密码',
    save: '保存',
    saving: '正在保存…',
    clear: '清除',
    clearing: '正在清除…',
    clearTitleReady: '清掉本机保存的账号密码',
    clearTitleEmpty: '还没有可清除的凭证',
    reading: '正在读取…',
    configuredAs: '已配置 · {username}',
    notConfigured: '未配置',
    savedHint: '已保存。智云课堂与学在浙大都会用这一份凭证。',
    clearedHint: '已清除。两处都会退回还没登录的状态。',
    vpnSection: 'WebVPN 上网账号',
    vpnIntro: '只在校外需要。它属于学校网络中心，与上面的统一身份认证是两套系统：账号通常都是学号，密码可能不同。',
    vpnAccountLabel: '上网账号',
    vpnAccountHint: '不确定密码的话，先在浏览器登录一次 webvpn.zju.edu.cn 试试。',
    vpnAccountPlaceholder: '上网账号（通常与学号相同）',
    vpnPasswordLabel: '上网密码',
    vpnPasswordHintNew: '还没存过上网密码。它不是统一身份认证的密码。',
    vpnPasswordHintKeep: '已存着密码，留空即沿用。它不是统一身份认证的密码。',
    vpnSave: '保存上网账号',
    vpnSavedHint: 'WebVPN 上网账号已保存。只有在校外访问学在浙大时才会用到它。',
    vpnClearedHint: 'WebVPN 上网账号已清除。',
    vpnConfiguredAs: '已配置 · {username}',
    vpnNotConfigured: '未配置（只在校外需要）',
    sourcesTitle: '这份凭据的用途',
    sourceCampus: '学在浙大',
    sourceClassroom: '智云课堂',
    sourceZdbk: '教务',
    sourceXuezaiSession: '学在浙大会话',

    sourceSztz: '二课',
    sourceTyys: '体育场馆',
    sourceNotice: '通知',

    sourceUnknown: '未检测',
    sourcesAt: '上次检测于 {time}',
    sourcesNever: '从未检测过',
    probe: '重新检测',
    probing: '检测中…',
    probeDone: '检测完成',
    sourceOk: '可用',
    sourceNeedsLogin: '登录失败',
    sourceNeedsCredential: '未配凭据',
    sourceTimeout: '探测超时',
    sourceOffCampus: '校外未通',
    sourceDisabled: '数据源未启用',
  },
  en: {
    section: 'ZJU unified sign-in',
    intro: 'These are the ZJU unified sign-in (CAS) credentials. Zhiyun Classroom and XueZaiZJU share this one record, so it is filled in once.',
    accountLabel: 'Account',
    accountHint: 'A student ID is not a secret, so it is echoed back — that is how you confirm which account is configured.',
    accountPlaceholder: 'Unified sign-in account',
    passwordLabel: 'Password',
    passwordHintNew: 'No password is stored yet, so this one is required. Spaces are part of the password and are not trimmed; the password is never sent back to this page.',
    passwordHintKeep: 'A password is already stored — leave this blank to keep it, or type a new one to replace it. Spaces are part of the password and are not trimmed; the password is never sent back to this page.',
    secretStateReady: 'password stored',
    secretStateEmpty: 'no password',
    save: 'Save',
    saving: 'Saving…',
    clear: 'Clear',
    clearing: 'Clearing…',
    clearTitleReady: 'Remove the saved credentials from this machine',
    clearTitleEmpty: 'Nothing to clear yet',
    reading: 'Reading…',
    configuredAs: 'Configured · {username}',
    notConfigured: 'Not configured',
    savedHint: 'Saved. Zhiyun Classroom and XueZaiZJU both use this record.',
    clearedHint: 'Cleared. Both fall back to the signed-out state.',
    vpnSection: 'WebVPN account',
    vpnIntro: 'Needed only off campus. It belongs to the university network centre and is a separate system from the unified sign-in above: the account is usually the student ID, but the password may differ.',
    vpnAccountLabel: 'WebVPN account',
    vpnAccountHint: 'If unsure about the password, sign in to webvpn.zju.edu.cn in a browser once to check.',
    vpnAccountPlaceholder: 'WebVPN account (usually the student ID)',
    vpnPasswordLabel: 'WebVPN password',
    vpnPasswordHintNew: 'No WebVPN password is stored yet. It is not the unified sign-in password.',
    vpnPasswordHintKeep: 'A password is already stored — leave this blank to keep it. It is not the unified sign-in password.',
    vpnSave: 'Save WebVPN account',
    vpnSavedHint: 'WebVPN account saved. It is used only when reaching XueZaiZJU from off campus.',
    vpnClearedHint: 'WebVPN account cleared.',
    vpnConfiguredAs: 'Configured · {username}',
    vpnNotConfigured: 'Not configured (off campus only)',
    sourcesTitle: 'What this credential unlocks',
    sourceCampus: 'XueZaiZJU',
    sourceClassroom: 'Zhiyun Classroom',
    sourceZdbk: 'Academic affairs',
    sourceXuezaiSession: 'XueZaiZJU session',

    sourceSztz: 'Extracurricular',
    sourceTyys: 'Sports venues',
    sourceNotice: 'Notices',

    sourceUnknown: 'Not checked',
    sourcesAt: 'Last checked at {time}',
    sourcesNever: 'Never checked',
    probe: 'Check now',
    probing: 'Checking…',
    probeDone: 'Check complete',
    sourceOk: 'available',
    sourceNeedsLogin: 'sign-in failed',
    sourceNeedsCredential: 'no credential',
    sourceTimeout: 'probe timed out',
    sourceOffCampus: 'no off-campus route',
    sourceDisabled: 'source not enabled',
  },
  ja: {
    section: '浙江大学 統一認証',
    intro: '浙江大学の統一認証（CAS）の学籍番号とパスワードです。智雲教室と学在浙大はこの 1 件を共有するため、入力は一度で済みます。',
    accountLabel: 'アカウント',
    accountHint: '学籍番号自体は秘密ではないため、設定済みのアカウントを確認できるよう表示されます。',
    accountPlaceholder: '統一認証アカウント',
    passwordLabel: 'パスワード',
    passwordHintNew: 'まだパスワードが保存されていないため、この項目は必須です。パスワード内の空白もパスワードの一部であり、削除されません。パスワードがこのページに返ることはありません。',
    passwordHintKeep: 'パスワードは保存済みです。空欄のままにすると既存のものを使用します。変更する場合は入力し直してください。パスワード内の空白もパスワードの一部であり、削除されません。パスワードがこのページに返ることはありません。',
    secretStateReady: 'パスワード保存済み',
    secretStateEmpty: 'パスワードなし',
    save: '保存',
    saving: '保存中…',
    clear: '消去',
    clearing: '消去中…',
    clearTitleReady: 'この端末に保存された認証情報を削除します',
    clearTitleEmpty: '消去できる認証情報はまだありません',
    reading: '読み取り中…',
    configuredAs: '設定済み · {username}',
    notConfigured: '未設定',
    savedHint: '保存しました。智雲教室と学在浙大の両方がこの認証情報を使用します。',
    clearedHint: '消去しました。両方とも未サインイン状態に戻ります。',
    vpnSection: 'WebVPN アカウント',
    vpnIntro: '学外でのみ必要です。大学のネットワークセンターが管理する別システムで、上記の統一認証とは別物です。アカウントは通常学籍番号と同じですが、パスワードは異なる場合があります。',
    vpnAccountLabel: 'WebVPN アカウント',
    vpnAccountHint: 'パスワードが不明な場合は、まずブラウザで webvpn.zju.edu.cn に一度サインインして確認してください。',
    vpnAccountPlaceholder: 'WebVPN アカウント（通常は学籍番号）',
    vpnPasswordLabel: 'WebVPN パスワード',
    vpnPasswordHintNew: 'WebVPN パスワードはまだ保存されていません。統一認証のパスワードとは別物です。',
    vpnPasswordHintKeep: 'パスワードは保存済みです。空欄のままにすると既存のものを使用します。統一認証のパスワードとは別物です。',
    vpnSave: 'WebVPN アカウントを保存',
    vpnSavedHint: 'WebVPN アカウントを保存しました。学外から学在浙大にアクセスするときのみ使用します。',
    vpnClearedHint: 'WebVPN アカウントを消去しました。',
    vpnConfiguredAs: '設定済み · {username}',
    vpnNotConfigured: '未設定（学外でのみ必要）',
    sourcesTitle: 'この認証情報で利用できるもの',
    sourceCampus: '学在浙大',
    sourceClassroom: '智雲教室',
    sourceZdbk: '教務',
    sourceXuezaiSession: '学在浙大セッション',

    sourceSztz: '課外活動',
    sourceTyys: '体育施設',
    sourceNotice: 'お知らせ',

    sourceUnknown: '未確認',
    sourcesAt: '最終確認 {time}',
    sourcesNever: '未確認',
    probe: '再確認',
    probing: '確認中…',
    probeDone: '確認完了',
    sourceOk: '利用可能',
    sourceNeedsLogin: 'サインイン失敗',
    sourceNeedsCredential: '認証情報なし',
    sourceTimeout: '検出タイムアウト',
    sourceOffCampus: '学外から未接続',
    sourceDisabled: 'データソース未启用',
  },
  es: {
    section: 'Inicio de sesión unificado de la ZJU',
    intro: 'Son las credenciales del inicio de sesión unificado (CAS) de la ZJU. El Aula Zhiyun y XueZaiZJU comparten este único registro, así que se rellena una sola vez.',
    accountLabel: 'Cuenta',
    accountHint: 'El número de estudiante no es un secreto, por eso se muestra: así confirmas qué cuenta está configurada.',
    accountPlaceholder: 'Cuenta del inicio de sesión unificado',
    passwordLabel: 'Contraseña',
    passwordHintNew: 'Todavía no hay contraseña guardada, así que este campo es obligatorio. Los espacios forman parte de la contraseña y no se recortan; la contraseña nunca se devuelve a esta página.',
    passwordHintKeep: 'Ya hay una contraseña guardada: déjalo en blanco para conservarla o escribe una nueva. Los espacios forman parte de la contraseña y no se recortan; la contraseña nunca se devuelve a esta página.',
    secretStateReady: 'contraseña guardada',
    secretStateEmpty: 'sin contraseña',
    save: 'Guardar',
    saving: 'Guardando…',
    clear: 'Borrar',
    clearing: 'Borrando…',
    clearTitleReady: 'Eliminar las credenciales guardadas en este equipo',
    clearTitleEmpty: 'Todavía no hay nada que borrar',
    reading: 'Leyendo…',
    configuredAs: 'Configurada · {username}',
    notConfigured: 'No configurada',
    savedHint: 'Guardada. El Aula Zhiyun y XueZaiZJU usan este registro.',
    clearedHint: 'Borrada. Ambas vuelven al estado sin sesión.',
    vpnSection: 'Cuenta de WebVPN',
    vpnIntro: 'Solo se necesita fuera del campus. Pertenece al centro de redes de la universidad y es un sistema aparte del inicio de sesión unificado anterior: la cuenta suele ser el número de estudiante, pero la contraseña puede diferir.',
    vpnAccountLabel: 'Cuenta de WebVPN',
    vpnAccountHint: 'Si no estás seguro de la contraseña, inicia sesión una vez en webvpn.zju.edu.cn desde el navegador para comprobarlo.',
    vpnAccountPlaceholder: 'Cuenta de WebVPN (normalmente el número de estudiante)',
    vpnPasswordLabel: 'Contraseña de WebVPN',
    vpnPasswordHintNew: 'Todavía no hay contraseña de WebVPN guardada. No es la del inicio de sesión unificado.',
    vpnPasswordHintKeep: 'Ya hay una contraseña guardada: déjalo en blanco para conservarla. No es la del inicio de sesión unificado.',
    vpnSave: 'Guardar cuenta de WebVPN',
    vpnSavedHint: 'Cuenta de WebVPN guardada. Solo se usa para llegar a XueZaiZJU desde fuera del campus.',
    vpnClearedHint: 'Cuenta de WebVPN borrada.',
    vpnConfiguredAs: 'Configurada · {username}',
    vpnNotConfigured: 'No configurada (solo fuera del campus)',
    sourcesTitle: 'Qué desbloquea esta credencial',
    sourceCampus: 'XueZaiZJU',
    sourceClassroom: 'Aula Zhiyun',
    sourceZdbk: 'Asuntos académicos',
    sourceXuezaiSession: 'Sesión XueZaiZJU',

    sourceSztz: 'Extracurriculares',
    sourceTyys: 'Instalaciones deportivas',
    sourceNotice: 'Avisos',

    sourceUnknown: 'Sin comprobar',
    sourcesAt: 'Última comprobación {time}',
    sourcesNever: 'Nunca comprobado',
    probe: 'Comprobar',
    probing: 'Comprobando…',
    probeDone: 'Comprobación lista',
    sourceOk: 'disponible',
    sourceNeedsLogin: 'fallo de inicio de sesión',
    sourceNeedsCredential: 'sin credencial',
    sourceTimeout: 'tiempo de sondeo agotado',
    sourceOffCampus: 'sin ruta fuera del campus',
    sourceDisabled: 'fuente no habilitada',
  },
  fr: {
    section: 'Connexion unifiée ZJU',
    intro: 'Il s’agit des identifiants de la connexion unifiée (CAS) de la ZJU. La Classe Zhiyun et XueZaiZJU partagent cet unique enregistrement : il se remplit une seule fois.',
    accountLabel: 'Compte',
    accountHint: 'Le numéro d’étudiant n’est pas un secret : il est donc réaffiché, ce qui permet de vérifier quel compte est configuré.',
    accountPlaceholder: 'Compte de la connexion unifiée',
    passwordLabel: 'Mot de passe',
    passwordHintNew: 'Aucun mot de passe n’est encore enregistré : ce champ est donc obligatoire. Les espaces font partie du mot de passe et ne sont pas supprimés ; le mot de passe n’est jamais renvoyé à cette page.',
    passwordHintKeep: 'Un mot de passe est déjà enregistré : laissez vide pour le conserver, ou saisissez-en un nouveau. Les espaces font partie du mot de passe et ne sont pas supprimés ; le mot de passe n’est jamais renvoyé à cette page.',
    secretStateReady: 'mot de passe enregistré',
    secretStateEmpty: 'aucun mot de passe',
    save: 'Enregistrer',
    saving: 'Enregistrement…',
    clear: 'Effacer',
    clearing: 'Effacement…',
    clearTitleReady: 'Supprimer les identifiants enregistrés sur cette machine',
    clearTitleEmpty: 'Rien à effacer pour le moment',
    reading: 'Lecture…',
    configuredAs: 'Configuré · {username}',
    notConfigured: 'Non configuré',
    savedHint: 'Enregistré. La Classe Zhiyun et XueZaiZJU utilisent tous deux cet enregistrement.',
    clearedHint: 'Effacé. Les deux reviennent à l’état déconnecté.',
    vpnSection: 'Compte WebVPN',
    vpnIntro: 'Nécessaire uniquement hors campus. Il relève du centre réseau de l’université et constitue un système distinct de la connexion unifiée ci-dessus : le compte est généralement le numéro d’étudiant, mais le mot de passe peut différer.',
    vpnAccountLabel: 'Compte WebVPN',
    vpnAccountHint: 'En cas de doute sur le mot de passe, connectez-vous une fois à webvpn.zju.edu.cn dans un navigateur pour vérifier.',
    vpnAccountPlaceholder: 'Compte WebVPN (généralement le numéro d’étudiant)',
    vpnPasswordLabel: 'Mot de passe WebVPN',
    vpnPasswordHintNew: 'Aucun mot de passe WebVPN n’est encore enregistré. Ce n’est pas celui de la connexion unifiée.',
    vpnPasswordHintKeep: 'Un mot de passe est déjà enregistré : laissez vide pour le conserver. Ce n’est pas celui de la connexion unifiée.',
    vpnSave: 'Enregistrer le compte WebVPN',
    vpnSavedHint: 'Compte WebVPN enregistré. Il ne sert qu’à joindre XueZaiZJU hors campus.',
    vpnClearedHint: 'Compte WebVPN effacé.',
    vpnConfiguredAs: 'Configuré · {username}',
    vpnNotConfigured: 'Non configuré (hors campus uniquement)',
    sourcesTitle: 'Ce que ces identifiants débloquent',
    sourceCampus: 'XueZaiZJU',
    sourceClassroom: 'Classe Zhiyun',
    sourceZdbk: 'Scolarité',
    sourceXuezaiSession: 'Session XueZaiZJU',

    sourceSztz: 'Périscolaire',
    sourceTyys: 'Installations sportives',
    sourceNotice: 'Annonces',

    sourceUnknown: 'Non vérifié',
    sourcesAt: 'Dernière vérification {time}',
    sourcesNever: 'Jamais vérifié',
    probe: 'Vérifier',
    probing: 'Vérification…',
    probeDone: 'Vérification terminée',
    sourceOk: 'disponible',
    sourceNeedsLogin: 'échec de connexion',
    sourceNeedsCredential: 'aucun identifiant',
    sourceTimeout: 'délai de détection dépassé',
    sourceOffCampus: 'aucune route hors campus',
    sourceDisabled: 'source non activée',
  },
  de: {
    section: 'Einheitliche ZJU-Anmeldung',
    intro: 'Dies sind die Zugangsdaten der einheitlichen ZJU-Anmeldung (CAS). Zhiyun-Klassenzimmer und XueZaiZJU teilen diesen einen Datensatz – er wird nur einmal ausgefüllt.',
    accountLabel: 'Konto',
    accountHint: 'Eine Matrikelnummer ist kein Geheimnis und wird daher zurückgegeben – so lässt sich prüfen, welches Konto hinterlegt ist.',
    accountPlaceholder: 'Konto der einheitlichen Anmeldung',
    passwordLabel: 'Passwort',
    passwordHintNew: 'Es ist noch kein Passwort gespeichert, daher ist dieses Feld erforderlich. Leerzeichen gehören zum Passwort und werden nicht entfernt; das Passwort wird nie an diese Seite zurückgegeben.',
    passwordHintKeep: 'Ein Passwort ist bereits gespeichert – leer lassen, um es zu behalten, oder ein neues eingeben. Leerzeichen gehören zum Passwort und werden nicht entfernt; das Passwort wird nie an diese Seite zurückgegeben.',
    secretStateReady: 'Passwort gespeichert',
    secretStateEmpty: 'kein Passwort',
    save: 'Speichern',
    saving: 'Wird gespeichert…',
    clear: 'Löschen',
    clearing: 'Wird gelöscht…',
    clearTitleReady: 'Die gespeicherten Zugangsdaten von diesem Rechner entfernen',
    clearTitleEmpty: 'Noch nichts zu löschen',
    reading: 'Wird gelesen…',
    configuredAs: 'Konfiguriert · {username}',
    notConfigured: 'Nicht konfiguriert',
    savedHint: 'Gespeichert. Zhiyun-Klassenzimmer und XueZaiZJU nutzen beide diesen Datensatz.',
    clearedHint: 'Gelöscht. Beide fallen auf den abgemeldeten Zustand zurück.',
    vpnSection: 'WebVPN-Konto',
    vpnIntro: 'Nur außerhalb des Campus nötig. Es gehört zum Netzwerkzentrum der Universität und ist ein eigenes System, getrennt von der einheitlichen Anmeldung oben: Das Konto ist meist die Matrikelnummer, das Passwort kann abweichen.',
    vpnAccountLabel: 'WebVPN-Konto',
    vpnAccountHint: 'Bei Unsicherheit über das Passwort einmal im Browser bei webvpn.zju.edu.cn anmelden und prüfen.',
    vpnAccountPlaceholder: 'WebVPN-Konto (meist die Matrikelnummer)',
    vpnPasswordLabel: 'WebVPN-Passwort',
    vpnPasswordHintNew: 'Es ist noch kein WebVPN-Passwort gespeichert. Es ist nicht das Passwort der einheitlichen Anmeldung.',
    vpnPasswordHintKeep: 'Ein Passwort ist bereits gespeichert – leer lassen, um es zu behalten. Es ist nicht das Passwort der einheitlichen Anmeldung.',
    vpnSave: 'WebVPN-Konto speichern',
    vpnSavedHint: 'WebVPN-Konto gespeichert. Es wird nur genutzt, um XueZaiZJU von außerhalb des Campus zu erreichen.',
    vpnClearedHint: 'WebVPN-Konto gelöscht.',
    vpnConfiguredAs: 'Konfiguriert · {username}',
    vpnNotConfigured: 'Nicht konfiguriert (nur außerhalb des Campus)',
    sourcesTitle: 'Was diese Zugangsdaten freischalten',
    sourceCampus: 'XueZaiZJU',
    sourceClassroom: 'Zhiyun-Klassenzimmer',
    sourceZdbk: 'Studienverwaltung',
    sourceXuezaiSession: 'XueZaiZJU-Sitzung',

    sourceSztz: 'Außerunterrichtlich',
    sourceTyys: 'Sportanlagen',
    sourceNotice: 'Mitteilungen',

    sourceUnknown: 'Nicht geprüft',
    sourcesAt: 'Zuletzt geprüft {time}',
    sourcesNever: 'Nie geprüft',
    probe: 'Jetzt prüfen',
    probing: 'Prüfe…',
    probeDone: 'Prüfung fertig',
    sourceOk: 'verfügbar',
    sourceNeedsLogin: 'Anmeldung fehlgeschlagen',
    sourceNeedsCredential: 'keine Zugangsdaten',
    sourceTimeout: 'Prüfung abgelaufen',
    sourceOffCampus: 'kein Weg außerhalb des Campus',
    sourceDisabled: 'Quelle nicht aktiviert',
  },
  ru: {
    section: 'Единый вход ZJU',
    intro: 'Это учётные данные единого входа ZJU (CAS). Аудитория Zhiyun и XueZaiZJU используют одну и ту же запись, поэтому заполнять нужно один раз.',
    accountLabel: 'Учётная запись',
    accountHint: 'Номер студенческого не является секретом, поэтому он показывается — так можно убедиться, какая учётная запись настроена.',
    accountPlaceholder: 'Учётная запись единого входа',
    passwordLabel: 'Пароль',
    passwordHintNew: 'Пароль ещё не сохранён, поэтому это поле обязательно. Пробелы являются частью пароля и не удаляются; пароль никогда не возвращается на эту страницу.',
    passwordHintKeep: 'Пароль уже сохранён — оставьте поле пустым, чтобы сохранить его, или введите новый. Пробелы являются частью пароля и не удаляются; пароль никогда не возвращается на эту страницу.',
    secretStateReady: 'пароль сохранён',
    secretStateEmpty: 'пароля нет',
    save: 'Сохранить',
    saving: 'Сохранение…',
    clear: 'Очистить',
    clearing: 'Очистка…',
    clearTitleReady: 'Удалить сохранённые учётные данные с этого компьютера',
    clearTitleEmpty: 'Пока нечего очищать',
    reading: 'Чтение…',
    configuredAs: 'Настроено · {username}',
    notConfigured: 'Не настроено',
    savedHint: 'Сохранено. Аудитория Zhiyun и XueZaiZJU используют эту запись.',
    clearedHint: 'Очищено. Обе вернутся в состояние без входа.',
    vpnSection: 'Учётная запись WebVPN',
    vpnIntro: 'Нужна только вне кампуса. Она относится к сетевому центру университета и представляет собой отдельную систему, не связанную с единым входом выше: логин обычно совпадает с номером студенческого, а пароль может отличаться.',
    vpnAccountLabel: 'Учётная запись WebVPN',
    vpnAccountHint: 'Если не уверены в пароле, войдите один раз в webvpn.zju.edu.cn через браузер и проверьте.',
    vpnAccountPlaceholder: 'Учётная запись WebVPN (обычно номер студенческого)',
    vpnPasswordLabel: 'Пароль WebVPN',
    vpnPasswordHintNew: 'Пароль WebVPN ещё не сохранён. Это не пароль единого входа.',
    vpnPasswordHintKeep: 'Пароль уже сохранён — оставьте поле пустым, чтобы сохранить его. Это не пароль единого входа.',
    vpnSave: 'Сохранить учётную запись WebVPN',
    vpnSavedHint: 'Учётная запись WebVPN сохранена. Используется только для доступа к XueZaiZJU извне кампуса.',
    vpnClearedHint: 'Учётная запись WebVPN очищена.',
    vpnConfiguredAs: 'Настроено · {username}',
    vpnNotConfigured: 'Не настроено (только вне кампуса)',
    sourcesTitle: 'Что открывают эти учётные данные',
    sourceCampus: 'XueZaiZJU',
    sourceClassroom: 'Аудитория Zhiyun',
    sourceZdbk: 'Учебная часть',
    sourceXuezaiSession: 'Сессия XueZaiZJU',

    sourceSztz: 'Внеучебные',
    sourceTyys: 'Спортсооружения',
    sourceNotice: 'Объявления',

    sourceUnknown: 'Не проверено',
    sourcesAt: 'Последняя проверка {time}',
    sourcesNever: 'Ни разу не проверялось',
    probe: 'Проверить',
    probing: 'Проверка…',
    probeDone: 'Проверка завершена',
    sourceOk: 'доступно',
    sourceNeedsLogin: 'ошибка входа',
    sourceNeedsCredential: 'нет учётных данных',
    sourceTimeout: 'время проверки истекло',
    sourceOffCampus: 'нет маршрута вне кампуса',
    sourceDisabled: 'источник не включён',
  },
  pt: {
    section: 'Início de sessão unificado da ZJU',
    intro: 'Estas são as credenciais do início de sessão unificado (CAS) da ZJU. A Sala Zhiyun e o XueZaiZJU partilham este único registo, por isso é preenchido uma só vez.',
    accountLabel: 'Conta',
    accountHint: 'O número de estudante não é segredo, por isso é mostrado — é assim que confirmas que conta está configurada.',
    accountPlaceholder: 'Conta do início de sessão unificado',
    passwordLabel: 'Palavra-passe',
    passwordHintNew: 'Ainda não há palavra-passe guardada, por isso este campo é obrigatório. Os espaços fazem parte da palavra-passe e não são removidos; a palavra-passe nunca é devolvida a esta página.',
    passwordHintKeep: 'Já existe uma palavra-passe guardada — deixa em branco para a manter, ou escreve uma nova. Os espaços fazem parte da palavra-passe e não são removidos; a palavra-passe nunca é devolvida a esta página.',
    secretStateReady: 'palavra-passe guardada',
    secretStateEmpty: 'sem palavra-passe',
    save: 'Guardar',
    saving: 'A guardar…',
    clear: 'Limpar',
    clearing: 'A limpar…',
    clearTitleReady: 'Remover as credenciais guardadas neste computador',
    clearTitleEmpty: 'Ainda não há nada para limpar',
    reading: 'A ler…',
    configuredAs: 'Configurada · {username}',
    notConfigured: 'Não configurada',
    savedHint: 'Guardada. A Sala Zhiyun e o XueZaiZJU usam este registo.',
    clearedHint: 'Limpa. Ambos voltam ao estado sem sessão.',
    vpnSection: 'Conta WebVPN',
    vpnIntro: 'Necessária apenas fora do campus. Pertence ao centro de rede da universidade e é um sistema separado do início de sessão unificado acima: a conta é normalmente o número de estudante, mas a palavra-passe pode ser diferente.',
    vpnAccountLabel: 'Conta WebVPN',
    vpnAccountHint: 'Se não tiveres a certeza da palavra-passe, inicia sessão uma vez em webvpn.zju.edu.cn no navegador para confirmar.',
    vpnAccountPlaceholder: 'Conta WebVPN (normalmente o número de estudante)',
    vpnPasswordLabel: 'Palavra-passe WebVPN',
    vpnPasswordHintNew: 'Ainda não há palavra-passe WebVPN guardada. Não é a do início de sessão unificado.',
    vpnPasswordHintKeep: 'Já existe uma palavra-passe guardada — deixa em branco para a manter. Não é a do início de sessão unificado.',
    vpnSave: 'Guardar conta WebVPN',
    vpnSavedHint: 'Conta WebVPN guardada. Só é usada para chegar ao XueZaiZJU fora do campus.',
    vpnClearedHint: 'Conta WebVPN limpa.',
    vpnConfiguredAs: 'Configurada · {username}',
    vpnNotConfigured: 'Não configurada (apenas fora do campus)',
    sourcesTitle: 'O que estas credenciais desbloqueiam',
    sourceCampus: 'XueZaiZJU',
    sourceClassroom: 'Sala Zhiyun',
    sourceZdbk: 'Assuntos académicos',
    sourceXuezaiSession: 'Sessão XueZaiZJU',

    sourceSztz: 'Extracurricular',
    sourceTyys: 'Instalações desportivas',
    sourceNotice: 'Avisos',

    sourceUnknown: 'Não verificado',
    sourcesAt: 'Última verificação {time}',
    sourcesNever: 'Nunca verificado',
    probe: 'Verificar',
    probing: 'A verificar…',
    probeDone: 'Verificação concluída',
    sourceOk: 'disponível',
    sourceNeedsLogin: 'falha no início de sessão',
    sourceNeedsCredential: 'sem credencial',
    sourceTimeout: 'sondagem expirou',
    sourceOffCampus: 'sem rota fora do campus',
    sourceDisabled: 'fonte não ativada',
  },
};

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zwCardStyle', css, label: 'zw: card settings styles' });
  const text = registerText(ctx, 'zju-source-login', TEXT);
  ctx.effect(() => () => text.dispose(), 'zju: login settings i18n');

  // order 60：一卡通是**所有浙大数据的源头**（课堂、学在浙大待办都靠它），
  // 排在拼题A（65）与个人中转站（70）之前 —— 那两项各自是独立来源，缺了只影响一处。
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'zw-card',
    order: 60,
    // `id` 保持 `zw-card` 不变：规划页的报错文案按它指路，改名会让那条指引失效。
    // 显示名已改为「浙大统一身份认证」—— 一卡通是校园卡，与本页配的 CAS 凭据不是一回事。
    label: () => text.t('section'),
  }, () => React.createElement(SettingsSection, { t: text.t })));
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
export function SettingsSection({ t }) {
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
   *    （见 `dsh-zju-page-planning/src/client.jsx` 里 `openTodos` 那段）。
   *    顺序写对是零成本的，不值得为它赌一次。
   */
  const [hasPassword, setHasPassword] = useState(false);
  /**
   * 三个下游数据源的状态（学在浙大 / 智云课堂 / 教务）。
   *
   * 它们都用这一份统一身份认证凭据。放在这里而不是各自的设置页：
   * 用户填完学号密码后最想知道的就是「它到底通了没有」，状态散在三个页面
   * 里就得逐页翻，而且看的人也不知道三者其实是同一份凭据。
   *
   * `null` = 还没读到（显示"读取中"），不是"未登录"。
   */
  const [sources, setSources] = useState(null);
  /** 上次真探测的采样时间（`null` = 从未探过）。 */
  const [sourcesAt, setSourcesAt] = useState(null);

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


  /**
   * 把「凭据种类 + 操作」拼成宿主的动作名。
   *
   * # 为什么不能直接 `${prefix}-${op}`
   *
   * 一卡通的 `actionPrefix` 是**空字符串**（历史动作名就是 `save` / `clear`，
   * 没有前缀）。无条件加连字符会拼出 `-save` —— 宿主回「未知动作 -save」，
   * 而页面上只表现为「点了没反应」（那时 message 也没接上）。
   *
   * 这个问题一直存在，只是先后被 `busy` 不匹配与 `message.scope` 缺失遮住了：
   * 三层错误叠在一起时，看到的永远是最后一层的症状。
   *
   * @param prefix - `''` 或 `'webvpn'` 之类。
   * @param op - `'save'` / `'clear'`。
   * @returns 宿主的动作名：`save` 或 `webvpn-save`。
   */
  const actionOf = (prefix, op) => (prefix ? `${prefix}-${op}` : op);

  /**
   * 三种凭据的"界面接线"表。
   *
   * 每一项只声明**差异**（读哪份表单、回填哪一块、按钮忙态前缀、提示文案），
   * 保存/清除的**共同逻辑**留在上面的 `saveOne` / `clearOne` 里。
   * 这样加第四种凭据时只加一行表项，不必去三个地方改 `isVpn` 三元。
   */
  const CREDENTIAL_KINDS = {
    card: {
      actionPrefix: '', // 一卡通沿用历史动作名 `save` / `clear`
      form: (s) => s.form,
      hasPassword: (s) => s.hasPassword,
      apply: (s, value) => s.applyCard(value),
      savedText: '已保存。智云课堂与学在浙大都会用这一份凭证。',
      clearedText: '已清除。两处都会退回"还没登录"的状态。',
    },
    webvpn: {
      actionPrefix: 'webvpn',
      form: (s) => s.vpnForm,
      hasPassword: (s) => s.vpnHasPassword,
      apply: (s, value) => s.applyVpn(value),
      savedText: 'WebVPN 上网账号已保存。只有在校外访问学在浙大时才会用到它。',
      clearedText: 'WebVPN 上网账号已清除。',
    },
  };

  /**
   * 交给 `saveOne` / `clearOne` 的那份"当前状态"。
   *
   * 显式列出来而不是直接传一堆 setState：表里的 `apply` 需要一个稳定的对象，
   * 而 hook 的 setter 本身是稳定的 —— 组合成对象放这里，语义更清楚。
   */
  const state = {
    form, setForm, hasPassword, applyCard,
    vpnForm, vpnHasPassword, applyVpn,
  };

  useEffect(() => {
    // 组件卸载后再 setState 是 React 的常见告警来源；`live` 让迟到的那次直接作废。
    let live = true;
    settings('').then(
      (payload) => {
        if (!live) return;
        applyCard(payload.card);
        applyVpn(payload.webvpn);
        // 三个下游数据源的状态：它们都用这一份凭据，放在这里才能形成
        // 「填了什么 → 换来了什么」的闭环。缺字段时保持 null（显示"读取中"）。
        setSources(payload.sources ?? null);
      setSourcesAt(payload.sourcesAt ?? null);
      },
      (failure) => {
        if (!live) return;
        // 读不到**不等于**没配：状态条说"未配置"会让用户以为凭据丢了，去重填一遍。
        setStatus((current) => current ?? { configured: false, username: '' });
        setVpnStatus((current) => current ?? { configured: false, username: '' });
        // 读取失败是整块的，不属于某一张卡片 —— `scope: 'card'` 让它在
        // 主卡（统一身份认证）下方显示出来，否则用户什么都看不到。
        setMessage({ kind: 'error', scope: 'card', text: failure.message });
      },
    );
    return () => { live = false; };
  }, [applyCard, applyVpn]);

  /**
   * 保存一份凭据。
   *
   * @param kind - `'card'` / `'webvpn'`。
   */
  /**
   * 「重新检测」：真探一遍全部数据源。
   *
   * # 为什么单独一个动作（C 方案）
   *
   * 真探测要发网络请求、有几项还要真的走一次 CAS。所以它**不能**在打开页面时
   * 自动跑 —— 用户可能只是来改个密码。只有明确点这个按钮才连。
   *
   * 结果与采样时间一起回填，页面据此显示「上次检测于 …」。
   */
  const probeNow = async () => {
    setBusy('probe');
    setMessage(null);
    try {
      const payload = await settings('probe', { probe: true });
      setSources(payload.sources ?? null);
      setSourcesAt(payload.sourcesAt ?? Date.now());
      setMessage({ kind: 'ok', scope: 'sources', text: t('probeDone') });
    } catch (error) {
      setMessage({ kind: 'error', scope: 'sources', text: String(error?.message ?? error) });
    } finally {
      setBusy(null);
    }
  };

  const saveOne = async (kind) => {
    // 三种凭据的提交口径完全相同（动作名 / 表单 / 打码值 / 落库函数），
    // 差别只有"打哪个动作、读哪份表单、回填哪一块"。写成表而不是三元链：
    // 三元链在第二种时还可读，第三种就开始出错。
    const spec = CREDENTIAL_KINDS[kind];
    const source = spec.form(state);
    const hasSaved = spec.hasPassword(state);
    setBusy(`${kind}-save`);
    setMessage(null);
    try {
      const payload = await settings(actionOf(spec.actionPrefix, 'save'), {
        username: source.username,
        // 留空 = 沿用已存的密码。翻成打码值是宿主约定的"不改"表示法；没存过密码
        // 却传打码值，宿主会明确拒绝（"还没有保存过密码，请填写一次"），
        // 那句话比页面自己编一句更准确。
        password: source.password ? source.password : MASK,
      });
      spec.apply(state, payload[kind]);
      setMessage({ kind: 'ok', scope: kind, text: spec.savedText });
    } catch (failure) {
      setMessage({ kind: 'error', scope: kind, text: failure.message });
    } finally {
      setBusy(null);
    }
  };

  /** 清除一份凭据。 */
  const clearOne = async (kind) => {
    const spec = CREDENTIAL_KINDS[kind];
    setBusy(`${kind}-clear`);
    setMessage(null);
    try {
      const payload = await settings(actionOf(spec.actionPrefix, 'clear'), {});
      spec.apply(state, payload[kind]);
      setMessage({ kind: 'ok', scope: kind, text: spec.clearedText });
    } catch (failure) {
      setMessage({ kind: 'error', scope: kind, text: failure.message });
    } finally {
      setBusy(null);
    }
  };

  /** 能否保存一份凭据：填了新密码，或留空（= 沿用已存的）。 */
  const canSaveWith = (source, hasSaved) =>
    Boolean(source.username.trim()) && (Boolean(source.password) || hasSaved);

  const configured = Boolean(status?.configured);
  const vpnConfigured = Boolean(vpnStatus?.configured);

  /**
   * 三张卡片的展开状态 —— 与其余数据源分区同一套规矩。
   *
   * | 卡片 | 已配置 | 未配置 |
   * | --- | --- | --- |
   * | 凭证（一卡通 / WebVPN） | 收起 | **展开** |
   * | 数据源状态 | **展开** | 收起 |
   *
   * # 为什么用 `useEffect` 而不是 `useState` 初值
   *
   * `configured` 来自异步读回的 `status`：第一次渲染时它是 `false`
   * （还没读到），把它当展开状态初值会让**已配置的用户看到凭证卡大开着**。
   * 必须等 `status` 到了再定。
   *
   * `undefined` = 还没读到，这时用 `defaultOpen` 的默认行为。
   */
  const [cardOpen, setCardOpen] = useState(undefined);
  const [vpnOpen, setVpnOpen] = useState(undefined);
  const [sourcesOpen, setSourcesOpen] = useState(undefined);
  useEffect(() => {
    if (status === null) return;
    setCardOpen(!configured);
    setSourcesOpen(configured);
  }, [status, configured]);
  useEffect(() => {
    if (vpnStatus === null) return;
    setVpnOpen(!vpnConfigured);
  }, [vpnStatus, vpnConfigured]);
  const working = busy !== null;
  /**
   * 能否保存。
   *
   * 两种合法输入：填了新密码，或者留空（= 沿用已存的）。所以"留空"只在**已存过密码**
   * 时才放行 —— 首次配置留空的话宿主一定拒（"还没有保存过密码，请填写一次"），
   * 而"点得下去、点了报错"比"点不下去 + 一句说明"更让人以为是自己填错了。
   * 其余规则（含空格、超长）仍由宿主判断，页面不重复实现一遍。
   */
  const canSaveSpec = (spec) => canSaveWith(spec.form(state), spec.hasPassword(state)) && !working;
  const canSave = canSaveSpec(CREDENTIAL_KINDS.card);
  const canSaveVpn = canSaveSpec(CREDENTIAL_KINDS.webvpn);

  /**
   * 把一个数据源的探测结果翻成 `StatusLine` 的 props。
   *
   * # 为什么抽出来
   *
   * 三个数据源 × 五种状态，内联写就是三层嵌套三元 —— 上一版正是那样，
   * 加一个状态码就要改三处、还容易漏掉某一支。抽成函数后只有一份判据，
   * 新状态码加一次就全线生效。
   *
   * # 状态码的含义（顺序即优先级）
   *
   *   `ok`                 → 可用
   *   `OFF_CAMPUS`（仅学在浙大） → 校外未通（需要 WebVPN）
   *   `NOT_INSTALLED`      → 数据源未启用
   *   `NEEDS_CREDENTIAL`   → 未配凭据（去填学号密码）
   *   `PROBE_TIMEOUT`      → 探测超时（没测出来，不是不能用）
   *   其余                  → 登录失败
   *
   * ⚠️ `PROBE_TIMEOUT` 必须和「登录失败」分开：超时是「现在不知道」，
   * 报成失败会让用户去改一个本来正确的密码。
   *
   * @param all - GET 返回的 `sources`（可能为 null = 读取中）。
   * @param name - 数据源名（`campus` / `classroom` / `zdbk`）。
   * @returns `{ value, tone }`。
   */
  /**
   * 一行分项状态的文案与色调。
   *
   * # `ok === null` 是「未检测」，不是「失败」
   *
   * 那一块**只在点了「重新检测」之后**才真的连一次（C 方案）。没探过就如实
   * 说「未检测」—— 编一个「登录失败」会让用户去排查一个根本不存在的故障。
   */
  const sourceRow = (all, name) => {
    if (all === null) return { value: t('reading'), tone: 'plain' };
    const state = all?.[name] ?? {};
    if (state.ok === null || state.code === 'UNKNOWN') {
      return { value: t('sourceUnknown'), tone: 'plain' };
    }
    if (state.ok) return { value: t('sourceOk'), tone: 'ok' };
    const byCode = {
      OFF_CAMPUS: () => t('sourceOffCampus'),
      NOT_INSTALLED: () => t('sourceDisabled'),
      NEEDS_CREDENTIAL: () => t('sourceNeedsCredential'),
      PROBE_TIMEOUT: () => t('sourceTimeout'),
    };
    const render = byCode[state.code];
    const label = render === undefined ? t('sourceNeedsLogin') : render();
    /**
     * 把后端给的 `detail` 附在后面。
     *
     * # 为什么必须带上
     *
     * 原来只显示「登录失败」四个字。而失败原因差别很大：
     * CAS 不认这个密码 / 网络不通 / 服务没装 —— 三种要做的事完全不同。
     * 只说「登录失败」，用户只能猜，最常见的结果是去反复重填一份本来就对的密码。
     *
     * 截断到 90 字：`StatusLine` 的 `value` 是一行，太长的站点原始报错会挤爆布局。
     */
    const detail = typeof state.detail === 'string' ? state.detail.trim() : '';
    if (!detail) return { value: label, tone: 'warn' };
    const short = detail.length > 90 ? `${detail.slice(0, 90)}…` : detail;
    return { value: `${label} · ${short}`, tone: 'warn' };
  };

  return (
    <Section>
      <PageTitle>{t('section')}</PageTitle>
      <Intro>{t('intro')}</Intro>

      {/* 统一身份认证 —— 智云课堂与学在浙大共用这一份。 */}
      <Rows>
        <Card
          open={cardOpen}
          onOpenChange={setCardOpen}
          title={t('section')}
          detail={configured
            ? t('configuredAs').replace('{username}', status?.username ?? '')
            : t('notConfigured')}
          actions={(
            <Actions>
              <button
                type="button"
                data-primary=""
                disabled={!canSave}
                onClick={() => { void saveOne('card'); }}
              >
                {busy === 'card-save' ? t('saving') : t('save')}
              </button>
              <button
                type="button"
                disabled={working || !configured}
                title={configured ? t('clearTitleReady') : t('clearTitleEmpty')}
                onClick={() => { void clearOne('card'); }}
              >
                {busy === 'card-clear' ? t('clearing') : t('clear')}
              </button>
            </Actions>
          )}
        >
          <Field id="zcd-account" label={t('accountLabel')} hint={t('accountHint')}>
            <input
              id="zcd-account"
              className="zju-setting-input"
              type="text"
              inputMode="text"
              autoComplete="username"
              spellCheck={false}
              maxLength={64}
              placeholder={t('accountPlaceholder')}
              value={form.username}
              onChange={(event) => setForm({ ...form, username: event.target.value })}
              disabled={working}
            />
          </Field>
          <Field
            id="zcd-password"
            label={t('passwordLabel')}
            hint={hasPassword ? t('passwordHintKeep') : t('passwordHintNew')}
          >
            <input
              id="zcd-password"
              className="zju-setting-input"
              // type=password 只是遮蔽；真正的加密与不回显由宿主凭据服务做。
              type="password"
              autoComplete="new-password"
              placeholder={hasPassword ? t('passwordHintKeep').slice(0, 0) || '' : ''}
              value={form.password}
              onChange={(event) => setForm({ ...form, password: event.target.value })}
              disabled={working}
            />
          </Field>
          {message !== null && message.scope === 'card' ? (
            <p className="zju-setting-hint" role="status">{message.text}</p>
          ) : null}
        </Card>

        {/* WebVPN 上网账号 —— **另一套系统的另一个密码**（学校网络中心）。
            独立卡片，理由同上：合成一张卡，用户会以为填一次就都有了。 */}
        <Card
          open={vpnOpen}
          onOpenChange={setVpnOpen}
          title={t('vpnSection')}
          detail={vpnStatus === null
            ? t('reading')
            : vpnStatus.configured
              ? t('vpnConfiguredAs').replace('{username}', vpnStatus.username ?? '')
              : t('vpnNotConfigured')}
          actions={(
            <Actions>
              <button
                type="button"
                data-primary=""
                disabled={!canSaveVpn}
                onClick={() => { void saveOne('webvpn'); }}
              >
                {busy === 'webvpn-save' ? t('saving') : t('vpnSave')}
              </button>
              <button
                type="button"
                disabled={working || !vpnStatus?.configured}
                onClick={() => { void clearOne('webvpn'); }}
              >
                {busy === 'webvpn-clear' ? t('clearing') : t('clear')}
              </button>
            </Actions>
          )}
        >
          <Intro>{t('vpnIntro')}</Intro>
          <Field id="zcd-vpn-account" label={t('vpnAccountLabel')} hint={t('vpnAccountHint')}>
            <input
              id="zcd-vpn-account"
              className="zju-setting-input"
              type="text"
              autoComplete="username"
              spellCheck={false}
              maxLength={64}
              placeholder={t('vpnAccountPlaceholder')}
              value={vpnForm.username}
              onChange={(event) => setVpnForm({ ...vpnForm, username: event.target.value })}
              disabled={working}
            />
          </Field>
          <Field
            id="zcd-vpn-password"
            label={t('vpnPasswordLabel')}
            hint={vpnHasPassword ? t('vpnPasswordHintKeep') : t('vpnPasswordHintNew')}
          >
            <input
              id="zcd-vpn-password"
              className="zju-setting-input"
              type="password"
              autoComplete="new-password"
              value={vpnForm.password}
              onChange={(event) => setVpnForm({ ...vpnForm, password: event.target.value })}
              disabled={working}
            />
          </Field>
          {message !== null && message.scope === 'webvpn' ? (
            <p className="zju-setting-hint" role="status">{message.text}</p>
          ) : null}
        </Card>

        {/* 第三张卡：这份凭据**换来了什么**。
            多数数据源共用同一份统一身份认证，所以状态放在一起才有意义 ——
            用户填完密码，最想知道的就是它们通了没有。
            有独立凭证的（拼题A / 学习通 / CC98 / 实验课平台）各自有设置分区，不在这里重复。
            展开状态由「配没配」决定（见上面的 useEffect）。 */}
        <Card
          open={sourcesOpen}
          onOpenChange={setSourcesOpen}
          title={t('sourcesTitle')}
          detail={sourcesAt
            ? t('sourcesAt').replace('{time}', new Date(sourcesAt).toLocaleTimeString())
            : t('sourcesNever')}
          actions={(
            <Actions>
              <button
                type="button"
                data-primary=""
                disabled={busy === 'probe' || working}
                onClick={() => { void probeNow(); }}
              >
                {busy === 'probe' ? t('probing') : t('probe')}
              </button>
            </Actions>
          )}
        >
          <StatusLine label={t('sourceCampus')} {...sourceRow(sources, 'campus')} />
          <StatusLine label={t('sourceClassroom')} {...sourceRow(sources, 'classroom')} />
          <StatusLine label={t('sourceZdbk')} {...sourceRow(sources, 'zdbk')} />
          <StatusLine label={t('sourceXuezaiSession')} {...sourceRow(sources, 'xuezai')} />
          <StatusLine label={t('sourceSztz')} {...sourceRow(sources, 'sztz')} />
          <StatusLine label={t('sourceTyys')} {...sourceRow(sources, 'tyys')} />
          <StatusLine label={t('sourceNotice')} {...sourceRow(sources, 'notice')} />
          {message !== null && message.scope === 'sources' ? (
            <p className="zju-setting-hint" role="status">{message.text}</p>
          ) : null}
        </Card>
      </Rows>
    </Section>
  );
}
