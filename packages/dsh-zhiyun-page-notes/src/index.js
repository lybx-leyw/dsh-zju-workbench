/**
 * 「笔记」页的**宿主半边**：笔记库的存储与索引。
 *
 * # 为什么这一页自己管存储
 *
 * 一个 **vault 本质就是一个 `.md` 文件夹** —— 这是 Obsidian 的真实模型，
 * 不是实现细节。所以这里直接落盘成一份份 Markdown 文件：
 *
 *   - 用户能用任何编辑器打开它们（不锁死在应用里）；
 *   - 备份、同步、版本控制都按普通文件处理；
 *   - 反过来，把笔记塞进一个私有二进制容器会让"笔记库"这个概念名不副实。
 *
 * ⚠️ 与本仓其它领域包的取舍不同（那些包把落盘交给宿主存储栈）。区别在于
 * **模型本身**：`dsh-zhiyun-notes` 的「每节一份笔记」是**应用数据**（键是
 * `账号.节次`，人不需要直接看），而这里的是**用户自己的文件**。
 * 这一点在 README 里写明了，不是随手破例。
 *
 * # 子目录（vault 就是一棵树）
 *
 * 库里可以建文件夹，笔记放在任意深度。这件事**只需要改本文件**：
 * `dsh-zhiyun-vault` 的索引器早就按嵌套路径写好了 —— `createResolver()` 的
 * 解析顺序是「精确路径 → 同目录 → 全库唯一 basename」，`renameLinks()` 也走
 * resolver。第一版没有递归列目录，才显得像是不支持文件夹。
 *
 * 因此索引侧的形状没变，仍然是 `{ path: '目录/笔记.md', markdown }`。
 *
 * # 与 `dsh-zhiyun-vault` 的分工
 *
 * `dsh-zhiyun-vault` 是**纯索引器**（解析 `[[链接]]`、算反链/图谱、零 IO）。
 * 本文件负责「内容从哪来、写到哪去」，写完把全部笔记推给索引器。
 * 两者都不做对方的事：索引器不认识文件，本文件不解析 Markdown。
 *
 * # 路径安全
 *
 * 所有外部传入的路径都过 `safePath()`：按 `/` 切段、每段过 `safeName()`，
 * 剥掉 `..` 与空段，最后**再断言解析出来的绝对路径仍在库目录内**（纵深防御）。
 * 笔记名直接拼进路径，不校验就等于把文件系统交给调用方（`../../.ssh/id_rsa`）。
 */

import { mkdir, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write';

export const name = 'zhiyun-page-notes-page';

/**
 * 笔记文件的权限。
 *
 * ⚠️ `writeFileAtomic` 的第三个参数是**必填**的（它内部直接读 `options.dirMode`，
 * 传 `undefined` 会抛 `Cannot read properties of undefined`）。这一条是实测踩出来的：
 * 我最初只传了两个参数，单测当场就红了。
 *
 * 用 0644/0755 而不是凭据文件那种 0600/0700：**笔记不是机密**，
 * 用户还要用别的编辑器打开它们 —— 收紧到只有本用户可读会让"自己的文件"
 * 这个概念在别的工具里变成"打不开的文件"。
 */
const NOTE_FILE_OPTS = { mode: 0o644, dirMode: 0o755 };

/** 只硬依赖 `profileContext`（拿数据目录）。`connection` 与 `zhiyunVault` 惰性取。 */
export const inject = ['profileContext'];

export const ROUTE_PATH = '/api/zhiyun-vault-notes';

/** 笔记目录名（落在 profile 的 data/ 下）。 */
export const NOTES_DIR = 'zhiyun-vault-notes';

const MAX_NOTE_BYTES = 512 * 1024;
const MAX_NAME_CHARS = 80;
/** 路径总段数上限：够用，且挡住"用超深目录把界面撑爆"。 */
const MAX_DEPTH = 12;

export const NOTES_EXT = '.md';

/**
 * 把用户给的标题变成一个安全的**单段**文件名。
 *
 * 规则：去掉路径分隔符与 `..`、去掉 Windows 非法字符、压缩空白、限长。
 * 结果为空时返回 null —— 由调用方决定怎么报错，本函数不猜一个默认名
 * （猜出来的名字会让两篇笔记撞车，然后一篇覆盖另一篇）。
 */
export function safeName(raw) {
  const cleaned = String(raw ?? '')
    // ⚠️ 分隔符与点号是**删掉**，不是换成 `-`。
    //    曾经写成 `.replace(/[\\/]/g, '-')`，于是 `'///'` → `'---'` ——
    //    一个既不是空、也毫无意义的文件名被放了过去。测试当场抓到。
    .replace(/[\\/]/g, '')
    .replace(/\.{2,}/g, '')
    // Windows 不允许 <>:"|?* 与控制字符；一并去掉，跨平台同一套规则。
    .replace(/[<>:"|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // 前导点会让文件变成隐藏文件（Unix），也容易被误当成 `..`。
    .replace(/^\.+/, '')
    .slice(0, MAX_NAME_CHARS)
    .trim();
  // 只剩标点（`-`、`_` 之类）的文件名没有意义，也容易与别的笔记撞车 —— 一样给 null。
  // `[\p{L}\p{N}]` 要求至少有一个字母或数字（含中文）。
  if (!/[\p{L}\p{N}]/u.test(cleaned)) return null;
  return cleaned;
}

/**
 * 把用户给的**相对路径**（可含 `/`）变成安全的相对路径。
 *
 * ⚠️ 越界段是**中和**，不是报错 —— 与 `safeName` 同一条取舍：`../../escape`
 * 降级成一个普通名字 `escape`，于是"读穿越路径"就是一次查不到，而不是给调用方
 * 一个可区分的错误信号（那种信号本身就是在帮忙探测文件系统）。
 *
 * 真正保证安全的是最后那道 `resolveIn()` 断言，不是这里的剥离。
 *
 * @returns {string|null} `a/b` 形式的相对路径；剥光后给 null。
 */
export function safePath(raw) {
  const segments = String(raw ?? '').replace(/\\/g, '/').split('/');
  const out = [];
  for (const segment of segments) {
    // 空段（`a//b`、前导 `/`）、`.`、`..` 一律丢掉。
    if (segment === '' || segment === '.' || segment === '..') continue;
    const clean = safeName(segment);
    if (clean !== null) out.push(clean);
    if (out.length >= MAX_DEPTH) break;
  }
  return out.length === 0 ? null : out.join('/');
}

/** 由标题推一个不冲突的文件名（已存在时加 ` 2`、` 3`…）。 */
async function uniqueName(dir, base) {
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? base : `${base} ${n}`;
    if (!(await exists(path.join(dir, `${candidate}${NOTES_EXT}`)))) return candidate;
  }
  throw Object.assign(new Error('同名笔记太多，换一个标题'), { code: 'TOO_MANY' });
}

/** 由标题推一个不冲突的文件夹名。 */
async function uniqueFolderName(dir, base) {
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? base : `${base} ${n}`;
    if (!(await exists(path.join(dir, candidate)))) return candidate;
  }
  throw Object.assign(new Error('同名文件夹太多，换一个名字'), { code: 'TOO_MANY' });
}

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

/** `stat` 但"不存在"给 null 而不是抛 —— 本文件里到处都要问"它在不在、是什么"。 */
async function statOrNull(file) {
  try { return await stat(file); } catch { return null; }
}

/** 取扩展名（小写，不带点）；没有给空串。附件行上的类型角标用它。 */
function extensionOf(fileName) {
  const dot = fileName.lastIndexOf('.');
  return dot <= 0 ? '' : fileName.slice(dot + 1).toLowerCase();
}

/** 去掉末尾的 `.md`（**只去一个**，`a.md.md` → `a.md`）。 */
export function stripExt(name) {
  return name.toLowerCase().endsWith(NOTES_EXT) ? name.slice(0, -NOTES_EXT.length) : name;
}

/** 相对路径的最后一段。 */
function baseOf(rel) {
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? rel : rel.slice(slash + 1);
}

/** 相对路径的目录部分（不含结尾斜杠）；顶层给空串。 */
function dirOf(rel) {
  const slash = rel.lastIndexOf('/');
  return slash === -1 ? '' : rel.slice(0, slash);
}

export async function apply(ctx, config = {}) {
  const log = (message) => {
    const line = `[zhiyun-page-notes] ${message}`;
    if (typeof ctx.logger?.info === 'function') ctx.logger.info(line);
    else console.log(line);
  };
  const warn = (message) => {
    const line = `[zhiyun-page-notes] ${message}`;
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(line);
    else console.warn(line);
  };

  const dir = path.resolve(config.dir ?? path.join(ctx.profileContext.dir, 'data', NOTES_DIR));
  const routePath = config.routePath ?? ROUTE_PATH;
  const status = { dir, count: 0, files: 0, folders: 0, ready: false, error: null };

  await mkdir(dir, { recursive: true });

  /**
   * 相对路径 → 绝对路径，并**断言它仍在库目录内**（纵深防御）。
   *
   * 上面的 `safePath()` 已经把 `..` 剥掉了，这一道是防"剥离逻辑将来被改坏"：
   * 安全边界不能只由"输入清洗"承担，落盘前必须再核对一次目标位置。
   */
  function resolveIn(rel) {
    const abs = path.resolve(dir, rel);
    if (abs !== dir && !abs.startsWith(dir + path.sep)) {
      throw Object.assign(new Error('路径越出笔记库'), { code: 'INPUT' });
    }
    return abs;
  }

  /**
   * 递归列出整个库（**扁平**的条目表，树由页面自己拼）。
   *
   * 为什么服务端给扁平表：目录结构是**展示**问题（排序、折叠、深度缩进都在
   * 页面里），而这里只需要如实报告"磁盘上有什么"。给一棵拼好的树等于把展示
   * 决定提前固化到存储层，页面想换个排法就得改服务端。
   */
  async function walk(rel = '') {
    const abs = rel === '' ? dir : path.join(dir, rel);
    const entries = [];
    let items;
    try {
      items = await readdir(abs, { withFileTypes: true });
    } catch (error) {
      warn(`读不出目录 ${rel || '.'}：${error.message}`);
      return entries;
    }
    for (const item of items) {
      // 隐藏文件不列（`.DS_Store`、编辑器临时文件），它们的出现只会让树变脏。
      if (item.name.startsWith('.')) continue;
      const child = rel === '' ? item.name : `${rel}/${item.name}`;
      if (item.isDirectory()) {
        entries.push({ path: child, type: 'folder' });
        entries.push(...await walk(child));
      } else if (item.isFile()) {
        entries.push({ path: child, type: /\.md$/i.test(item.name) ? 'note' : 'attachment' });
      }
    }
    return entries;
  }

  /** 读出全部**笔记**（递归），路径是相对库根的 `a/b.md`。附件不进来。 */
  async function readAll() {
    const entries = await walk();
    const notes = [];
    for (const entry of entries) {
      if (entry.type !== 'note') continue;
      try {
        notes.push({ path: entry.path, markdown: await readFile(path.join(dir, entry.path), 'utf8') });
      } catch (error) {
        // 单个文件读不出来不该让整个库读不出来 —— 如实跳过并留痕。
        warn(`跳过读不出的笔记 ${entry.path}：${error.message}`);
      }
    }
    return notes;
  }

  /** 把当前全部笔记推给索引器（若它可用）。索引器缺席时页面只是没有反链。 */
  async function refreshIndex() {
    const vault = ctx.get('zhiyunVault');
    const notes = await readAll();
    status.count = notes.length;
    const entries = await walk();
    status.files = entries.filter((e) => e.type !== 'folder').length;
    status.folders = entries.filter((e) => e.type === 'folder').length;
    if (!vault || typeof vault.setNotes !== 'function') return null;
    return vault.setNotes(notes);
  }

  await refreshIndex();
  status.ready = true;
  log(`笔记库就绪：${dir}（${status.count} 篇 / ${status.folders} 个文件夹）`);

  /**
   * 判断一个相对路径在磁盘上是笔记还是文件夹。
   *
   * 页面上的 "新建笔记" 与 "新建文件夹" 可能给出同名输入，所以这里以磁盘为准，
   * 不靠调用方声明类型 —— 声明与磁盘不一致时静默做错事是最坏的一种。
   */
  async function probe(rel) {
    if (await exists(resolveIn(rel))) return 'folder';
    if (await exists(`${resolveIn(rel)}${NOTES_EXT}`)) return 'note';
    return null;
  }

  /** 重命名/移动一篇**笔记**，并把全库指向它的链接改写掉。 */
  async function moveNote(from, to) {
    const fromAbs = `${resolveIn(from)}${NOTES_EXT}`;
    const toAbs = `${resolveIn(to)}${NOTES_EXT}`;
    if (!(await exists(fromAbs))) throw Object.assign(new Error(`没有名为「${from}」的笔记`), { code: 'NOTFOUND' });
    if (await exists(toAbs)) throw Object.assign(new Error(`已经有名为「${to}」的笔记了`), { code: 'EXISTS' });

    // 链接改写只在 **basename 变了** 的时候需要做：只换目录时 `[[名字]]` 仍然解析得到
    // （resolver 的顺序是精确路径 → 同目录 → 全库唯一 basename）。
    const sameTitle = baseOf(from).toLowerCase() === baseOf(to).toLowerCase();
    const notes = await readAll();
    const vault = ctx.get('zhiyunVault');
    const changes = sameTitle || !vault?.renameLinks
      ? []
      : vault.renameLinks(notes, `${from}${NOTES_EXT}`, `${to}${NOTES_EXT}`);

    await mkdir(path.dirname(toAbs), { recursive: true });
    // ⚠️ 先写引用方的改写，再改名 —— 反过来的话中途失败会留下指向不存在笔记的链接。
    for (const change of changes) {
      await writeFileAtomic(path.join(dir, change.path), change.markdown, NOTE_FILE_OPTS);
    }
    await writeFileAtomic(toAbs, await readFile(fromAbs, 'utf8'), NOTE_FILE_OPTS);
    await rm(fromAbs);
    return { rewrote: changes.length };
  }

  /** 页面可调的方法。写操作之后一律刷新索引，避免反链滞后一次。 */
  async function invoke(method, args = {}) {
    switch (method) {
      case 'describe':
        return { dir, count: status.count, folders: status.folders, ready: status.ready };

      /**
       * 扁平的条目表：笔记 + 文件夹 + 附件。
       *
       * 笔记的 `path` **不带 `.md`** —— 那是它在 `[[双链]]` 里的写法，也是页面
       * 用来标识它的键（`read`/`write`/`move` 都收这个形状）。附件与文件夹的
       * `path` 就是磁盘上的相对路径。
       */
      case 'tree': {
        const entries = await walk();
        const out = [];
        for (const entry of entries) {
          if (entry.type === 'folder') {
            out.push({ type: 'folder', path: entry.path, title: baseOf(entry.path) });
            continue;
          }
          if (entry.type === 'attachment') {
            out.push({ type: 'attachment', path: entry.path, title: baseOf(entry.path), ext: extensionOf(entry.path) });
            continue;
          }
          let markdown = '';
          try {
            markdown = await readFile(path.join(dir, entry.path), 'utf8');
          } catch { /* 读不出就当作空：列表不该因为一篇坏文件整份失败 */ }
          out.push({
            type: 'note',
            path: stripExt(entry.path),
            title: baseOf(stripExt(entry.path)),
            folder: dirOf(entry.path),
            preview: markdown.trim().replace(/\s+/g, ' ').slice(0, 120),
            chars: markdown.length,
          });
        }
        return out;
      }

      /** 兼容旧的「只列笔记」形状（单测与旧调用方按这个断言）。 */
      case 'list': {
        const notes = await readAll();
        return notes.map((n) => ({
          path: n.path,
          title: baseOf(stripExt(n.path)),
          folder: dirOf(n.path),
          preview: n.markdown.trim().replace(/\s+/g, ' ').slice(0, 120),
          chars: n.markdown.length,
        }));
      }

      case 'read': {
        const rel = safePath(args.name);
        if (!rel) throw Object.assign(new Error('笔记名不合法'), { code: 'INPUT' });
        const file = `${resolveIn(rel)}${NOTES_EXT}`;
        if (!(await exists(file))) return null;
        return { name: rel, markdown: await readFile(file, 'utf8') };
      }

      case 'create': {
        const base = safeName(args.title ?? '新笔记');
        if (!base) throw Object.assign(new Error('标题不合法'), { code: 'INPUT' });
        // `folder` 为空 = 建在库根。
        const folder = args.folder ? safePath(args.folder) : '';
        if (args.folder && !folder) throw Object.assign(new Error('目录不合法'), { code: 'INPUT' });
        const target = folder === '' ? dir : resolveIn(folder);
        await mkdir(target, { recursive: true });
        const name = await uniqueName(target, base);
        await writeFileAtomic(path.join(target, `${name}${NOTES_EXT}`), '', NOTE_FILE_OPTS);
        await refreshIndex();
        return { name: folder === '' ? name : `${folder}/${name}` };
      }

      case 'mkdir': {
        const base = safeName(args.title ?? '新文件夹');
        if (!base) throw Object.assign(new Error('文件夹名不合法'), { code: 'INPUT' });
        const parent = args.folder ? safePath(args.folder) : '';
        if (args.folder && !parent) throw Object.assign(new Error('目录不合法'), { code: 'INPUT' });
        const parentAbs = parent === '' ? dir : resolveIn(parent);
        await mkdir(parentAbs, { recursive: true });
        const name = await uniqueFolderName(parentAbs, base);
        await mkdir(path.join(parentAbs, name), { recursive: true });
        await refreshIndex();
        return { path: parent === '' ? name : `${parent}/${name}` };
      }

      case 'write': {
        const rel = safePath(args.name);
        if (!rel) throw Object.assign(new Error('笔记名不合法'), { code: 'INPUT' });
        const body = typeof args.markdown === 'string' ? args.markdown : '';
        if (Buffer.byteLength(body, 'utf8') > MAX_NOTE_BYTES) {
          throw Object.assign(new Error(`笔记过长（上限 ${Math.round(MAX_NOTE_BYTES / 1024)} KB）`), { code: 'INPUT' });
        }
        const file = `${resolveIn(rel)}${NOTES_EXT}`;
        await mkdir(path.dirname(file), { recursive: true });
        await writeFileAtomic(file, body, NOTE_FILE_OPTS);
        await refreshIndex();
        return { name: rel, chars: body.length };
      }

      /**
       * 删除一条路径：文件夹**连同里面的东西**，笔记只删那一个文件。
       *
       * 递归删是不可逆的，所以：只认库里解析出来的绝对路径，且绝不允许删库根
       * （`remove('')` 会被 `safePath` 挡成 null）。
       */
      case 'remove': {
        const rel = safePath(args.path ?? args.name);
        if (!rel) throw Object.assign(new Error('路径不合法'), { code: 'INPUT' });
        const abs = resolveIn(rel);
        const info = await statOrNull(abs);
        if (info?.isDirectory()) {
          await rm(abs, { recursive: true, force: true });
          await refreshIndex();
          return { removed: true };
        }
        const file = `${abs}${NOTES_EXT}`;
        if (!(await exists(file))) return { removed: false };
        await rm(file);
        await refreshIndex();
        return { removed: true };
      }

      /** 移动/改名一条路径。笔记改名会改写全库链接；文件夹移动只动磁盘。 */
      case 'move': {
        const from = safePath(args.from);
        const to = safePath(args.to);
        if (!from || !to) throw Object.assign(new Error('路径不合法'), { code: 'INPUT' });
        if (from === to) return { moved: false, rewrote: 0 };
        const kind = await probe(from);
        if (kind === null) throw Object.assign(new Error(`没有「${from}」`), { code: 'NOTFOUND' });

        if (kind === 'note') {
          const { rewrote } = await moveNote(from, to);
          await refreshIndex();
          return { moved: true, rewrote, name: to };
        }

        const fromAbs = resolveIn(from);
        const toAbs = resolveIn(to);
        // ⚠️ 把文件夹移进它自己（或自己的子孙）会让内容消失在一个不可达的路径里。
        if (toAbs === fromAbs || toAbs.startsWith(fromAbs + path.sep)) {
          throw Object.assign(new Error('不能把文件夹移进它自己里面'), { code: 'INPUT' });
        }
        if (await exists(toAbs)) throw Object.assign(new Error(`已经有「${to}」了`), { code: 'EXISTS' });
        await mkdir(path.dirname(toAbs), { recursive: true });
        await rename(fromAbs, toAbs);
        await refreshIndex();
        return { moved: true, rewrote: 0, path: to };
      }

      /**
       * 改名（旧接口，按"库根的笔记"语义）。保留它是因为这里曾经只支持平铺笔记，
       * 而 `rename` 的调用点与测试都按那个语义写的；新代码用 `move`。
       */
      case 'rename': {
        const from = safePath(args.from);
        const to = safePath(args.to);
        if (!from || !to) throw Object.assign(new Error('笔记名不合法'), { code: 'INPUT' });
        if (from === to) return { renamed: false, rewrote: 0 };
        const { rewrote } = await moveNote(from, to);
        await refreshIndex();
        return { renamed: true, rewrote };
      }

      default:
        throw Object.assign(new Error(`未知方法：${String(method)}`), { code: 'INPUT' });
    }
  }

  // ── 数据路由 ────────────────────────────────────────────────────────
  ctx.inject(['connection'], (scope) => {
    scope.effect(() => {
      const remove = scope.connection.fetch.register({
        path: routePath,
        methods: ['GET', 'POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const send = (value, status = 200) =>
            Response.json(value, { status, headers: { 'cache-control': 'no-store' } });
          try {
            if (request.method === 'GET') return send({ ok: true, value: { dir, count: status.count } });
            const body = await request.json();
            if (body?.type !== 'client-request' || typeof body.rpcId !== 'string') {
              throw Object.assign(new Error('invalid envelope'), { code: 'INPUT' });
            }
            const payload = body.payload ?? {};
            const value = await invoke(payload.method, payload.args);
            return send({ type: 'server-response', rpcId: body.rpcId, result: { ok: true, value } });
          } catch (error) {
            return send({
              type: 'server-response',
              rpcId: 'invalid-request',
              result: {
                ok: false,
                error: { code: error?.code ?? 'FAILED', message: error?.message ?? String(error), details: {} },
              },
            });
          }
        },
      });
      log(`数据路由：${routePath}`);
      return remove;
    }, 'zhiyun: vault notes route');
  });

  const removeService = ctx.provide('zhiyunVaultNotes', {
    routePath,
    dir,
    list: () => invoke('list'),
    tree: () => invoke('tree'),
    read: (name) => invoke('read', { name }),
    write: (name, markdown) => invoke('write', { name, markdown }),
    create: (title, folder) => invoke('create', { title, folder }),
    mkdir: (title, folder) => invoke('mkdir', { title, folder }),
    remove: (target) => invoke('remove', { path: target }),
    move: (from, to) => invoke('move', { from, to }),
    // ⚠️ 服务面上的方法与 `invoke` 的方法表必须**一一对应**。
    //    这条最初漏了 `rename`（HTTP 路由能调、宿主侧调不到），
    //    单测 `宿主半边：重命名…` 当场报 `svc.rename is not a function`。
    rename: (from, to) => invoke('rename', { from, to }),
    refreshIndex,
    status: () => status,
  });

  return () => {
    if (typeof removeService === 'function') removeService();
  };
}
