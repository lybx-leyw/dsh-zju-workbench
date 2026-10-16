// 加载页：只显示启动状态。宿主一就绪，主进程就把窗口导航到实例地址，这一页随之消失。
//
// 刻意**不引入任何依赖、不发任何网络请求**（CSP 写成 default-src 'none'）：
// 它是壳自己的界面，与产品无关，越简单越不会在"产品还没起来"的时候先坏掉。
const detail = document.getElementById('detail');
const hint = document.getElementById('hint');
const logbox = document.getElementById('logbox');
const log = document.getElementById('log');
const retry = document.getElementById('retry');
const dot = document.querySelector('.dot');

function render(state) {
  if (!state) return;
  document.body.dataset.phase = state.phase;
  detail.textContent = state.detail ?? '';
  dot.dataset.phase = state.phase;

  const hasHint = Boolean(state.hint);
  hint.hidden = !hasHint;
  if (hasHint) hint.textContent = state.hint;

  const lines = Array.isArray(state.log) ? state.log : [];
  // 日志只在出错时默认展开：正常启动的几秒钟里，抖动的日志比进度更让人不安。
  logbox.hidden = lines.length === 0;
  if (lines.length > 0) {
    log.textContent = lines.join('\n');
    if (state.phase === 'error') logbox.open = true;
  }
  retry.hidden = state.phase !== 'error';
}

retry.addEventListener('click', () => {
  retry.disabled = true;
  window.launcher.retry();
  // 主进程会推新状态；这里先恢复按钮，避免状态推送失败时按钮永久禁用。
  setTimeout(() => { retry.disabled = false; }, 500);
});

window.launcher.onState(render);
window.launcher.snapshot().then(render).catch(() => {});
