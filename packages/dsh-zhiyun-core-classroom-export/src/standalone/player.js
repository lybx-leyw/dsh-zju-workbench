/**
 * 内置播放器产物（供 `assemble.js` 内联进 `<script>`）与外部产物的装载口。
 *
 * 参考（只读）：ref/OpenMAIC/lib/standalone-player/**（React 产物，归页面包）
 *
 * 三类来源，优先级从高到低：
 * 1. 调用方显式注入 `assets.script` / `assets.style`（页面包编译好的
 *    `public/vendor/standalone-player/player.min.js`，与上游逐字节一致）；
 * 2. 宿主提供的资源加载器 `loadAsset(path)`（例如从同源 HTTP 取）；
 * 3. 本包的 `player-runtime.js` + `player.css` —— 等价的最小实现，保证
 *    `html()` 永远能产出可直接渲染的完整文档。
 *
 * 注意：内联前必须确认没有 `</script` / `<!--`（由 `assemble.js` 的
 * assertRawText 拒收），所以第 1/2 条来源拿到的产物也要过同一道检查。
 */

import { readFileSync } from 'node:fs';

const PLAYER_SCRIPT = readFileSync(new URL('./player-runtime.js', import.meta.url), 'utf8');
const PLAYER_STYLE = readFileSync(new URL('../../assets/player.css', import.meta.url), 'utf8');

export function builtinPlayerAssets() {
  return { script: PLAYER_SCRIPT, style: PLAYER_STYLE };
}

/**
 * 解析本次导出实际使用的播放器资产。
 *
 * @param {{assets?: {script?: string, style?: string, mathFonts?: string, charts?: string},
 *          loadAsset?: (path: string) => Promise<string>,
 *          paths?: {script: string, style: string, mathFonts?: string, charts?: string}}} [options]
 * @returns {Promise<{script: string, style: string, mathFonts?: string, charts?: string, source: string}>}
 */
export async function resolvePlayerAssets(options = {}) {
  const injected = options.assets ?? {};
  const builtin = builtinPlayerAssets();

  const load = async (kind, path) => {
    if (injected[kind]) return { value: injected[kind], source: 'injected' };
    if (typeof options.loadAsset === 'function' && path) {
      try {
        return { value: await options.loadAsset(path), source: 'host' };
      } catch {
        // 宿主没有这份产物：继续往内置实现退。
      }
    }
    return { value: builtin[kind], source: 'builtin' };
  };

  const script = await load('script', options.paths?.script);
  const style = await load('style', options.paths?.style);
  const mathFonts = await load('mathFonts', options.paths?.mathFonts);
  const charts = await load('charts', options.paths?.charts);

  return {
    script: script.value,
    style: style.value,
    // 数学字体 / 图表运行时只在需要时内联（源：build-standalone-html.ts:694-699）。
    ...(mathFonts.source === 'builtin' ? {} : { mathFonts: mathFonts.value }),
    ...(charts.source === 'builtin' ? {} : { charts: charts.value }),
    source: script.source,
  };
}
