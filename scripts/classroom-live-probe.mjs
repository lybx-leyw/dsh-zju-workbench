/**
 * 直播链路的**只读探针**。
 *
 * # 它存在的理由
 *
 * `live.js` 里有一处是**推的、没实测过**：`sub_content` 的直出流结构。
 * 代码按「递归找 `stream_m3u8` / `stream_play` 成对合并」兜底，但如果上游
 * 用了别的字段名（`url` / `play_url` / 嵌套数组），`resolveStreams` 会返回
 * 空的 `streams` —— 界面上表现为「这一节现在没有可用的机位」，**不报错、也
 * 不会提示**。那是整套直播里唯一「静默失败」的点，所以单独给它一个探针。
 *
 * 三件事这个脚本要回答：
 *
 *   1. 直播网关收不收我们的请求（Bearer 头对不对）；
 *   2. 拿到的流地址是什么类型、能不能过 `checkTarget` 的白名单；
 *   3. `sub_content` 的**字段结构**（只看键名与类型，不看值）。
 *
 * # 只读，且刻意保守
 *
 * - 不写任何文件、不改 profile、不动会话；
 * - 只发 GET，且只打三类只读端点（时段、课程列表、流详情）；
 * - 不下载分片（那会消耗流量、也可能很慢）：只对 m3u8 清单取前 2 KB
 *   判断它是播放列表还是分片；
 * - **绝不打印完整流地址**：那些地址带 `auth_key` 签名，等同于短期凭据。
 *   输出的是 `classifyMedia()` 之后的形状（scheme/host/path 的有无）。
 *
 * # 用法
 *
 * ```bash
 * # 复用 classroom:verify 已经登录好的会话（推荐）
 * node scripts/classroom-live-probe.mjs --live
 *
 * # 指定日期（默认今天，上海时区）
 * node scripts/classroom-live-probe.mjs --live --date 2026-10-20
 *
 * # 会话过期时现登一次（凭据同 classroom:verify 的约定）
 * node scripts/classroom-live-probe.mjs --live --credentials-file <本机凭据文件>
 *
 * # 打印每条请求的去向
 * node scripts/classroom-live-probe.mjs --live --trace
 * ```
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClassroomSource, ClassroomError } from '../packages/dsh-zhiyun-classroom/src/source.js';
import { mediaType } from '../packages/dsh-zhiyun-classroom/src/live.js';
import { checkTarget, STREAM_ROUTE_PREFIX } from '../packages/dsh-zhiyun-classroom/src/stream.js';
import { inspectJwt } from '../packages/dsh-zhiyun-classroom/src/auth.js';
import { shanghaiDate } from '../packages/dsh-zhiyun-classroom/src/models.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (!args.includes('--live')) {
  console.log('这是只读探针，但真实请求需显式 --live 才发。用法见文件头。');
  process.exit(0);
}
const option = name => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };

/**
 * 把一路地址压成**可安全打印**的形状。
 *
 * 为什么不是直接打 URL：智云 CDN 的地址带 `auth_key=<过期时间戳>-<签名>`，
 * 拿到它的人在窗口期内就能直接拉流。探针的输出会贴进 issue、PR 或聊天记录，
 * 所以只保留「能不能转发」需要的那几项，query 一律只给键名不给值。
 */
function classifyMedia(raw) {
  const text = String(raw ?? '');
  const type = mediaType(text);
  let scheme = '', host = '', pathname = '', queryKeys = [];
  try {
    const url = new URL(text);
    scheme = url.protocol.replace(':', '');
    host = url.hostname;
    pathname = url.pathname;
    queryKeys = [...url.searchParams.keys()];
  } catch { /* 非 http(s) 形态（rtmp/webrtc）解析不出就不用解析 */ }
  // 转发白名单的判定直接复用生产代码：探针和生产必须看同一个答案，
  // 否则「探针说能转、实际 403」这种事又要花一轮去查。
  const gate = checkTarget(text);
  return { type, scheme, host, path: pathname, queryKeys, relayable: gate.ok, rejectReason: gate.ok ? undefined : gate.reason };
}

/**
 * 只取 `sub_content` 的**形状**，不取值。
 *
 * 深度上限 6 是权衡出来的：`sub_content` 常见形态是「对象里套一层 JSON 字符串，
 * 字符串里再是一组流」——那就是 4~5 层，上限给 4 会把 `stream_m3u8` 这类**键名**
 * 一起截成 `…`，而键名正是这个探针要看的东西。给 6 层既够看清真实结构，
 * 又仍然有界（不会因为上游某天返回一棵畸形深树把输出撑爆）。
 *
 * 字符串**永远只报长度**：那个字符串很可能就是一整条带签名的地址。
 */
function shapeOf(value, depth = 0) {
  if (depth > 6) return '…(更深)';
  if (value == null) return 'null';
  if (typeof value === 'string') {
    const nested = value.trim().startsWith('{') || value.trim().startsWith('[');
    // 内嵌 JSON 是最常见的坑：不拆开就会把一整棵子树读成一个字符串。
    if (nested) {
      try { return { __embeddedJson: shapeOf(JSON.parse(value), depth + 1) }; } catch { /* 不是 JSON */ }
    }
    return `string(${value.length})`;
  }
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0], depth + 1)] : [];
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shapeOf(item, depth + 1)]));
}

const report = { checkedAt: new Date().toISOString(), mode: 'live-probe', readonly: true, checks: [] };
const add = (name, value) => { report.checks.push({ name, ...value }); console.log(`${name}: ${JSON.stringify(value, null, 2)}`); };

const source = new ClassroomSource({
  sessionFile: path.join(root, '.runtime', 'classroom-verify', 'session.dpapi'),
  log: args.includes('--trace') ? event => console.log('[trace]', JSON.stringify(event)) : undefined,
});

try {
  // ── 0. 会话 ────────────────────────────────────────────────────────────
  //
  // 会话可能因为三种原因不可用，处理方式不同：
  //   · 没登录过 / 已过期 → 正常，往下走登录流程；
  //   · STORAGE（DPAPI 解不开、文件损坏、沙箱里 spawn 不了 powershell）
  //     → 也往下走登录流程，但**要记一条**，否则用户看到「凭据缺失」会
  //       以为是自己的问题，而真实原因是会话文件本身读不了。
  //   · 网络/结构错误 → 不吞，直接抛（那说明是上游或环境问题）。
  let restored = { authenticated: false };
  if (!args.includes('--fresh')) {
    try {
      restored = await source.restoreSession();
    } catch (error) {
      if (!(error instanceof ClassroomError) || error.code !== 'STORAGE') throw error;
      add('session-restore', {
        warning: '已有的会话文件读不出来，将尝试重新登录',
        code: error.code,
        // 这条错误本身不含凭据，可以原样透出。
        message: error.message,
      });
    }
  }
  if (!restored.authenticated) {
    let username = process.env.ZJU_USER, password = process.env.ZJU_PASS;
    if (!username || !password) {
      const file = option('--credentials-file');
      if (!file) throw new ClassroomError('CREDENTIALS',
        '会话不可用且未提供凭据：用 ZJU_USER/ZJU_PASS 环境变量、或 --credentials-file 指定本机凭据文件；'
        + '若桌面上跑过 npm run classroom:verify -- --live，也可直接用那个会话（通常不必传凭据）');
      const text = await readFile(file, 'utf8');
      const env = {};
      for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([\w]+)\s*=\s*(.*?)\s*$/);
        if (match) env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
      }
      username = env.ZJU_USER; password = env.ZJU_PASS;
    }
    restored = await source.login({ username, password });
  }
  add('session', { authenticated: restored.authenticated, user: restored.user?.id ?? null });

  // ── 1. JWT：直播网关认的是 Bearer，不是 cookie ──────────────────────────
  // 这一步是整条链路最容易「看着通、其实全失败」的地方：没有 Bearer 时上游
  // 回的是「今天没有课」，而不是 401。所以先把 token 的状态打出来。
  const headers = await source.live.authHeaders();
  const token = /^Bearer (.+)$/.exec(headers.authorization ?? '')?.[1] ?? null;
  const meta = inspectJwt(token);
  add('bearer', {
    present: Boolean(token),
    // 只报过期判断，**不打印 token 本身**。
    expiresAt: meta.expiresAt,
    expired: meta.expired,
    malformed: meta.malformed,
  });

  // ── 2. 时段与在播课程 ──────────────────────────────────────────────────
  const date = option('--date') ?? shanghaiDate();
  const quantums = await source.live.listQuantum(date);
  add('quantums', {
    date,
    count: quantums.length,
    // 时段名与时间窗是排课信息，不是私人数据；但课程名要留到下面单独判断。
    windows: quantums.map(q => ({ id: q.quantumId, name: q.name, begin: q.beginTime, end: q.endTime, parsedSec: q.beginSec != null && q.endSec != null })),
  });

  const day = await source.live.listLiveDay(date);
  add('live-day', {
    date,
    count: day.items.length,
    complete: day.meta.complete,
    reason: day.meta.reason,
    // ⚠ 只报数量与状态分布，**不打课程名**：课程名属于个人课表信息。
    liveCount: day.items.filter(item => item.live).length,
    statusLabels: [...new Set(day.items.map(item => item.statusLabel).filter(Boolean))],
  });

  const now = await source.live.listCurrent();
  add('live-current', {
    count: now.items.length,
    note: now.items.length ? '此刻有在播的课' : '此刻没有在播的课（课间、或今天没课）——这不代表链路坏了',
  });

  // ── 3. 取流：这里才是唯一「推的、没实测」的部分 ──────────────────────────
  // 优先挑一场 status_label 说「直播」的；没有就退回列表第一个 ——
  // 已下课的场次也可能有仍有效的流地址，正好用来验证缓存/回退路径。
  const target = now.items.find(item => item.live) ?? day.items.find(item => item.live) ?? day.items[0] ?? null;
  if (!target) {
    add('streams', { skipped: '当天没有任何场次可探（假期/周末常见），换个 --date 再试' });
  } else {
    add('stream-target', { courseId: target.courseId, subId: target.subId, live: target.live, hasStatusLabel: Boolean(target.statusLabel) });

    // 3a. 先看原始 sub_content 的形状。**这一步单独做**，因为 resolveStreams
    //     会把结构吃掉、只回打包后的 streams；结构漂移必须看原始响应。
    let raw = null;
    try {
      const data = await source.transport.json(
        `${source.live.endpoints.streams}?${new URLSearchParams({ all: 1, course_id: target.courseId, sub_id: target.subId,
          with_sub_data: 1, with_room_data: 1, show_all: 1, show_delete: 2 })}`, '直播流裸响应',
        { headers: await source.live.authHeaders() },
      );
      const row = Array.isArray(data.list) ? data.list.find(item => item && typeof item === 'object') : null;
      raw = row ?? null;
      add('raw-fields', {
        // 只看键名：这些是判定「代码里猜的字段名对不对」的唯一依据。
        listLength: Array.isArray(data.list) ? data.list.length : null,
        rowKeys: raw ? Object.keys(raw) : [],
        subContentShape: raw?.sub_content != null ? shapeOf(raw.sub_content) : null,
      });
    } catch (error) {
      add('raw-fields', { error: error instanceof ClassroomError ? error.toJSON() : '裸响应读取失败' });
    }

    // 3b. 再走生产代码那条路，看它把结构解成了什么。
    const resolved = await source.live.resolveStreams(target.courseId, target.subId);
    add('streams', {
      source: resolved.source,
      // 机位 label 是「教师画面」这类，不含个人信息。
      streams: resolved.streams.map(stream => ({ key: stream.key, label: stream.label, ...classifyMedia(stream.watchUrl) })),
      dropped: resolved.dropped.map(item => ({ key: item.key, type: item.type, host: item.host })),
      // 空 streams 是**最需要警惕**的结果：它意味着字段名可能猜错了。
      verdict: resolved.streams.length
        ? '解出可用机位，字段名假设成立'
        : '没解出机位 —— 可能是字段名与 live.js 的假设不符，请看上面 raw-fields 的键名',
    });

    // 3c. 只用 HEAD/前 2 KB 确认清单真的可读，不下载分片。
    const playable = resolved.streams.find(stream => stream.type === 'hls');
    if (playable) {
      let opened = null;
      try {
        opened = await source.transport.request(playable.watchUrl, { auth: false, stream: true, headers: { Range: 'bytes=0-2047' } });
        const text = await opened.response.text();
        add('playlist', {
          status: opened.response.status,
          contentType: opened.response.headers.get('content-type'),
          bytes: text.length,
          isPlaylist: text.trimStart().startsWith('#EXTM3U'),
          // 清单里通常含 1~2 条带签名的分片地址，只报条数不报内容。
          segmentLines: text.split(/\r?\n/).filter(line => line.trim() && !line.trim().startsWith('#')).length,
        });
      } catch (error) {
        add('playlist', { error: error instanceof ClassroomError ? error.toJSON() : '清单读取失败' });
      } finally { await opened?.response.body?.cancel(); opened?.release?.(); }
    } else {
      add('playlist', { skipped: '没有 hls 类型机位，跳过清单探测（flv/rtmp 需要专门客户端）' });
    }
  }

  // ── 4. 转发端点自检（不发网络请求）─────────────────────────────────────
  // 真实宿主里这条前缀是否注册，脚本看不到（那要跑起宿主）。这里只能确认
  // 生产代码里的常量与客户端改写用的常量一致 —— 两者不一致会让所有流 404。
  add('relay', {
    prefix: STREAM_ROUTE_PREFIX,
    note: '真实宿主是否已注册该前缀需跑起工作台后访问 /zhiyun-live/status 确认',
  });

  report.ok = true;
} catch (error) {
  report.ok = false;
  const safe = error instanceof ClassroomError ? error.toJSON() : { code: 'PROBE', message: '探测失败，请检查输入或本机文件' };
  report.failure = safe;
  console.error(JSON.stringify(safe));
  process.exitCode = 1;
} finally {
  await source.dispose().catch(() => {});
  // 只打到 stdout：探针**不落盘**，避免把「一次性的结构猜测验证」变成
  // artifacts 里一份会过期的报告。要留档就自己重定向。
  console.log('\n=== 结论 ===');
  const streams = report.checks.find(c => c.name === 'streams');
  if (streams?.verdict) console.log(streams.verdict);
  const bearer = report.checks.find(c => c.name === 'bearer');
  if (bearer && !bearer.present) console.log('⚠ 没拿到 Bearer：直播每条请求都会失败，且上游只会回「今天没有课」。');
  if (bearer?.expired) console.log('⚠ JWT 已过期：先跑一次 npm run classroom:verify -- --live 刷新会话。');
  console.log(`报告 ok=${report.ok}，共 ${report.checks.length} 项。`);
}
