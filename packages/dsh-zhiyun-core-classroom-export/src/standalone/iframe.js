/**
 * 互动页 HTML 的 iframe 适配（srcdoc 里跑得起来的那一版）。
 *
 * 源：ref/OpenMAIC/lib/utils/iframe.ts:14-47（STORAGE_SHIM）
 *     ref/OpenMAIC/lib/utils/iframe.ts 的 `patchHtmlForIframe`（processed 标记 + 注入位置）
 *
 * 上游的完整 patch 还挂两套桥：错误上报（`ERROR_CAPTURE_SHIM`，给编辑器 agent
 * 排查空白页）与观测桥（observation-bridge，按元素回传交互）。这两套都是**在线
 * 教室**的能力，离线文件里没有父窗口接收方，注进去只是白跑脚本。因此这里只保留
 * 离线仍然必需的那一段：内存版 localStorage/sessionStorage。
 *
 * 为什么必需：互动 iframe 的 sandbox 是 `allow-scripts` 而**没有**
 * `allow-same-origin`（两者一起给等于取消沙箱）。null origin 文档里碰
 * `window.localStorage` 会抛 SecurityError，很多生成页在初始化时就读写存储，
 * 一抛就白屏。注入的顺序也有讲究：它必须是文档里的第一个脚本。
 */

const STORAGE_SHIM = `<script data-iframe-storage-shim>
(function () {
  function makeStore() {
    var data = Object.create(null);
    return {
      getItem: function (k) { k = String(k); return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[String(k)] = String(v); },
      removeItem: function (k) { delete data[String(k)]; },
      clear: function () { data = Object.create(null); },
      key: function (i) { var keys = Object.keys(data); return i < keys.length ? keys[i] : null; },
      get length() { return Object.keys(data).length; }
    };
  }
  ['localStorage', 'sessionStorage'].forEach(function (name) {
    var ok = false;
    try { var s = window[name]; if (s) { s.getItem('__probe__'); ok = true; } } catch (e) { ok = false; }
    if (!ok) {
      try { Object.defineProperty(window, name, { value: makeStore(), configurable: true }); } catch (e) {}
    }
  });
})();
</script>`;

const VIEWPORT_META = '<meta name="viewport" content="width=device-width, initial-scale=1">';

/**
 * 让一段作者 HTML 能在 sandbox 的 `srcdoc` 里正常渲染。
 *
 * @param {string} html
 * @param {string} [baseHref] 仅供页面包保留相对资源时使用（离线导出不传）
 * @param {{mediaId?: string, processed?: boolean}} [options]
 * @returns {string}
 */
export function patchHtmlForIframe(html, baseHref, options = {}) {
  let source = String(html ?? '');
  if (!source.trim()) return source;

  const head = [];
  head.push(VIEWPORT_META);
  if (baseHref) head.push(`<base href="${baseHref.replace(/"/g, '&quot;')}">`);
  head.push(STORAGE_SHIM);
  const injection = head.join('');

  if (/<head[^>]*>/i.test(source)) {
    source = source.replace(/(<head[^>]*>)/i, `$1${injection}`);
  } else if (/<html[^>]*>/i.test(source)) {
    source = source.replace(/(<html[^>]*>)/i, `$1<head>${injection}</head>`);
  } else {
    source = `${injection}${source}`;
  }

  if (!/^\s*<!doctype/i.test(source)) source = `<!doctype html>\n${source}`;
  if (options.mediaId && /<html[^>]*>/i.test(source)) {
    source = source.replace(/<html([^>]*)>/i, (_match, attrs) =>
      /data-media-id/i.test(attrs)
        ? `<html${attrs}>`
        : `<html${attrs} data-media-id="${options.mediaId}">`,
    );
  }
  return source;
}
