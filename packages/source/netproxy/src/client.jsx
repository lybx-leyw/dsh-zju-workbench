// 「个人 → 网络代理」面板：把分域路由表摆成可编辑的形状。
//
// 面板**不判断路由，也不复刻校验**：域名怎么匹配、配置算不算合法，真源都在宿主半边的
// `src/config.js`（`normalize` / `matchesHost`）。这里只做三件事 —— 读出当前配置、
// 让用户改、把结果原样交给 `/_dsh/zw-net-proxy`。校验失败时把宿主返回的那句话
// 直接显示出来，于是「面板说存不下」和「宿主拒绝的原因」永远是同一句。
//
// 写操作必须带 `x-zw-net-proxy` 头：宿主用它挡 CSRF（跨站发不出自定义头，硬带上
// 就会触发本路由不响应的预检）。漏了它每次保存都是 403。
//
// # 外观为什么自己只画内容（这一段决定了整个面板的形状）
//
// 本面板现在是宿主**原生设置浮窗**里的一个分区（注册 `settings.section`，与「论文阅读」
// 等同一套导航与滚动外壳）。浮窗自己负责标题、分区切换与滚动，所以这里只排内容：
// 把边框、圆角、折叠交互再画一遍会出现「浮窗里套一张折叠卡」。
//
// 折叠状态下那行自述读数（「已接管流量 · 1 个代理 · 1 条规则」）保留为面板顶部一行，
// 收起时它仍是唯一能看见的结论。
import React, { useEffect, useState } from 'react';
import { Icon, Notice, mountStyle, registerText } from '@lybx-leyw/dsh-zju-ui-shared';
import css from './style.css';

export const name = 'zw-net-proxy-client';

/**
 * 只要插槽与 locale。
 *
 * `locale` 必须写进 `inject` —— Cordis 的注入门禁会拒绝未声明的服务访问，
 * 连 `ctx.get('locale')` 也拦。漏了它的表现是分区标题恒为中文（静默降级）。
 */
export const inject = ['slots', 'locale'];

/** 分区标题的双语字典。面板正文仍是中文，见 login 同名说明。 */
const TEXT = {
  zh: { section: '网络代理' },
  en: { section: 'Network proxy' },
  ja: {
    section: 'ネットワークプロキシ',
  },
  es: {
    section: 'Proxy de red',
  },
  fr: {
    section: 'Proxy réseau',
  },
  de: {
    section: 'Netzwerk-Proxy',
  },
  ru: {
    section: 'Сетевой прокси',
  },
  pt: {
    section: 'Proxy de rede',
  },
};

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zwNetProxyStyle', css, label: 'zw: net proxy styles' });
  const text = registerText(ctx, 'zju-source-netproxy', TEXT);
  ctx.effect(() => () => text.dispose(), 'zju: netproxy settings i18n');
  // 设置是宿主原生浮窗（`settings.section` 的子槽位），所以面板直接进那里，
  // 与「论文阅读」等设置项同一套导航与折叠外壳 —— 本包不另建入口。
  ctx.slots.inject('settings.section', () => ctx.slots.register(
    { name: 'settings.section', id: 'net-proxy', order: 20, label: () => text.t('section') },
    NetworkProxy,
  ));
}

/** 宿主注册的设置路由，与宿主 `src/constants.js` 的 `ROUTE_PATH` 一致。 */
const ROUTE = '/_dsh/zw-net-proxy';

/** 写操作的自定义头，名字必须与宿主 `settings.js` 的 `WRITE_HEADER` 一致。 */
const WRITE_HEADER = 'x-zw-net-proxy';

/** 「直连」的保留目标，与宿主 `config.js` 的 `DIRECT` 一致。 */
const DIRECT = 'direct';

/** 协议下拉的取值，与宿主 `config.js` 的 `PROTOCOLS` 一致。 */
const PROTOCOLS = ['http', 'socks5'];

/**
 * 域名匹配的四种写法。
 *
 * 这段文案就是 `matchesHost` 的全部语义 —— 改它之前先看宿主那边的实现，
 * 面板上的说明与真正生效的规则不一致，比没有说明更糟。
 */
const MATCH_HINT = '匹配写法：example.com 命中本域与全部子域；.example.com 与 *.example.com 等价；'
  + '以点结尾（如 192.168.）按前缀匹配，适合整段 IP 或网段；* 命中全部。'
  + '规则自上而下生效，先命中的先用；全都不命中时走默认策略。';

/**
 * 一次设置路由往返。
 *
 * 失败一律抛宿主给的原话 —— 端口写错、规则指向不存在的代理，这些原因只有宿主知道，
 * 面板自作主张翻译一遍只会让用户看到的提示和实际拒绝的理由对不上。
 */
async function settings({ method = 'GET', body } = {}) {
  const response = await fetch(ROUTE, {
    method,
    ...(body === undefined ? {} : {
      headers: { 'content-type': 'application/json', [WRITE_HEADER]: '1' },
      body: JSON.stringify(body),
    }),
  }).catch((error) => { throw new Error(`打不开设置路由：${error.message}`); });
  const answer = await response.json().catch(() => null);
  if (!response.ok || answer?.ok !== true) {
    throw new Error(answer?.error?.message ?? `HTTP ${response.status}`);
  }
  return answer;
}

/**
 * 配置在面板里的形状与宿主略有不同：**端口按字符串存**。
 *
 * 输入框给的本来就是文本，转成数字再放回去会丢掉「用户正打到一半」的状态（清空后
 * 立刻变 0，光标跟着跳）。所以编辑态一律存字符串，保存时原样交给宿主，由它的
 * `normalize` 去 `Number()` 并给出「端口无效」这样的原话。
 */
function editable(config) {
  return {
    enabled: config?.enabled === true,
    proxies: (config?.proxies ?? []).map(proxy => ({
      id: String(proxy?.id ?? ''),
      label: String(proxy?.label ?? ''),
      protocol: PROTOCOLS.includes(proxy?.protocol) ? proxy.protocol : 'http',
      host: String(proxy?.host ?? ''),
      port: String(proxy?.port ?? ''),
      username: String(proxy?.username ?? ''),
      password: String(proxy?.password ?? ''),
    })),
    rules: (config?.rules ?? []).map(rule => ({
      match: String(rule?.match ?? ''),
      target: String(rule?.target ?? DIRECT),
    })),
    fallback: String(config?.fallback ?? DIRECT),
  };
}

/**
 * 只保留运行状态。
 *
 * 宿主把生效配置也一并塞进了 `status`，而那份里是**明文密码**（打码只发生在 `config`
 * 字段上）。面板不需要它，就别把它带进渲染树。
 */
function runtimeStatus(status) {
  if (status === null || typeof status !== 'object') return null;
  const rest = { ...status };
  delete rest.config;
  return rest;
}

/** 给新代理取一个没被占用的 id：宿主按 id 认代理，重复会直接拒绝整份配置。 */
function nextId(proxies) {
  const used = new Set(proxies.map(proxy => proxy.id));
  for (let n = 1; ; n += 1) {
    const id = `p${n}`;
    if (!used.has(id)) return id;
  }
}

/** 一个出口的连通性读数。 */
function ProbeResult({ result }) {
  if (result === undefined) return null;
  if (result.ok) {
    return <span className="znp-result znp-result-ok">
      <Icon name="check" size={13}/>连通{typeof result.latencyMs === 'number' ? ` · ${result.latencyMs}ms` : ''}
    </span>;
  }
  return <span className="znp-result znp-result-bad">
    <Icon name="close" size={13}/>不通{result.error ? `：${result.error}` : ''}
  </span>;
}

export function NetworkProxy() {
  const [phase, setPhase] = useState('loading');
  const [config, setConfig] = useState(null);
  const [saved, setSaved] = useState(null);
  const [status, setStatus] = useState(null);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState('');
  const [dirty, setDirty] = useState(false);
  const [results, setResults] = useState({});

  /** 采纳宿主回来的配置与状态：编辑态与「已保存」快照一起换，脏标记由调用方清。 */
  const adopt = (answer) => {
    setConfig(editable(answer.config));
    setSaved(editable(answer.config));
    setStatus(runtimeStatus(answer.status));
  };

  const load = async () => {
    setPhase('loading');
    setNotice(null);
    try {
      adopt(await settings());
      setDirty(false);
      setPhase('ready');
    } catch (error) {
      setNotice({ tone: 'bad', text: error.message });
      setPhase('error');
    }
  };

  useEffect(() => { void load(); }, []);

  /** 所有编辑都从这里走：顺手点亮「有未保存的改动」并撤掉上一次的提示。 */
  const edit = (mutate) => {
    setConfig(prev => mutate(prev));
    setDirty(true);
    setNotice(null);
  };

  const addProxy = () => edit(prev => ({
    ...prev,
    proxies: [...prev.proxies, {
      id: nextId(prev.proxies), label: '', protocol: 'http', host: '', port: '', username: '', password: '',
    }],
  }));

  const patchProxy = (index, patch) => edit(prev => ({
    ...prev,
    proxies: prev.proxies.map((proxy, at) => (at === index ? { ...proxy, ...patch } : proxy)),
  }));

  /**
   * 删掉一个代理时，把指向它的规则与默认策略收回「直连」。
   *
   * 不收回的话宿主会以「指向了不存在的代理」拒绝保存，而用户看到的是自己刚删掉一行、
   * 却怎么都存不下去 —— 这一步该由界面补上，不该让用户逐行去找还有谁指着它。
   */
  const removeProxy = (index) => edit(prev => {
    const gone = prev.proxies[index]?.id;
    return {
      ...prev,
      proxies: prev.proxies.filter((_, at) => at !== index),
      rules: prev.rules.map(rule => (rule.target === gone ? { ...rule, target: DIRECT } : rule)),
      fallback: prev.fallback === gone ? DIRECT : prev.fallback,
    };
  });

  const addRule = () => edit(prev => ({ ...prev, rules: [...prev.rules, { match: '', target: DIRECT }] }));

  const patchRule = (index, patch) => edit(prev => ({
    ...prev,
    rules: prev.rules.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)),
  }));

  const removeRule = (index) => edit(prev => ({ ...prev, rules: prev.rules.filter((_, at) => at !== index) }));

  const save = async () => {
    setBusy('save');
    setNotice(null);
    try {
      adopt(await settings({ method: 'POST', body: { action: 'save', config } }));
      setDirty(false);
      setNotice({ tone: 'ok', text: '已保存。中继每连接实时读配置，不必重启。' });
    } catch (error) {
      setNotice({ tone: 'bad', text: `保存失败：${error.message}` });
    } finally {
      setBusy('');
    }
  };

  /**
   * 连通性探测打的是宿主**当前已保存**的配置 —— 它按 target id 去自己的配置里找出口，
   * 所以刚加上、还没保存的代理测不了。这类条目的按钮保持禁用，而不是点了再报
   * 「没有这个出口」。
   */
  const probe = async (target) => {
    setBusy(`test:${target}`);
    try {
      const answer = await settings({ method: 'POST', body: { action: 'test', target } });
      setResults(prev => ({
        ...prev,
        [target]: answer.result ?? { ok: false, error: '宿主没有返回探测结果' },
      }));
    } catch (error) {
      setResults(prev => ({ ...prev, [target]: { ok: false, error: error.message } }));
    } finally {
      setBusy('');
    }
  };

  const savedIds = new Set((saved?.proxies ?? []).map(proxy => proxy.id));
  const testable = target => target === DIRECT || savedIds.has(target);

  /** 折叠状态下 summary 那一行自述的内容 —— 收起时它就是唯一能看到的读数。 */
  const summaryText = phase !== 'ready'
    ? (phase === 'loading' ? '正在读取配置…' : '读不到配置')
    : [
      config.enabled ? '已接管流量' : '未接管流量',
      `${config.proxies.length} 个代理`,
      `${config.rules.length} 条规则`,
      dirty ? '有未保存的改动' : null,
    ].filter(Boolean).join(' · ');

  // 设置分区已经有原生浮窗提供的导航与滚动外壳，这里只排本面板自己的内容：
  // 再套一层折叠组会变成「浮窗里套一张折叠卡」。摘要读数改成面板顶部一行。
  const frame = body => <div className="znp">
    <p className="znp-summary">{summaryText}</p>
    <div className="znp-body">{body}</div>
  </div>;

  if (phase !== 'ready') {
    return frame(<>
      <p className="znp-muted">{phase === 'loading' ? '正在读取代理配置…' : '读不到代理配置。'}</p>
      <Notice>{notice?.text}</Notice>
      {phase === 'error' && <div><button type="button" className="zws-button" onClick={() => void load()}>重新读取</button></div>}
    </>);
  }

  const targetOptions = <>
    <option value={DIRECT}>直连</option>
    {config.proxies.map(proxy => <option key={proxy.id} value={proxy.id}>
      {proxy.label.trim() === '' ? proxy.id : `${proxy.label}（${proxy.id}）`}
    </option>)}
  </>;

  return frame(<>
    <label className="znp-switch">
      <input
        type="checkbox"
        checked={config.enabled}
        onChange={event => edit(prev => ({ ...prev, enabled: event.target.checked }))}
      />
      <span>
        <strong>接管流量</strong>
        <small>关闭时完全不接管，宿主按原样走它自己的出口。</small>
      </span>
    </label>

    <p className="znp-status">
      {[
        status?.relay?.listening === true ? `中继 127.0.0.1:${status.relay.port}` : '中继未启动',
        status?.active === true ? '出口接管已生效' : '出口未接管',
        typeof status?.verified === 'boolean' ? (status.verified ? '出口自检通过' : '出口自检未通过') : null,
      ].filter(Boolean).join(' · ')}
    </p>
    {Array.isArray(status?.errors) && status.errors.length > 0
      && <Notice>{`最近的错误：${status.errors.slice(-2).join('；')}`}</Notice>}

    <section className="znp-group" aria-label="代理">
      <div className="znp-group-head">
        <h4 className="znp-h">代理</h4>
        <button type="button" className="zws-button" onClick={addProxy}><Icon name="plus" size={14}/>添加代理</button>
      </div>
      {config.proxies.length === 0
        ? <p className="znp-muted">还没有代理。添加之后，规则与默认策略就能指向它。</p>
        : <ul className="znp-list">{config.proxies.map((proxy, index) => <li key={proxy.id} className="znp-item">
          <div className="znp-item-head">
            <code className="znp-id">{proxy.id}</code>
            <input
              className="znp-label"
              value={proxy.label}
              placeholder="名称"
              aria-label={`第 ${index + 1} 个代理的名称`}
              onChange={event => patchProxy(index, { label: event.target.value })}
            />
            <button
              type="button"
              className="znp-icon-button"
              title="删除这个代理"
              aria-label={`删除代理 ${proxy.id}`}
              onClick={() => removeProxy(index)}
            ><Icon name="close" size={14}/></button>
          </div>
          <div className="znp-fields">
            <label className="znp-field">协议
              <select
                value={proxy.protocol}
                aria-label={`代理 ${proxy.id} 的协议`}
                onChange={event => patchProxy(index, { protocol: event.target.value })}
              >{PROTOCOLS.map(item => <option key={item} value={item}>{item}</option>)}</select>
            </label>
            <label className="znp-field">地址
              <input
                value={proxy.host}
                placeholder="主机名或 IP"
                aria-label={`代理 ${proxy.id} 的地址`}
                onChange={event => patchProxy(index, { host: event.target.value })}
              />
            </label>
            <label className="znp-field">端口
              <input
                value={proxy.port}
                inputMode="numeric"
                placeholder="端口号"
                aria-label={`代理 ${proxy.id} 的端口`}
                onChange={event => patchProxy(index, { port: event.target.value })}
              />
            </label>
            <label className="znp-field">用户名
              <input
                value={proxy.username}
                autoComplete="off"
                aria-label={`代理 ${proxy.id} 的用户名`}
                onChange={event => patchProxy(index, { username: event.target.value })}
              />
            </label>
            <label className="znp-field">密码
              <input
                type="password"
                value={proxy.password}
                autoComplete="new-password"
                aria-label={`代理 ${proxy.id} 的密码`}
                onChange={event => patchProxy(index, { password: event.target.value })}
              />
            </label>
          </div>
          <div className="znp-item-foot">
            <button
              type="button"
              className="zws-button"
              disabled={!testable(proxy.id) || busy !== ''}
              title={testable(proxy.id) ? '直接连这个出口' : '先保存，宿主才认得这个出口'}
              onClick={() => void probe(proxy.id)}
            >{busy === `test:${proxy.id}` ? '测试中…' : '测试'}</button>
            <ProbeResult result={results[proxy.id]}/>
            {!testable(proxy.id) && <span className="znp-muted">保存后才能测试</span>}
          </div>
        </li>)}</ul>}
    </section>

    <section className="znp-group" aria-label="路由规则">
      <div className="znp-group-head">
        <h4 className="znp-h">路由规则</h4>
        <button type="button" className="zws-button" onClick={addRule}><Icon name="plus" size={14}/>添加规则</button>
      </div>
      <p className="znp-hint">{MATCH_HINT}</p>
      {config.rules.length === 0
        ? <p className="znp-muted">还没有规则：所有请求都按默认策略走。</p>
        : <ul className="znp-list">{config.rules.map((rule, index) => <li key={index} className="znp-rule">
          <input
            value={rule.match}
            placeholder="域名或前缀"
            aria-label={`第 ${index + 1} 条规则匹配的域名`}
            onChange={event => patchRule(index, { match: event.target.value })}
          />
          <span className="znp-arrow" aria-hidden="true"><Icon name="arrow" size={14}/></span>
          <select
            value={rule.target}
            aria-label={`第 ${index + 1} 条规则的目标`}
            onChange={event => patchRule(index, { target: event.target.value })}
          >{targetOptions}</select>
          <button
            type="button"
            className="znp-icon-button"
            title="删除这条规则"
            aria-label={`删除第 ${index + 1} 条规则`}
            onClick={() => removeRule(index)}
          ><Icon name="close" size={14}/></button>
        </li>)}</ul>}
    </section>

    <section className="znp-group" aria-label="默认策略">
      <div className="znp-group-head"><h4 className="znp-h">默认策略</h4></div>
      <p className="znp-hint">所有规则都不命中时走这里。</p>
      <div className="znp-fallback">
        <label className="znp-field">出口
          <select
            value={config.fallback}
            aria-label="默认策略的出口"
            onChange={event => edit(prev => ({ ...prev, fallback: event.target.value }))}
          >{targetOptions}</select>
        </label>
        <button
          type="button"
          className="zws-button"
          disabled={!testable(config.fallback) || busy !== ''}
          title={testable(config.fallback) ? '直接连这个出口' : '先保存，宿主才认得这个出口'}
          onClick={() => void probe(config.fallback)}
        >{busy === `test:${config.fallback}` ? '测试中…' : '测试默认策略'}</button>
        <ProbeResult result={results[config.fallback]}/>
      </div>
    </section>

    <div className="znp-foot">
      <span className="znp-muted">
        {dirty ? '有未保存的改动。测试打的是已保存的配置。' : '与宿主当前生效的配置一致。'}
      </span>
      <div className="znp-foot-actions">
        <button type="button" className="zws-button" disabled={busy !== ''} onClick={() => void load()}>重新读取</button>
        <button type="button" className="zws-primary" disabled={busy !== ''} onClick={() => void save()}>
          {busy === 'save' ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
    <Notice>{notice?.tone === 'bad' ? notice.text : ''}</Notice>
    {notice?.tone === 'ok' && <p className="znp-note-ok">{notice.text}</p>}
  </>);
}
