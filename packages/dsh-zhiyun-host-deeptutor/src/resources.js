/**
 * 标准学习资源的宿主侧登记处：**校验 → 签章 → 不可变快照 → 句柄**。
 *
 * # 依赖方向：本文件**不 import 任何业务包**
 *
 * `validate` / `contentHash` 由调用方注入（契约 §13），本文件不知道它们从哪来。
 * 这是有意的：`host-deeptutor` 是本仓最重的宿主包（60MB vendor + Python 运行时），
 * 让它反向依赖一个纯数据校验包，只为了省两个参数，会让 `resources.js` 永远无法被单独取用。
 * 而它真正需要的只是**两个纯函数**。
 *
 * 两个函数**都必须给**，缺任一在构造期就抛（见 `createResourceRegistry` 开头）：
 * 静默降级成"不校验直接落盘"是最坏的结果 —— 快照看起来完全合法，实际从没校验过，
 * 之后所有人都会认为它是好的。宁可炸在接线点上。
 *
 * # 为什么"先校验再落盘"（顺序不能反，也不能省）
 *
 * 反过来的话，一份不合法的资源会先拿到一个看起来正常的 `revision`，然后被按
 * `<revision>.json` 写进快照目录。而 `revision` 是内容指纹：它存在就等于宣告
 * "这份内容被认可过"。派生资源（题目、讲解）会把 revision 记在自己身上，
 * 于是污染会沿着缓存一路扩散。
 *
 * 唯一的顺序妥协写在 `fillDerived` 的注释里：schema 把 `revision` / `contentHash` /
 * `generatedAt` 也列为必填，而它们本身是派生的 —— 所以先把这三个补齐再校验，
 * **只补这三个字段，内容字段一个字节都不改**。
 *
 * # 快照为什么不可变
 *
 * run 指纹（契约 §8）包含 `resourceRevisions`。同一 revision 下的快照若能改，
 * 派生资源就会指向"名义上同一版、实际已经变了"的正文 —— 缓存命中变缓存污染。
 * 所以用 `flag: 'wx'`（独占创建）：
 * - 成功 → 这是该 revision 唯一的副本；
 * - `EEXIST` → 已有同 revision 快照，**复用，不重写**。"同一份终稿被 attach 两次"
 *   是正常行为（页面重开、插件重载），必须幂等而不是报错。
 *
 * # release 为什么不删快照
 *
 * 句柄的寿命是"这次 run / 这个页面"，快照的寿命是"这个 revision 还有人引用"。
 * 两者不是一回事：一个页面放掉句柄时，另一个 run 可能正拿着同 revision 的 handle 读同一份文件。
 * 删文件需要跨进程的引用计数，而宿主重启后计数就丢了 —— 那件事根本做不对。
 * 所以 `release` 只摘句柄，磁盘清理交给显式维护动作 `prune()`。
 *
 * # 文件名里的冒号
 *
 * `revision` 形如 `sha256:<64 hex>`，而 Windows 文件名不允许 `:`。
 * 落盘时把非 `[A-Za-z0-9._-]` 字符换成 `-`：`sha256:abc…` → `sha256-abc….json`。
 * 该映射在本 schema 的 revision 形状上是单射（`sha256` 前缀不含 `-`），不会撞名。
 *
 * # ⚠️ 已知的 kind 降级（待协议层扩枚举）
 *
 * 本文件用到的 `E_INTERNAL`（接线错误）与 `E_RESOURCE_INVALID`（资源不合法）目前
 * **不在** `protocol.js` 的 `ERROR_KINDS` 里，而 `DeepTutorError` 构造器对未知 kind
 * 会静默降级成 `E_UPSTREAM_ERROR`（见 `protocol.js:119`）。也就是说前端拿到的
 * `kind` 是 `E_UPSTREAM_ERROR`，只有 `message` 能区分「校验没过」和「上游炸了」。
 *
 * 没有在本文件里改成 `E_UPSTREAM_ERROR` 将就：那会让日志里彻底失去「这是本地数据问题、
 * 不是上游问题」这个关键区分。正确修法是在 `protocol.js` 的 `ERROR_KINDS` 里补两个值
 * —— 那是协议层的枚举，归 Lead 所有，本文件不越权改。
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DeepTutorError } from './protocol.js';

/** schema 里 revision / contentHash 的形状；用于判断调用方给的值能不能直接用。 */
const SHA256_RE = /^sha256:[0-9a-f]{64}$/;

/** 快照文件名：revision → 文件系统安全的名字（见文件头"文件名里的冒号"）。 */
export function snapshotFileName(revision) {
  return `${String(revision).replace(/[^A-Za-z0-9._-]/g, '-')}.json`;
}

/**
 * 本地规范化序列化（递归键排序 + 无空格稳定 JSON）。
 *
 * ⚠️ 这份实现与 `dsh-zhiyun-core-learning-resource/src/hash.js` 的 `canonicalJson`
 * **必须逐字节一致**：`revision` 的兜底计算（见 `revisionFor`）依赖它。
 * 语义约定（README 里也写了）：`undefined` 被**丢弃**、`null` **保留** ——
 * 否则 `subId: undefined` 与 `subId: null` 会打出两个哈希，同一份终稿在两台机器上
 * revision 不同，指纹随之失效。
 *
 * ⚠️ 为什么不注入它：注入 `contentHash` 已经足够覆盖"内容 → 指纹"这条主路径；
 * revision 兜底只在校验方没给 revision 时才会走到，而那时调用方本来也没签章过。
 * 为它再开第三个注入参数，会让接线面变大而收益为零。
 */
export function canonicalJson(value) {
  const sortDeep = (input) => {
    if (Array.isArray(input)) return input.map((item) => (item === undefined ? null : sortDeep(item)));
    if (input instanceof Date) return input.toISOString();
    if (input && typeof input === 'object') {
      const out = {};
      for (const key of Object.keys(input).sort()) {
        const item = input[key];
        if (item === undefined || typeof item === 'function' || typeof item === 'symbol') continue;
        out[key] = sortDeep(item);
      }
      return out;
    }
    return input;
  };
  const sorted = sortDeep(value);
  return JSON.stringify(sorted === undefined ? null : sorted);
}

function sha256(text) {
  return createHash('sha256').update(String(text), 'utf8').digest('hex');
}

/**
 * revision 兜底计算：内容哈希 + 资源身份。
 *
 * 与 core 的 `revisionOf({schemaVersion, resourceId, accountScope, courseId, subId, contentHash})`
 * **同构**（同一组键、同一套规范化），所以两条路算出同一个值。
 * 为什么要把身份也算进去：两个账号恰好投影出完全相同的空讲义时，
 * 不能让它们互相顶掉对方的快照 —— 快照路径是 `<revision>.json`，一条路径只能有一份内容。
 *
 * `undefined` 一律折成 `null`（见 `canonicalJson` 的语义约定），保证确定性。
 */
export function revisionFor(bundle, digest) {
  return `sha256:${sha256(canonicalJson({
    schemaVersion: bundle?.schemaVersion ?? null,
    resourceId: bundle?.resourceId ?? null,
    accountScope: bundle?.accountScope ?? null,
    courseId: bundle?.courseId ?? null,
    subId: bundle?.subId ?? null,
    contentHash: digest,
  }))}`;
}

/**
 * 补齐三个**派生**字段（浅拷贝，不改原对象）。
 *
 * - `generatedAt`：调用方给了就**保留**（重放一份历史资源不该伪造新的生成时刻）。
 * - `contentHash`：**永远重算**。
 * - `revision`：**永远重算**，不沿用调用方给的值。
 *
 * 为什么 revision 必须重算而不是"形状合法就沿用"：快照路径是 `<revision>.json`，
 * 且"已存在就复用"。若调用方给了一个与内容不符的 revision，
 * 我们会把一个**不同内容的旧快照**当成这份资源的正文交给上游 —— 缓存命中变成缓存污染，
 * 而且因为 revision 看起来完全合法，出错时没有任何线索。重算一次哈希的代价可以忽略。
 *
 * 重算不会"换掉"合法资源的值：core 的 `stamp()` 用的是同一套规范化与同一组键，
 * 同一份内容在两条路径上得到同一个 revision（`tests/learning-resource.test.mjs` 钉住了这点）。
 */
function fillDerived(bundle, contentHash) {
  const digest = contentHash(bundle);
  const generatedAt = typeof bundle.generatedAt === 'string' && bundle.generatedAt !== ''
    ? bundle.generatedAt
    : new Date().toISOString();
  return { ...bundle, generatedAt, contentHash: digest, revision: revisionFor(bundle, digest) };
}

/** 只读快照的反序列化：坏文件不抛，返回 null 让调用方降级。 */
async function readSnapshotFile(snapshotPath) {
  try {
    return JSON.parse(await readFile(snapshotPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * 建资源登记处（契约 §13）。
 *
 * @param dataDir 数据目录；快照落在 `<dataDir>/snapshots/`
 * @param validate **必填**：`(bundle) => { valid, errors }`
 * @param contentHash **必填**：`(bundle) => 'sha256:…'`
 * @param logger 可选：`{debug,info,warn,error}`
 */
export function createResourceRegistry({ dataDir, validate, contentHash, logger = {} } = {}) {
  // 三个构造期事实缺失都没法兜底：猜一个数据目录或猜一份校验实现，
  // 换来的只会是"资源没了 / 校验没生效"这类极难排查的现象。
  if (typeof dataDir !== 'string' || dataDir === '') {
    throw new DeepTutorError('E_INTERNAL', 'createResourceRegistry 需要 dataDir（资源快照的落盘根目录）');
  }
  if (typeof validate !== 'function' || typeof contentHash !== 'function') {
    throw new DeepTutorError(
      'E_INTERNAL',
      '资源注册表需要注入 validate 与 contentHash（由 dsh-zhiyun-core-learning-resource 提供）；'
      + '本包不 import 业务包，避免宿主包反向依赖资源包',
    );
  }
  const snapshotsDir = join(dataDir, 'snapshots');

  /** @type {Map<string, object>} */
  const handles = new Map();
  let disposed = false;
  let dirReady = null;

  function warn(message, detail) {
    try {
      logger.warn?.(message, detail);
    } catch {
      // 外部 logger 可能是个坏掉的桩；它抛错不能污染资源流程。
    }
  }

  function ensureDir() {
    if (!dirReady) {
      dirReady = mkdir(snapshotsDir, { recursive: true }).catch((error) => {
        // 不缓存已拒绝的 promise：磁盘临时满 / 权限被短暂锁住时，下次 attach 还能成功。
        dirReady = null;
        throw error;
      });
    }
    return dirReady;
  }

  return {
    /**
     * 登记一份资源：补齐派生字段 → 校验 → 落不可变快照 → 返回句柄。
     *
     * 校验不通过时**一个字节都不写**（快照目录连碰都不碰）。
     */
    async attach(bundle) {
      if (disposed) {
        throw new DeepTutorError('E_DISABLED', '资源登记处已释放，不能再 attach 新资源');
      }
      if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
        throw new DeepTutorError('E_RESOURCE_INVALID', 'attach 需要一个标准学习资源对象（schema v1）');
      }

      // 1) 补三个派生字段（见 fillDerived 注释：只动这三个）。
      //    ⚠️ 这里只做纯计算，不碰磁盘 —— 校验失败时绝不能留下半个快照。
      const sealed = fillDerived(bundle, contentHash);

      // 2) 校验。不合法就抛，把前 6 条错误拼进 message（完整列表在 error.detail.errors）。
      let result;
      try {
        result = validate(sealed);
      } catch (error) {
        // 校验器自己抛（例如 schema 读不出来）也要包成契约里的错误形状。
        throw new DeepTutorError('E_RESOURCE_INVALID', `校验资源时出错：${error?.message ?? String(error)}`, {
          cause: String(error?.message ?? error),
        });
      }
      if (!result || result.valid !== true) {
        const errors = Array.isArray(result?.errors) ? result.errors : [];
        const summary = errors.slice(0, 6)
          .map((item) => `${item?.path === '' ? '(根)' : item?.path ?? '?'}: ${item?.message ?? ''}`)
          .join('；');
        throw new DeepTutorError(
          'E_RESOURCE_INVALID',
          `学习资源不符合 schema，拒绝登记：${summary || '未知原因'}${errors.length > 6 ? `；另有 ${errors.length - 6} 处错误` : ''}`,
          { errors },
        );
      }

      // 3) 落不可变快照。`sealed.revision` 此时一定是合法形状（fillDerived 保证）。
      const snapshotPath = join(snapshotsDir, snapshotFileName(sealed.revision));
      await ensureDir();
      try {
        await writeFile(snapshotPath, `${JSON.stringify(sealed, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
      } catch (error) {
        if (error?.code !== 'EEXIST') {
          // 写不进去是硬故障：返回"句柄指向不存在的快照"的假成功比失败更糟。
          throw new DeepTutorError('E_UPSTREAM_ERROR', `写入资源快照失败：${error?.message ?? String(error)}`, {
            revision: sealed.revision,
          });
        }
        // 已存在 = 同一 revision 的快照早就在，复用（见文件头）。
        warn('资源快照已存在，复用不可变副本', { revision: sealed.revision });
      }

      const handle = {
        handleId: `rh_${randomUUID()}`,
        resourceId: String(sealed.resourceId ?? ''),
        revision: sealed.revision,
        snapshotPath,
        accountScope: { ...(sealed.accountScope ?? {}) },
        courseId: sealed.courseId ?? null,
        subId: sealed.subId ?? null,
        // 以下不在契约的最小 handle 里，但服务面 / 账本每次都要用，跟着句柄走省一次磁盘读。
        contentHash: sealed.contentHash,
        title: sealed.title ?? '',
        attachedAt: new Date().toISOString(),
      };
      handles.set(handle.handleId, handle);
      return handle;
    },

    /**
     * 放掉一个句柄。**不删快照**（见文件头）。
     *
     * 未知句柄是空操作而不是错误：卸载路径上出现两次 release
     * （页面卸载 + 插件 dispose）是常态。
     */
    async release(handleId) {
      handles.delete(String(handleId ?? ''));
    },

    /** 取句柄（内存，同步）。找不到返回 null。 */
    get(handleId) {
      return handles.get(String(handleId ?? '')) ?? null;
    },

    /** 读快照正文。句柄丢了 / 文件坏了都返回 null，不抛。 */
    async snapshot(handleId) {
      const handle = handles.get(String(handleId ?? ''));
      if (!handle) return null;
      return readSnapshotFile(handle.snapshotPath);
    },

    /** 按 revision 直读快照（不要求手里有句柄：重放 / 审计路径用）。 */
    async snapshotByRevision(revision) {
      return readSnapshotFile(join(snapshotsDir, snapshotFileName(revision)));
    },

    /** 当前活着的句柄（诊断 / UI 用；按登记先后）。 */
    list() {
      return [...handles.values()];
    },

    /** 快照目录（诊断用，不做 I/O）。 */
    get snapshotsDir() {
      return snapshotsDir;
    },

    /**
     * 显式清理快照。
     *
     * 这是维护动作，不在 attach / release 路径上（见文件头）。
     * 仍在句柄表里的快照永不删除。
     */
    async prune({ keepRevisions = null, keepSince = null } = {}) {
      let names = [];
      try {
        names = await readdir(snapshotsDir);
      } catch {
        return { removed: 0, kept: 0 };
      }
      const allow = keepRevisions ? new Set([...keepRevisions].map((revision) => snapshotFileName(revision))) : null;
      const sinceMs = keepSince ? Date.parse(String(keepSince)) : Number.NaN;
      let removed = 0;
      let kept = 0;
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const path = join(snapshotsDir, name);
        const live = [...handles.values()].some((handle) => handle.snapshotPath === path);
        let recent = false;
        if (Number.isFinite(sinceMs)) {
          try {
            recent = (await stat(path)).mtimeMs >= sinceMs;
          } catch {
            recent = false;
          }
        }
        const keep = live || recent || allow === null || allow.has(name);
        if (keep) {
          kept += 1;
          continue;
        }
        try {
          await rm(path, { force: true });
          removed += 1;
        } catch (error) {
          warn('删除资源快照失败', error?.message ?? String(error));
        }
      }
      return { removed, kept };
    },

    /** 释放全部句柄（不删快照）。之后 attach 抛 `E_DISABLED`。 */
    async dispose() {
      disposed = true;
      handles.clear();
    },
  };
}

/**
 * 上游 TurnRequest 用的紧凑结构（契约 §13）。
 *
 * # 为什么不直接把 bundle 塞给上游
 *
 * `bundle` 带着 `accountScope`、`warnings`、`reviewStatus` 这些**宿主内政**
 * （账号归属、流水线告警、审核状态）。原样塞进上游请求有两个后果：prompt 里混进
 * 用户不该看到的内部信息，而且请求体无谓变大（每轮 turn 都要发一次）。
 *
 * # 为什么一定带 anchorIndex
 *
 * 上游产出（题目 / 追问 / 讲解）必须能**回到来源**：用户点一下要跳到讲义的那一页、
 * 那一秒。`references` 是给上游看的紧凑来源列表（页码 + 时段 + 块 id），
 * `anchorIndex` 是给**回程**反查用的完整映射。少了任何一个，
 * "这道题出自第 3 页"在回程就没有落点 —— 来源定位链断在这里，后面补不回来。
 *
 * @param handle `attach()` 返回的句柄
 * @param bundle 那份资源（attach 前的原对象也行；本函数不重新校验）
 * @param options.projection 传入 `project()` 的结果即可复用它的选择器语义与 text 排版
 * @param options.maxChars 正文超过这个长度就截断（0 / 缺省 = 不截断）
 */
export function toUpstreamResourcePayload(handle, bundle, options = {}) {
  const resource = bundle && typeof bundle === 'object' ? bundle : {};
  // 投影逻辑住在 core 包里（`project()`）；本文件不 import 业务包，
  // 所以接受调用方把投影结果传进来。没传就退化成"按块拼正文"，但 **anchorIndex 照旧带上**
  // —— 不能因为少传一个参数就让反查链断掉。
  const projection = options.projection ?? null;
  const blocks = Array.isArray(projection?.blocks) ? projection.blocks : flattenBlocks(resource);
  const anchorIndex = projection?.anchorIndex ?? indexAnchors(resource);
  const text = typeof projection?.text === 'string' ? projection.text : joinBlocks(blocks);
  const limited = Number(options.maxChars) > 0 ? Number(options.maxChars) : 0;
  const body = limited > 0 && [...text].length > limited
    ? `${[...text].slice(0, limited).join('')}\n…（正文过长已截断，原长 ${[...text].length} 字）`
    : text;

  const references = Object.values(anchorIndex)
    .filter((anchor) => anchor && typeof anchor === 'object')
    .map((anchor) => ({
      anchorId: anchor.anchorId,
      topicId: anchor.topicId ?? null,
      blockId: anchor.blockId ?? null,
      page: anchor.page ?? null,
      timeRange: anchor.timeRange ?? null,
    }));

  return {
    // 身份：上游记在 run 上，回程靠 revision 判断"资源换版了没有"。
    resourceId: handle?.resourceId ?? resource.resourceId ?? null,
    revision: handle?.revision ?? resource.revision ?? null,
    contentHash: handle?.contentHash ?? resource.contentHash ?? null,
    handleId: handle?.handleId ?? null,
    title: resource.title ?? '',
    language: resource.language ?? 'zh',
    contentType: resource.contentType ?? 'lecture-v4',
    courseId: resource.courseId ?? null,
    subId: resource.subId ?? null,
    // 正文：`text` 塞 prompt；`blocks` 给"需要按块选择"的场合（例如只把例题喂给出题器）。
    text: body,
    blocks: blocks.map((block) => ({
      blockId: block.blockId ?? block.id ?? null,
      topicId: block.topicId ?? null,
      type: block.type ?? 'paragraph',
      text: block.text ?? '',
      assetRef: block.assetRef ?? null,
      anchorIds: Array.isArray(block.anchorIds) ? [...block.anchorIds] : [],
    })),
    // 反查：回程定位的唯一入口（见上）。
    anchorIndex,
    references,
    stats: {
      blocks: blocks.length,
      anchors: references.length,
      chars: [...body].length,
      truncated: body !== text,
    },
  };
}

/** 兜底：把 chapters / topics / blocks 摊平（不做选择器过滤）。 */
function flattenBlocks(bundle) {
  const out = [];
  for (const chapter of Array.isArray(bundle?.chapters) ? bundle.chapters : []) {
    for (const topic of Array.isArray(chapter?.topics) ? chapter.topics : []) {
      for (const block of Array.isArray(topic?.blocks) ? topic.blocks : []) {
        out.push({
          blockId: block?.id ?? null,
          topicId: topic?.id ?? null,
          chapterId: chapter?.id ?? null,
          type: block?.type ?? 'paragraph',
          text: typeof block?.text === 'string' ? block.text : '',
          assetRef: block?.assetRef ?? null,
          anchorIds: Array.isArray(block?.anchorIds) ? block.anchorIds : [],
        });
      }
    }
  }
  return out;
}

/** 兜底：从 sourceAnchors 建 anchorIndex（与 core 的 `project()` 同形状）。 */
function indexAnchors(bundle) {
  const index = Object.create(null);
  for (const anchor of Array.isArray(bundle?.sourceAnchors) ? bundle.sourceAnchors : []) {
    const anchorId = typeof anchor?.anchorId === 'string' ? anchor.anchorId : '';
    if (!anchorId) continue;
    index[anchorId] = {
      anchorId,
      topicId: anchor.topicId ?? null,
      blockId: anchor.blockId ?? null,
      page: Number.isInteger(anchor.page) ? anchor.page : null,
      timeRange: anchor.timeRange && typeof anchor.timeRange === 'object'
        ? { startMs: anchor.timeRange.startMs ?? null, endMs: anchor.timeRange.endMs ?? null }
        : null,
      assetRef: anchor.assetRef ?? null,
      confidence: typeof anchor.confidence === 'number' ? anchor.confidence : null,
      origin: anchor.origin ?? null,
    };
  }
  return index;
}

/** 兜底：块拼成纯文本（带块号，与 `project()` 的 text 视图同风格）。 */
function joinBlocks(blocks) {
  const lines = [];
  let currentTopic = null;
  for (const block of blocks) {
    if (block.topicId !== currentTopic) {
      currentTopic = block.topicId;
      lines.push('');
      lines.push(`### ${currentTopic ?? '（未命名知识点）'}`);
    }
    lines.push(`[${block.blockId ?? '?'}] ${block.text ?? ''}`);
  }
  return lines.join('\n').trim();
}
