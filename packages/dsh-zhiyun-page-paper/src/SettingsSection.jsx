import React, { useCallback, useEffect, useState } from 'react';
import { Icon } from 'dsh-zhiyun-shell-ui';
import {
  clearRerankConfig,
  clearTranslateConfig,
  loadRerankConfig,
  loadStatus,
  loadTranslateConfig,
  saveRerankConfig,
  saveTranslateConfig,
} from './library.js';

/**
 * 「设置集中管理」：把上游阅读器右上角那个齿轮弹窗（`#cfg-pop`）搬进宿主的
 * 「个人 → 设置」。
 *
 * 搬迁方式是不 fork 上游：上游本来就把端点配置做成了**两条 HTTP 路由**
 * （`GET` 掩码回显 / `POST` 预检后落盘 / `DELETE` 回落），弹窗只是它的一个前端。
 * 我们注册宿主的 `settings.section` 插槽，用自己的表单打同样的路由 ——
 * 上游那套「保存即生效、明文 key 永不回传、留空即沿用」的语义因此原样保留。
 *
 * 壳里的 `PersonalSettingsBridge` 会把所有 `settings.section` 注册按 `order`
 * 摊成折叠分组，所以这里**不需要改壳**。
 *
 * 两张卡片：
 *   - 整篇翻译（`/api/translate/config`）：本地 babeldoc 路线，需要 OpenAI 兼容端点；
 *   - 检索重排（`/api/typesafe/config`）：可选，没配就按原顺序。
 *
 * 关于「测试端点」：POST 本身就会先 `testTranslateEndpoint` 再落盘，所以保存按钮
 * 就是测试按钮 —— 我们不再自己发一次探针请求（那会重复花钱且结论可能不一致）。
 */

const SOURCE_LABEL = {
  file: '来自本页保存的配置',
  profile: '来自宿主 profile 配置',
  env: '来自环境变量',
  none: '尚未配置',
};

export function SettingsSection() {
  const [status, setStatus] = useState(null);
  useEffect(() => {
    let live = true;
    loadStatus().then(
      (value) => { if (live) setStatus(value); },
      () => { if (live) setStatus(null); },
    );
    return () => { live = false; };
  }, []);

  return <div className="zp-settings">
    <p className="zp-settings-lead">
      论文页的 AI 能力分两处：<strong>选中翻译与问答</strong>走工作台自己的模型
      （在「AI 服务」里配置）；这里的两个端点只用于<strong>整篇 PDF 翻译</strong>与<strong>检索重排</strong>。
    </p>

    <EndpointCard
      title="整篇翻译端点"
      description="把整篇 PDF 译成中文（或中英对照），生成的文件另存为 -zh / -dual，不改动原文件。需要 OpenAI 兼容的 /chat/completions 端点。"
      load={loadTranslateConfig}
      save={saveTranslateConfig}
      clear={clearTranslateConfig}
      keyPlaceholder="留空则沿用已保存的密钥"
    />

    <EndpointCard
      title="检索重排端点"
      description="可选。配置后，论文检索会先做一轮语义重排再返回；不配则按原有顺序。"
      load={loadRerankConfig}
      save={saveRerankConfig}
      clear={clearRerankConfig}
      keyPlaceholder="必填"
      requireModel={false}
    />

    {status && <div className="zp-settings-meta">
      <span>上游 {status.upstream?.installed ?? '未知'}（锁定 {status.upstream?.expected ?? '—'}）</span>
      <span>选中翻译{status.translate?.available ? '已就绪' : '未就绪'}</span>
    </div>}
  </div>;
}

function EndpointCard({ title, description, load, save, clear, keyPlaceholder, requireModel = true }) {
  const [config, setConfig] = useState(null);
  const [form, setForm] = useState({ baseUrl: '', model: '', apiKey: '' });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);

  const refresh = useCallback(() => {
    setMessage(null);
    load().then(
      (value) => {
        setConfig(value);
        // 密钥明文永不回传，所以这个框永远从空开始；留空 = 沿用已存的那把。
        setForm({ baseUrl: value?.baseUrl ?? '', model: value?.model ?? '', apiKey: '' });
      },
      (error) => setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) }),
    );
  }, [load]);

  useEffect(refresh, [refresh]);

  const submit = useCallback(async (event) => {
    event.preventDefault();
    setBusy(true);
    setMessage({ kind: 'info', text: '正在验证端点…' });
    try {
      // 上游在这里会先做一个 max_tokens:1 的探针调用，通了才落盘。
      await save({ baseUrl: form.baseUrl.trim(), model: form.model.trim(), apiKey: form.apiKey.trim() });
      setMessage({ kind: 'ok', text: '端点已保存并生效' });
      refresh();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }, [form, save, refresh]);

  const reset = useCallback(async () => {
    setBusy(true);
    try {
      await clear();
      setMessage({ kind: 'ok', text: '已恢复为未配置' });
      refresh();
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  }, [clear, refresh]);

  const configured = Boolean(config?.hasApiKey ?? config?.apiKeyHint);

  return <form className="zp-card" onSubmit={submit}>
    <div className="zp-card-head">
      <strong>{title}</strong>
      <span className={configured ? 'is-ok' : undefined}>{SOURCE_LABEL[config?.source] ?? '读取中…'}{config?.apiKeyHint ? `（${config.apiKeyHint}）` : ''}</span>
    </div>
    <p className="zp-card-desc">{description}</p>

    <label>端点地址
      <input type="url" inputMode="url" placeholder="https://open.bigmodel.cn/api/paas/v4" value={form.baseUrl} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })}/>
    </label>
    <label>模型
      <input type="text" placeholder="glm-4.6" value={form.model} onChange={(event) => setForm({ ...form, model: event.target.value })}/>
    </label>
    <label>API Key
      <input type="password" autoComplete="off" placeholder={keyPlaceholder} value={form.apiKey} onChange={(event) => setForm({ ...form, apiKey: event.target.value })}/>
    </label>

    {message && <div className={`zp-card-msg is-${message.kind}`}>{message.text}</div>}

    <div className="zp-card-actions">
      <button type="submit" className="is-primary" disabled={busy || !form.baseUrl.trim() || (requireModel && !form.model.trim())}>
        <Icon name="check" size={15}/>保存并验证
      </button>
      <button type="button" onClick={reset} disabled={busy}>清除</button>
      <button type="button" onClick={refresh} disabled={busy}>重新读取</button>
    </div>
  </form>;
}
