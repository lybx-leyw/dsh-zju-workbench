/**
 * 「智云课堂」设置分区。
 *
 * 与「教务」同理：课堂走 CAS，账号是「浙大一卡通」，这里不重复收密码。
 * 唯一在这里提供的是一个**会话状态**读数 —— 课堂的会话是最容易过期的一环
 * （它的 CAS 链路最长：tgmedia 或 casapi 入口 → 多跳 → classroom 的 `_token`），
 * 学生遇到「页面空白」时先看这一行就能分清是登录问题还是别的。
 */

import React, { useEffect, useState } from 'react';
import {
  Actions,
  SETTINGS_CSS,
  StatusLine,
  mountStyle,
  registerText,
} from '@lybx-leyw/dsh-zju-ui-shared';

const NAMESPACE = 'zju-source-classroom';

export const name = 'zhiyun-source-classroom-client';

export const inject = ['slots', 'locale'];

export const TEXT = {
  zh: {
    section: '智云课堂',
    accountHint: '使用「浙大一卡通」的账号登录智云课堂，不需要在这里单独填写。课堂的会话会过期，过期后重新取一次即可。',
    sessionState: '会话状态',
    active: '有效',
    expired: '已过期',
    unknown: '未知',
    refresh: '刷新会话',
    refreshing: '刷新中…',
  },
  en: {
    section: 'Zhiyun Classroom',
    accountHint: 'Signs in with the ZJU All-in-One account; no separate credentials here. The classroom session expires — fetch it again when it does.',
    sessionState: 'Session',
    active: 'active',
    expired: 'expired',
    unknown: 'unknown',
    refresh: 'Refresh session',
    refreshing: 'Refreshing…',
  },
  ja: {
    section: '智雲教室',
    accountHint: '浙江大学の統一認証でサインインします。ここに個別の認証情報は要りません。教室のセッションは期限切れになるため、そのときは再取得してください。',
    sessionState: 'セッション',
    active: '有効',
    expired: '期限切れ',
    unknown: '不明',
    refresh: 'セッションを更新',
    refreshing: '更新中…',
  },
  es: {
    section: 'Aula Zhiyun',
    accountHint: 'Inicia sesión con la cuenta unificada de la ZJU; aquí no hay credenciales propias. La sesión del aula caduca, así que vuelve a obtenerla cuando ocurra.',
    sessionState: 'Sesión',
    active: 'activa',
    expired: 'caducada',
    unknown: 'desconocido',
    refresh: 'Renovar sesión',
    refreshing: 'Renovando…',
  },
  fr: {
    section: 'Classe Zhiyun',
    accountHint: 'Connexion avec le compte unifié de la ZJU ; aucune information d’identification propre ici. La session de classe expire : récupérez-la à ce moment-là.',
    sessionState: 'Session',
    active: 'active',
    expired: 'expirée',
    unknown: 'inconnu',
    refresh: 'Renouveler la session',
    refreshing: 'Renouvellement…',
  },
  de: {
    section: 'Zhiyun-Klassenzimmer',
    accountHint: 'Anmeldung mit dem einheitlichen ZJU-Konto; hier gibt es keine eigenen Zugangsdaten. Die Sitzung des Klassenzimmers läuft ab – holen Sie sie dann erneut.',
    sessionState: 'Sitzung',
    active: 'aktiv',
    expired: 'abgelaufen',
    unknown: 'unbekannt',
    refresh: 'Sitzung erneuern',
    refreshing: 'Wird erneuert…',
  },
  ru: {
    section: 'Аудитория Zhiyun',
    accountHint: 'Вход выполняется через единую учётную запись ZJU; собственных учётных данных здесь нет. Сессия аудитории истекает — получите её заново, когда это произойдёт.',
    sessionState: 'Сессия',
    active: 'активна',
    expired: 'истекла',
    unknown: 'неизвестно',
    refresh: 'Обновить сессию',
    refreshing: 'Обновление…',
  },
  pt: {
    section: 'Sala Zhiyun',
    accountHint: 'Inicia sessão com a conta unificada da ZJU; não há credenciais próprias aqui. A sessão da sala expira, por isso volte a obtê-la quando isso acontecer.',
    sessionState: 'Sessão',
    active: 'ativa',
    expired: 'expirada',
    unknown: 'desconhecido',
    refresh: 'Renovar sessão',
    refreshing: 'A renovar…',
  },
};

/**
 * 课堂的状态来自 Cordis 服务 `zhiyunClassroom`，不是 HTTP 路由 ——
 * 它没有自己的 webServer 端点（见本包 `src/index.js` 的 `ctx.provide('zhiyunClassroom', …)`）。
 * 客户端拿不到服务对象，所以这里只呈现**由宿主注入的** `controller` 提供的读数；
 * 没有 controller 时如实显示「未知」，不伪造状态。
 */
export function SettingsSection({ t, controller }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState(null);

  const refresh = async () => {
    setBusy(true);
    try {
      const status = await controller?.status?.();
      if (status !== undefined) setState(status);
    } catch { /* 读不到就保持未知 */ }
    finally { setBusy(false); }
  };

  useEffect(() => { void refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, []);

  const active = state?.active ?? state?.ok ?? (state === undefined ? undefined : Boolean(state));

  return React.createElement(React.Fragment, null,
    React.createElement('p', { className: 'zju-setting-hint' }, t('accountHint')),
    React.createElement(StatusLine, {
      label: t('sessionState'),
      value: active === true ? t('active') : active === false ? t('expired') : t('unknown'),
      tone: active === true ? 'ok' : active === false ? 'warn' : 'plain',
    }),
    React.createElement(Actions, null,
      React.createElement('button', { type: 'button', disabled: busy, onClick: refresh },
        busy ? t('refreshing') : t('refresh'))),
  );
}

export function apply(ctx) {
  // **本包不再注册设置分区。**
  //
  // 它没有可配置项 —— 整块内容只是一个状态读数。而那份状态已经并入
  // 「浙大统一身份认证」分区的「这份凭据的用途」卡片：三者共用同一份 CAS
  // 凭据，状态放在一起才能回答「我填的这份凭据到底通了哪些」。
  //
  // 数据服务（`zhiyunClassroom`）与路由都保留，
  // 页面与脚本照常用它们，只是不在设置里占一格。
  void ctx;
}
