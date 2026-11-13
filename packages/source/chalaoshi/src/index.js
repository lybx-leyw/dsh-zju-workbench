/**
 * 查老师数据源的宿主入口。
 *
 * # 分层（D17）
 *
 * 纯只读数据源：`ctx.provide('zwChalaoshi')` + 一条同源数据路由。
 * **不注册 AI 工具**、**无写操作**。
 *
 * # 索引缓存放在哪
 *
 * `profileContext.dir` 下的 `chalaoshi-index.json`。约 1 MB，一万多位教师；
 * 缓存是**离线可用性**的关键 —— 这个站点在国内不可达，有缓存才能搜。
 */
import { mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';
import path from 'node:path';
import { sharedFetch } from '@lybx-leyw/dsh-zju-source-http';
import {
  SITE, ChalaoshiError, IndexCache, fetchCourseGpa, fetchIndex, fetchTeacherPage, searchIndex,
} from './chalaoshi.js';

export const name = 'zju-source-chalaoshi';

/** 需要出口与数据目录。 */
export const inject = ['profileContext'];

/** 同源数据路由。 */
export const ROUTE_PATH = '/api/zw-chalaoshi';

/**
 * 刷新失败后的冷却期。
 *
 * 站点在国内不可达，失败可能挂很久；没有冷却期时缓存一过期就每次 search 都重试。
 * 上游用「按主机缓存通断 10 分钟」的等价做法。
 */
const FAILURE_BACKOFF_MS = 10 * 60_000;

/**
 * 把 `sharedFetch` 适配成数据层期望的形状。
 *
 * @param ctx - 宿主上下文。
 * @returns `(url, init) => Promise<{status, headers, text}>`。
 */
const requestOf = (ctx) => async (url, init = {}) => {
  const response = await sharedFetch(ctx)(url, init);
  return { status: response.status, headers: response.headers, text: await response.text() };
};

/**
 * 插件主体。
 *
 * @param ctx - 宿主上下文。
 * @returns 卸载函数。
 */
export function apply(ctx) {
  return ctx.effect(() => {
    const file = path.join(ctx.profileContext.dir, 'chalaoshi-index.json');

    /**
     * 上次刷新失败的时间与原因。
     *
     * # 为什么需要负缓存
     *
     * 站点在国内不可达。没有这一条时，缓存一过期，**每次 search 都会重走一遍
     * 失败刷新**（一次失败可能挂很久），用户感觉「搜索卡住」。
     * 上游用 `requireReachable` 按主机缓存通断 10 分钟（`core/reach.ts:14`）。
     */
    let lastFailure = null;

    const cache = new IndexCache({
      load: () => {
        try {
          return JSON.parse(readFileSync(file, 'utf8'));
        } catch (error) {
          // 缓存不存在或损坏都当作「没有缓存」——搜索会退化成需要联网，
          // 而不是把一个坏文件当成空索引（那会让搜索结果静默变空）。
          // 但要区分「读不到」与「读到了但内容坏」：前者正常（首次运行），
          // 后者值得记一笔，否则用户永远不知道缓存被替换过。
          if (error?.code !== 'ENOENT') lastFailure = { at: Date.now(), reason: `缓存读取失败：${error?.code ?? error?.message}` };
          return undefined;
        }
      },
      // ⚠️ 原子写：直接 `writeFile` 在写入中途崩溃会留下截断的 JSON，
      // 而 `load` 的 catch 会把它当成「没有缓存」→ 下次 search 直接 UNREACHABLE。
      // 这个包的全部价值就是那份缓存，不能让它因为一次断电消失。
      save: async (index) => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFileAtomic(file, JSON.stringify(index));
      },
    });

    /** 取索引：新鲜就用缓存，否则条件 GET；拉不到但有缓存时沿用。 */
    const index = async ({ fresh = false } = {}) => {
      const cached = cache.read();
      if (cached && !fresh && cache.fresh(cached)) return { index: cached, sync: { source: 'cache', teachers: cached.teachers.length } };

      // 负缓存：刚失败过就不要再试，直接用缓存（或报上一次的错误）。
      if (!fresh && lastFailure && Date.now() - lastFailure.at < FAILURE_BACKOFF_MS) {
        if (cached) {
          return {
            index: cached,
            sync: {
              source: 'cache',
              teachers: cached.teachers.length,
              fetchedAt: cached.fetchedAt,
              ageMs: Date.now() - cached.fetchedAt,
              degraded: lastFailure.reason,
              retryInMs: FAILURE_BACKOFF_MS - (Date.now() - lastFailure.at),
            },
          };
        }
        throw new ChalaoshiError('UNREACHABLE', `查老师索引拉不到（${lastFailure.reason}）。这个站点在国内公网不可达，需要本机能出海；WebVPN 帮不上忙。`);
      }

      let result;
      try {
        result = await fetchIndex({ request: requestOf(ctx), cached, fresh });
      } catch (error) {
        lastFailure = { at: Date.now(), reason: String(error?.message ?? error) };
        throw error;
      }
      lastFailure = null;

      // 只有真的可能变了才写盘：`downloaded`（有新数据）与 `not-modified`
      // （304，只更新 fetchedAt）都写；`cache` 是降级路径，数据没变，
      // 写它等于每次失败搜索都重写 1 MB。
      if (result.sync?.source !== 'cache') {
        await cache.write(result.index);
      }
      return result;
    };

    const service = {
      routePath: ROUTE_PATH,
      platform: 'chalaoshi',
      label: '查老师',
      readOnly: true,
      methods: ['chalaoshi.search', 'chalaoshi.teacher', 'chalaoshi.course'],
      site: SITE,
      /** 索引状态（不联网）：有没有缓存、多少位教师、多久前拉的。 */
      indexStatus() {
        const cached = cache.read();
        if (!cached) return { cached: false };
        return {
          cached: true,
          teachers: cached.teachers.length,
          colleges: cached.colleges.length,
          fetchedAt: cached.fetchedAt,
          ageMs: Date.now() - cached.fetchedAt,
          fresh: cache.fresh(cached),
        };
      },
      /** 拉/刷新索引。 */
      refresh: (options) => index(options),
      /**
       * 本地搜索。
       *
       * @param input - `{ keyword, sort?, limit?, ratedOnly?, college? }`。
       * @returns 命中列表与计数。
       */
      async search(input = {}) {
        const { index: loaded, sync } = await index({ fresh: input.fresh === true });
        const hits = searchIndex(loaded, String(input.keyword ?? ''), {
          sort: input.sort, limit: input.limit, ratedOnly: input.ratedOnly,
        });
        // `college` 是二次过滤：`searchIndex` 已经把「能对上学院名的 token」当过滤条件了，
        // 这里补一个显式的按学院缩小（例如关键词是姓名、但只想看某个学院）。
        const narrowed = input.college
          ? hits.filter((hit) => hit.college.includes(String(input.college)))
          : hits;
        return { count: narrowed.length, teachers: narrowed, sync };
      },
      /** 读一位教师的详情页（会打站点；国内网络下多半失败）。 */
      teacher(input = {}) {
        return fetchTeacherPage({ request: requestOf(ctx), id: input.id });
      },
      /**
       * 一门课所有任课老师的平均绩点（上游 `chalaoshi course`，审计 W-14）。
       *
       * 与 `teacher` 一样**必须联网**：索引里没有绩点表。
       */
      course(input = {}) {
        return fetchCourseGpa({ request: requestOf(ctx), course: input.course ?? input.name });
      },
    };

    const disposeService = ctx.provide('zwChalaoshi', service);

    let removeRoute = null;
    ctx.inject(['webServer'], (scope) => {
      removeRoute = scope.webServer.register({
        kind: 'exact',
        path: ROUTE_PATH,
        handler: async (req, res) => {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
          try {
            const body = await new Promise((done, fail) => {
              const chunks = [];
              req.on('data', (chunk) => chunks.push(chunk));
              req.on('end', () => done(Buffer.concat(chunks).toString('utf8')));
              req.on('error', fail);
            });
            const input = body ? JSON.parse(body) : {};
            const action = input?.action;
            if (action === 'search') {
              res.end(JSON.stringify({ ok: true, value: await service.search(input.input ?? {}) }));
            } else if (action === 'teacher') {
              res.end(JSON.stringify({ ok: true, value: await service.teacher(input.input ?? {}) }));
            } else if (action === 'course') {
              res.end(JSON.stringify({ ok: true, value: await service.course(input.input ?? {}) }));
            } else if (action === 'index-status') {
              res.end(JSON.stringify({ ok: true, value: service.indexStatus() }));
            } else if (action === 'refresh') {
              res.end(JSON.stringify({ ok: true, value: { teachers: (await service.refresh(input.input ?? {})).index.teachers.length } }));
            } else {
              throw new ChalaoshiError('CONFIG', `不认识的操作：${action ?? '(空)'}`);
            }
          } catch (error) {
            res.end(JSON.stringify({ ok: false, error: { code: error?.code ?? 'FAILED', message: String(error?.message ?? error) } }));
          }
        },
      });
    });

    return () => {
      removeRoute?.();
      disposeService?.();
    };
  }, 'zju: chalaoshi data source');
}
