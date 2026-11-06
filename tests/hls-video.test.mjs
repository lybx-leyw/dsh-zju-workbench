/**
 * `HlsVideo`：**非 HLS 地址必须拿到原生 `src`**。
 *
 * # 这条测试守的是一个真实故障
 *
 * 初版只在「hls.js 挂载失败」时才把 `src` 交给原生 `<video>`。于是普通 mp4
 * **永远没有 `src`**：
 *
 *   - effect 里 `needsHlsJs()` 对 mp4 返回 false → 直接 return，不接线；
 *   - 渲染时 `src` 又因为不在 fallback 状态而缺席；
 *   - 结果是一个没有源的 `<video>`：不报错、不提示，就是点开没反应。
 *
 * 智云回放的 `playback.url` 恰恰是 `.mp4` 直链（实测
 * `https://resource.cmc.zju.edu.cn/play/2/content/video/pdefault/..._1920_1080.mp4`），
 * 所以这个 bug 会 100% 命中每一节回放。
 *
 * # 为什么用 esbuild 现打一份
 *
 * node 不能直接 import `.jsx`。仓库里已有先例（`planning-render.test.mjs`）：
 * 用 esbuild 打成 ESM 再 import。React 必须 external —— 打进来会变成第二份
 * React，hooks 拿到 null dispatcher。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

/**
 * 把 `hls-video.jsx` 打成一个可 import 的 ESM。
 *
 * `./hls.js` 里的 `attach` 会动态 import hls.js —— 这里换成桩，
 * 因为本测试只关心「`<video>` 上有没有 src」，不关心真去拉流。
 *
 * ⚠️ 产物必须落在**仓库内**（`.verify-render-*`）。写到 `os.tmpdir()` 会因
 *    Windows 上的目录权限被 esbuild 拒绝（Access is denied）——
 *    与 `planning-render.test.mjs` 踩过的是同一个坑。
 *
 * @returns `{ HlsVideo, dir }`。
 */
async function loadComponent() {
  const { build } = await import('esbuild');
  const dir = await mkdtemp(path.join(root, '.verify-render-'));
  const outfile = path.join(dir, 'hls-video.mjs');
  await build({
    entryPoints: [path.join(root, 'packages/dsh-zhiyun-page-study/src/hls-video.jsx')],
    bundle: true,
    write: true,
    outfile,
    format: 'esm',
    jsx: 'automatic',
    logLevel: 'silent',
    external: ['react', 'react/jsx-runtime', 'react-dom'],
    plugins: [{
      name: 'stub-hls',
      setup(builder) {
        builder.onResolve({ filter: /^\.\/hls\.js$/ }, () => ({ path: 'hls-stub', namespace: 'stub' }));
        builder.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({
          contents: `
            // 与真实 hls.js 的导出面保持一致
            const HLS_PATTERN = /\\.m3u8(?:[?#]|$)/i;
            export function isHlsUrl(url) {
              if (typeof url !== 'string' || !url.trim()) return false;
              if (HLS_PATTERN.test(url)) return true;
              const m = /\\?u=([^&]+)/.exec(url);
              if (!m) return false;
              try { return HLS_PATTERN.test(decodeURIComponent(m[1])); } catch { return false; }
            }
            export function nativeHls() { return false; }
            export function needsHlsJs(url, video) {
              return isHlsUrl(url) && Boolean(video) && !nativeHls(video);
            }
            export async function attach() { return () => {}; }
          `,
          loader: 'js',
        }));
      },
    }],
  });
  const mod = await import(`file://${outfile.replace(/\\/g, '/')}`);
  return { mod, dir };
}

const { mod: { HlsVideo }, dir } = await loadComponent();
test.after?.(() => rm(dir, { recursive: true, force: true }).catch(() => {}));

const { renderToStaticMarkup } = await import('react-dom/server');
const React = (await import('react')).default;

const MP4 = 'https://resource.cmc.zju.edu.cn/play/2/content/video/pdefault/2026/09/17/abc_1920_1080.mp4';
const M3U8 = 'https://video.cmc.zju.edu.cn/live/abc.m3u8?sign=1';
const html = (props) => renderToStaticMarkup(React.createElement(HlsVideo, props));

test('mp4 直链必须渲染出 src（否则播放器是个空壳）', () => {
  const out = html({ src: MP4 });
  assert.match(out, /<video/, '应当渲染 video 元素');
  assert.ok(out.includes(`src="${MP4}"`), `mp4 必须有 src，实际: ${out.slice(0, 200)}`);
});

test('m3u8 首次渲染**不带** src（要等 effect 判断原生还是 hls.js）', () => {
  const out = html({ src: M3U8 });
  assert.match(out, /<video/);
  assert.equal(out.includes('src='), false, `HLS 首屏不该给 src，实际: ${out.slice(0, 200)}`);
});

test('空地址不渲染 src 也不报错', () => {
  for (const value of ['', undefined, null]) {
    const out = html({ src: value });
    assert.match(out, /<video/);
    assert.equal(out.includes('src='), false, `src=${String(value)} 不该有 src`);
  }
});

test('协议相对的 mp4 也要给 src', () => {
  const out = html({ src: '//resource.cmc.zju.edu.cn/play/2/x.mp4' });
  assert.ok(out.includes('src="//resource.cmc.zju.edu.cn/play/2/x.mp4"'));
});

test('带查询串但路径是 .mp4 的仍算非 HLS', () => {
  const url = 'https://resource.cmc.zju.edu.cn/play/2/x.mp4?token=abc';
  const out = html({ src: url });
  assert.ok(out.includes(`src="${url}"`), '查询串不该影响 mp4 判定');
});

test('查询串里藏着 m3u8 的转发地址仍按 HLS 处理（不给原生 src）', () => {
  const url = 'http://127.0.0.1:3092/zhiyun-live/hls?u=' + encodeURIComponent(M3U8);
  const out = html({ src: url });
  assert.equal(out.includes('src='), false, '转发的 HLS 必须走 hls.js 分支');
});

test('mp4 时 live 标志不该影响 src（直播也可能给 flv/mp4 兜底）', () => {
  const out = html({ src: MP4, live: true });
  assert.ok(out.includes(`src="${MP4}"`));
  assert.match(out, /autoplay/, '直播要自动播');
  assert.match(out, /muted/, '自动播必须静音，否则被浏览器拦');
});
