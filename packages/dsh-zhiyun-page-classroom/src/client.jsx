// 「课堂」页的客户端半边：同源 iframe 承载上游 OpenMAIC 整站。
//
// # 为什么是 iframe 而不是把组件搬过来
//
// 上游从 1.2.0 起是 server-first 的：生成、播放、多智能体对话、导出全部挂在它
// 自己的 `/api/*` 上。把它的 React 组件搬进本仓的插件体系，只能保住「看起来像」：
// 界面画得出来，点下去每个按钮都 404。
//
// 所以这里的取舍是**原样嵌整个站点**：页面里是一个占满内容区的 iframe，指向
// 宿主托管的 `http://127.0.0.1:<port>`。UI 与上游一致这件事因此不是「对齐」出来的，
// 是同一份代码渲染出来的。
//
// # ⚠️ 为什么这里走 HTTP 而不是 `ctx.zhiyunOpenMAIC`
//
// 托管上游的是 `dsh-zhiyun-host-openmaic`，它 `provide` 的服务活在**宿主进程**里。
// 客户端插件跨不过这道进程边界：把 `zhiyunOpenMAIC` 写进 inject 的话，浏览器侧
// 永远等不到它，表现为 `web boot: 1 entry did not activate / pending (waiting for
// service: zhiyunOpenMAIC)`，整页白屏（真机踩到过）。
//
// 所以状态的读取与起停一律走宿主注册的同源路由 `/zhiyun-openmaic/*`
// （见 host 包的 `src/routes.js`）。
import React from 'react';
import { mountStyle } from 'dsh-zhiyun-shell-ui';
import css from './style.css';

export const name = 'zhiyun-page-classroom-client';
export const inject = ['slots'];

/** 宿主路由前缀；与 `dsh-zhiyun-host-openmaic/src/routes.js` 的 ROUTE_PREFIX 一致。 */
const ROUTE = '/zhiyun-openmaic';

/** 调宿主路由。网络层失败也要落成一个可解释的状态，而不是抛到渲染里。 */
async function call(path, method = 'GET') {
  try {
    const response = await fetch(`${ROUTE}${path}`, { method, headers: { accept: 'application/json' } });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) {
      return { state: 'failed', reason: payload?.error ?? `宿主返回 ${response.status}`, url: null };
    }
    return payload.status;
  } catch (error) {
    // 路由根本没注册（宿主包没装）时走这里。
    return { state: 'host-missing', reason: String(error?.message ?? error), url: null };
  }
}

export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunClassroomStyle', css, label: 'zhiyun: classroom page styles' });

  // 插槽**无条件**注册：即便宿主包缺席，这一页也要自己说清楚缺什么，
  // 而不是留给壳的通用占位「这个页面由独立的插件包提供，当前未启用」。
  ctx.slots.inject('zhiyun.classroom.content', () => ctx.slots.register(
    { name: 'zhiyun.classroom.content' },
    () => <ClassroomPage />,
  ));
}

/** 上游没就绪时的说明文案：按状态给出**可执行**的下一步，而不是一句「不可用」。 */
function Hint({ state, reason }) {
  const steps = {
    'host-missing': '`dsh-zhiyun-host-openmaic` 未加载：确认它已安装并在 profile 的 bundles 里登记。',
    'not-vendored': '运行 `npm run vendor:fetch -- --only openmaic` 拉取上游源码。',
    'missing-deps': '在 `packages/dsh-zhiyun-host-openmaic/vendor/openmaic` 下运行 `pnpm install --frozen-lockfile`。',
    'no-database': '设置 `OPENMAIC_DATABASE_URL`：上游没有 PostgreSQL 会直接退出，不会降级。',
    failed: '查看日志里的 `[upstream]` 行；首次使用需要先在 vendor 目录下 `pnpm build`。',
  };
  return (
    <div className="zmc-empty">
      <h2>课堂还没就绪</h2>
      <p>{reason ?? 'OpenMAIC 上游服务尚未启动。'}</p>
      {steps[state] && <p className="zmc-hint">{steps[state]}</p>}
      <p className="zmc-muted">状态：{state}</p>
    </div>
  );
}

function ClassroomPage() {
  const [status, setStatus] = React.useState({ state: 'starting', reason: null, url: null });
  const [busy, setBusy] = React.useState(true);

  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      // 先问状态；没在跑就让宿主拉起来。
      // 不在这里自动起服务会更省事，但用户已经进了这一页，等着的就是他 ——
      // 让他自己去命令行敲东西不是这一页该给的东西。
      let next = await call('/status');
      if (!cancelled && next?.state !== 'running') next = await call('/start', 'POST');
      if (!cancelled) {
        setStatus(next ?? { state: 'failed', reason: '宿主没有返回状态' });
        setBusy(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (!status.url) {
    return (
      <div className="zmc-page">
        <Hint state={status.state} reason={status.reason}/>
        {busy && <p className="zmc-muted">正在启动上游服务…（首次可能要几十秒）</p>}
        {status.lastError && <pre className="zmc-error">{status.lastError}</pre>}
      </div>
    );
  }

  return (
    <div className="zmc-page">
      <iframe
        className="zmc-frame"
        src={status.url}
        title="OpenMAIC 课堂"
        // 上游需要 cookie、剪贴板（复制课件文本）、以及下载（导出 PPTX）。
        allow="clipboard-read; clipboard-write; fullscreen; microphone; autoplay"
      />
    </div>
  );
}

export { ClassroomPage };
