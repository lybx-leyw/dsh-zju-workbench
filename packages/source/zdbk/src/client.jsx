/**
 * 「教务」设置分区。
 *
 * # 这一页没有密码输入框，这是刻意的
 *
 * 教务走 CAS，账号就是「浙大一卡通」（`dsh-zju-source-login` 已管）。在这里再放一个
 * 账号密码框会有两个害处：
 *
 *   1. 用户会以为两处是**两套**账号，于是把密码填两份、改一处忘另一处；
 *   2. 同一份凭据有两个写入入口，迟早出现「设置里看着对、取数还是失败」。
 *
 * 所以这里只做三件事：说清它用哪套账号、展示当前能不能连上、给一个重试入口。
 */

import React, { useEffect, useState } from 'react';
import {
  Actions,
  SETTINGS_CSS,
  StatusLine,
  mountStyle,
  registerText,
} from '@lybx-leyw/dsh-zju-ui-shared';

const ROUTE_PATH = '/api/zw-zdbk';
const NAMESPACE = 'zju-source-zdbk';

export const name = 'zw-source-zdbk-client';

export const inject = ['slots', 'locale'];

export const TEXT = {
  zh: {
    section: '教务',
    accountHint: '使用「浙大一卡通」的账号密码登录教务系统，不需要在这里单独填写。',
    connState: '连接状态',
    connected: '可连接',
    disconnected: '连不上',
    unknown: '未知',
    check: '测试连接',
    checking: '测试中…',
    failed: '测试失败',
  },
  en: {
    section: 'Academic affairs',
    accountHint: 'Signs in to the academic system with the ZJU All-in-One account. No separate credentials are needed here.',
    connState: 'Connection',
    connected: 'reachable',
    disconnected: 'unreachable',
    unknown: 'unknown',
    check: 'Test connection',
    checking: 'Testing…',
    failed: 'Test failed',
  },
  ja: {
    section: '教務',
    accountHint: '浙江大学の統一認証で教務システムにサインインします。個別の認証情報は不要です。',
    connState: '接続',
    connected: '到達可能',
    disconnected: '到達不可',
    unknown: '不明',
    check: '接続をテスト',
    checking: 'テスト中…',
    failed: 'テスト失敗',
  },
  es: {
    section: 'Asuntos académicos',
    accountHint: 'Inicia sesión en el sistema académico con la cuenta unificada de la ZJU. No se necesitan credenciales propias.',
    connState: 'Conexión',
    connected: 'accesible',
    disconnected: 'inaccesible',
    unknown: 'desconocido',
    check: 'Probar conexión',
    checking: 'Probando…',
    failed: 'Prueba fallida',
  },
  fr: {
    section: 'Scolarité',
    accountHint: 'Connexion au système académique avec le compte unifié de la ZJU. Aucune information d’identification propre n’est nécessaire.',
    connState: 'Connexion',
    connected: 'accessible',
    disconnected: 'inaccessible',
    unknown: 'inconnu',
    check: 'Tester la connexion',
    checking: 'Test en cours…',
    failed: 'Échec du test',
  },
  de: {
    section: 'Studienverwaltung',
    accountHint: 'Anmeldung am Prüfungs- und Studienamt mit dem einheitlichen ZJU-Konto. Eigene Zugangsdaten sind nicht nötig.',
    connState: 'Verbindung',
    connected: 'erreichbar',
    disconnected: 'nicht erreichbar',
    unknown: 'unbekannt',
    check: 'Verbindung testen',
    checking: 'Wird getestet…',
    failed: 'Test fehlgeschlagen',
  },
  ru: {
    section: 'Учебная часть',
    accountHint: 'Вход в учебную систему выполняется через единую учётную запись ZJU. Собственные учётные данные не нужны.',
    connState: 'Соединение',
    connected: 'доступно',
    disconnected: 'недоступно',
    unknown: 'неизвестно',
    check: 'Проверить соединение',
    checking: 'Проверка…',
    failed: 'Проверка не удалась',
  },
  pt: {
    section: 'Assuntos académicos',
    accountHint: 'Inicia sessão no sistema académico com a conta unificada da ZJU. Não são necessárias credenciais próprias.',
    connState: 'Ligação',
    connected: 'acessível',
    disconnected: 'inacessível',
    unknown: 'desconhecido',
    check: 'Testar ligação',
    checking: 'A testar…',
    failed: 'Teste falhou',
  },
};

export function SettingsSection({ t }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const refresh = async () => {
    try {
      const response = await fetch(ROUTE_PATH, { headers: { Accept: 'application/json' } });
      if (!response.ok) return;
      setStatus(await response.json());
    } catch { /* 保持上一份结论 */ }
  };

  useEffect(() => { void refresh(); }, []);

  const check = async () => {
    setBusy(true);
    setMessage(null);
    try { await refresh(); }
    catch (error) { setMessage({ tone: 'bad', text: `${t('failed')}: ${error.message}` }); }
    finally { setBusy(false); }
  };

  const reachable = status?.ok ?? status?.reachable;

  return React.createElement(React.Fragment, null,
    React.createElement('p', { className: 'zju-setting-hint' }, t('accountHint')),
    React.createElement(StatusLine, {
      label: t('connState'),
      value: reachable === true ? t('connected') : reachable === false ? t('disconnected') : t('unknown'),
      tone: reachable === true ? 'ok' : reachable === false ? 'warn' : 'plain',
    }),
    React.createElement(Actions, null,
      React.createElement('button', { type: 'button', disabled: busy, onClick: check },
        busy ? t('checking') : t('check'))),
    message ? React.createElement('div', {
      className: 'zju-setting-hint',
      style: { color: '#e06c6c' },
    }, message.text) : null,
  );
}

export function apply(ctx) {
  // **本包不再注册设置分区。**
  //
  // 它没有可配置项 —— 整块内容只是一个状态读数。而那份状态已经并入
  // 「浙大统一身份认证」分区的「这份凭据的用途」卡片：三者共用同一份 CAS
  // 凭据，状态放在一起才能回答「我填的这份凭据到底通了哪些」。
  //
  // 数据服务（`zwZdbk`）与路由都保留，
  // 页面与脚本照常用它们，只是不在设置里占一格。
  void ctx;
}
