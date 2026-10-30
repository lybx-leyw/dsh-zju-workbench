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
 * **模型本身**：`dsh-zhiyun-core-notes` 的「每节一份笔记」是**应用数据**（键是
 * `账号.节次`，人不需要直接看），而这里的是**用户自己的文件**。
 * 这一点在 README 里写明了，不是随手破例。
 *
 * # 子目录（vault 就是一棵树）
 *
 * 库里可以建文件夹，笔记放在任意深度。这件事**只需要改本文件**：
 * `dsh-zhiyun-core-vault` 的索引器早就按嵌套路径写好了 —— `createResolver()` 的
 * 解析顺序是「精确路径 → 同目录 → 全库唯一 basename」，`renameLinks()` 也走
 * resolver。第一版没有递归列目录，才显得像是不支持文件夹。
 *
 * 因此索引侧的形状没变，仍然是 `{ path: '目录/笔记.md', markdown }`。
 *
 * # 与 `dsh-zhiyun-core-vault` 的分工
 *
 * `dsh-zhiyun-core-vault` 是**纯索引器**（解析 `[[链接]]`、算反链/图谱、零 IO）。
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
import { PDF_ROUTE_PREFIX, servePdfRoute } from './pdf-viewer.js';
export { PDF_ROUTE_PREFIX };

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

/**
 * 允许导入的二进制类型。
 *
 * 目前只有 PDF：用户要的是"PDF 导入后能读"。白名单而不是黑名单 ——
 * 导入这条路会把任意字节写进库目录，允许什么必须显式列出。
 */
export const ALLOWED_IMPORT_EXT = ['pdf'];

/**
 * 单个导入文件的上限。
 *
 * 比笔记的 512KB 宽得多（笔记是文本，PDF 是扫描件），但仍要有个上限：
 * 走 base64 过 JSON 信封会膨胀约 33%，100MB 的文件会变成 133MB 的请求体，
 * 先把宿主拖死，用户还看不到任何提示。
 */
export const MAX_ASSET_BYTES = 64 * 1024 * 1024;
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

/** 由标题推一个不冲突的**附件**名（带扩展名；同名时加 ` 2`、` 3`…）。 */
async function uniqueAssetName(dir, base, ext) {
  for (let n = 1; n < 1000; n += 1) {
    const candidate = n === 1 ? base : `${base} ${n}`;
    if (!(await exists(path.join(dir, `${candidate}.${ext}`)))) return candidate;
  }
  throw Object.assign(new Error('同名文件太多，换一个名字'), { code: 'TOO_MANY' });
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

/** 这个相对路径是不是 PDF（决定 `content-type`）。 */
function pdfLike(rel) {
  return extensionOf(rel) === 'pdf';
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

      /**
       * 导入一个二进制文件（当前用于 PDF）到库里，落成普通文件。
       *
       * 与 `write` 的分工：`write` 收文本正文，走 UTF-8；二进制走 base64，
       * 否则字节会被解码破坏。
       *
       * 命名沿用 `create` 的口径：**标题即文件名**。同名时加 ` 2`、` 3`，
       * 而不是覆盖别人的文件 —— 导入是「加一份」，不是「替换」。
       *
       * @param args.name - 用户看到的标题（不含扩展名）。
       * @param args.folder - 目标文件夹（相对库根，可空）。
       * @param args.ext - 扩展名（小写、不带点）；只接受 `ALLOWED_IMPORT_EXT`。
       * @param args.base64 - 文件字节的 base64。
       */
      case 'importAsset': {
        const ext = String(args.ext ?? '').toLowerCase();
        if (!ALLOWED_IMPORT_EXT.includes(ext)) {
          throw Object.assign(
            new Error(`不支持导入 .${ext}（目前只支持 ${ALLOWED_IMPORT_EXT.join(' / ')}）`),
            { code: 'INPUT' },
          );
        }
        const base = safeName(args.title ?? args.name ?? '导入的文件');
        if (!base) throw Object.assign(new Error('文件名不合法'), { code: 'INPUT' });
        const parent = args.folder ? safePath(args.folder) : '';
        if (args.folder && !parent) throw Object.assign(new Error('目录不合法'), { code: 'INPUT' });

        const raw = typeof args.base64 === 'string' ? args.base64 : '';
        if (raw === '') throw Object.assign(new Error('文件内容为空'), { code: 'INPUT' });
        const bytes = Buffer.from(raw, 'base64');
        if (bytes.length === 0) throw Object.assign(new Error('文件内容不是合法 base64'), { code: 'INPUT' });
        if (bytes.length > MAX_ASSET_BYTES) {
          throw Object.assign(
            new Error(`文件太大（${(bytes.length / 1024 / 1024).toFixed(1)}MB，上限 ${MAX_ASSET_BYTES / 1024 / 1024}MB）`),
            { code: 'TOO_LARGE' },
          );
        }
        // PDF 必须真的以 `%PDF-` 开头。扩展名可以撒谎，而这一条决定了后面
        // pdf.js 能不能打开它 —— 与其等到阅读时炸，不如导入时就说清楚。
        if (ext === 'pdf' && !bytes.subarray(0, 5).equals(Buffer.from('%PDF-'))) {
          throw Object.assign(new Error('这个文件不是 PDF（缺少 %PDF- 文件头）'), { code: 'INPUT' });
        }

        const parentAbs = parent === '' ? dir : resolveIn(parent);
        await mkdir(parentAbs, { recursive: true });
        const name = await uniqueAssetName(parentAbs, base, ext);
        const rel = parent === '' ? `${name}.${ext}` : `${parent}/${name}.${ext}`;
        await writeFileAtomic(resolveIn(rel), bytes, NOTE_FILE_OPTS);
        await refreshIndex();

        // ⚠️ 这里**不**把 PDF 复制到论文库。
        //
        // 「论文」与「笔记」是两个**目录隔离**的工作区（共用文件系统，各有各的目录）：
        // 论文库由上游管理（`topic/name` 两段式，译文与会话落在那儿），笔记库是
        // 用户自己的 `.md` + 附件树。跨库复制会让「哪份是真源」「删一个另一个还在吗」
        // 变成长期问题，而收益只是"笔记库的 PDF 也能整篇翻译"——
        // 需要整篇翻译时，用户把 PDF 放进论文页即可。
        return { path: rel, title: name, ext };
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
       *
       * ⚠️ 四种形状都要认，不能只试 `.md`：
       *   - **文件夹**（无扩展名目录）→ 递归删；
       *   - **笔记**：`tree` 给的 `path` **不带 `.md`**，要补上；
       *   - **附件**：`tree` 给的 `path` 是**带扩展名的完整相对路径**（`截图.png`）。
       *     曾经这里只会试 `<path>.md`，于是选中附件按删除返回 `removed:false`，
       *     界面上什么都不发生 —— 而树里附件是一等公民，是可选中、可拖动的行。
       *   - 名字里本来就有 `.md` 的（`a.md` 笔记）：补后缀会变成 `a.md.md`，
       *     所以"带 .md 的候选"也要试一次。
       *
       * 返回值多给一个 `kind`，让调用方能说清"删掉的是文件夹还是文件"。
       */
      case 'remove': {
        const rel = safePath(args.path ?? args.name);
        if (!rel) throw Object.assign(new Error('路径不合法'), { code: 'INPUT' });
        const abs = resolveIn(rel);
        const info = await statOrNull(abs);
        if (info?.isDirectory()) {
          // 报告删掉了多少个文件：文件夹删除是这一页唯一会**连带**破坏内容的动作，
          // 调用方要能把它如实说出来（"已删除「理学」（含 3 篇笔记）"）。
          const contained = await walk(rel);
          await rm(abs, { recursive: true, force: true });
          await refreshIndex();
          return { removed: true, kind: 'folder', contained: contained.filter(e => e.type !== 'folder').length };
        }
        if (info?.isFile()) {
          await rm(abs, { force: true });
          await refreshIndex();
          return { removed: true, kind: extensionOf(rel) === 'md' ? 'note' : 'attachment' };
        }
        // 没有实体目录命中：笔记的 path 不带 `.md`，逐个候选试。
        for (const candidate of [`${abs}${NOTES_EXT}`, abs]) {
          if (!(await exists(candidate))) continue;
          await rm(candidate);
          await refreshIndex();
          return { removed: true, kind: 'note' };
        }
        return { removed: false };
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
            if (request.method === 'GET') {
              // `?raw=<相对路径>`：把库里的**二进制**原样吐出去，供 pdf.js 取字节。
              //
              // 为什么不走 RPC：PDF 动辄几十 MB，base64 过 JSON 会膨胀 33% 且
              // 要整个读进内存再编码；而 pdf.js 需要的是**可按字节区间取**的资源
              // （它是流式解析的）。这里直接给字节 + `content-length`，
              // pdf.js 自己会发 Range 请求。
              const rawPath = new URL(request.url).searchParams.get('raw');
              if (rawPath !== null) {
                const rel = safePath(rawPath);
                if (!rel) return new Response('路径不合法', { status: 400 });
                const abs = resolveIn(rel);
                const info = await statOrNull(abs);
                if (info === null || !info.isFile()) return new Response('找不到这个文件', { status: 404 });
                const bytes = await readFile(abs);
                return new Response(bytes, {
                  headers: {
                    'content-type': pdfLike(rel) ? 'application/pdf' : 'application/octet-stream',
                    'content-length': String(bytes.length),
                    // 用户自己的文件，按路径缓存到会话结束即可；不设长缓存，
                    // 否则同名替换后看到的还是旧的。
                    'cache-control': 'private, max-age=300',
                  },
                });
              }
              return send({ ok: true, value: { dir, count: status.count } });
            }
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

  // ── PDF 阅读器：静态资源 + 阅读页 ─────────────────────────────────────
  //
  // 为什么要有这一段（而不是把 pdf.js 打进客户端 bundle）：
  // 仓里有一条明确的构建守卫 —— 客户端 bundle 不许内联本包 `src/` 之外的文件。
  // `pdfjs-dist` 的 `pdf.min.mjs` + worker + cmaps 合起来约 1.8MB，打进 bundle
  // 会让每次进笔记页都背上它，而且 worker 在 esbuild 的 cjs 封装里根本跑不起来。
  // 所以照「论文」页的成例：阅读器活在**同源 iframe** 里，pdf.js 由宿主路由伺服。
  //
  // 同源这一点是刻意的：只有同源，父页面才能把主题送进 iframe
  // （见 `pdf-viewer.js` 里 `postMessage` 的那一段），PDF 才会跟着亮暗切换。
  // ⚠️ 用 `ctx.inject(['webServer'])` 会把 webServer 变成**必需依赖**：拿不到时
  //    整个笔记插件的 `apply` 都会失败，连笔记读写都一起没了。而 PDF 阅读只是
  //    「有则更好」的能力 —— 没有 webServer（极简宿主、测试桩）时应当降级：
  //    笔记照常可用，只是 PDF 打不开。所以这里用 `ctx.get` 惰性取，取不到就跳过。
  const webServer = typeof ctx.get === 'function' ? ctx.get('webServer') : undefined;
  // 来源校验用的 `connection`：同样惰性取。取不到就**拒绝**而不是放行 ——
  // 这条路由会吐真实文件字节，"没有校验器"不该等于"谁都能读"。
  const pdfConnection = typeof ctx.get === 'function' ? ctx.get('connection') : undefined;
  if (webServer === undefined || typeof webServer.register !== 'function') {
    warn('宿主没有 webServer，PDF 阅读器不可用（其余笔记功能不受影响）');
  } else {
    const dispose = webServer.register({
      kind: 'prefix',
      path: PDF_ROUTE_PREFIX,
      handler: (req, res) => {
        // ⚠️ 来源校验**必须有**：这条路由会把用户笔记库里的文件原样吐出去，
        //    没有它就等于把库暴露给任何能访问这个端口的来源。
        //    口径与上游、`host-paper/routes.js:76-81` 一致：由宿主的
        //    `connection.requestRejection(req)` 判定，返回 401/403 就拒绝。
        //
        //    只读这一条路由不够 —— 但它是唯一直接返回**文件字节**的，
        //    其余 RPC 路由走 JSON 信封，风险面小得多。
        // 口径三条：
        //   1. 有校验器 → 用它的判定（401/403 拒绝）；
        //   2. 有 connection 但没这个方法 → 说明宿主版本不同，放行（与上游同一取舍：
        //      上游也是"没有 requestRejection 就不校验"，见 dist/host.js:641-647）；
        //   3. 完全没有 connection → 极简宿主/测试桩，放行。
        // 这三条都写在明面上，而不是让"没校验"悄悄发生。
        const rejection = typeof pdfConnection?.requestRejection === 'function'
          ? pdfConnection.requestRejection(req)
          : undefined;
        if (rejection !== undefined) {
          res.writeHead(rejection, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(rejection === 401 ? 'unauthorized' : 'forbidden');
          return;
        }
        // `resolveFile` 把「库内相对路径」翻成绝对路径，越界一律 null。
        // 规则与 `invoke` 里那些方法共用同一套 `safePath` + `resolveIn`。
        const resolveFile = (raw) => {
          const rel = safePath(raw);
          if (!rel) return null;
          try {
            return resolveIn(rel);
          } catch {
            return null;
          }
        };
        void servePdfRoute(req, res, { resolveFile });
      },
    });
    // 注册返回的是 disposer；用 `ctx.effect` 挂到插件生命周期上，
    // 卸载时自动摘掉，不会在宿主里留一条指向已销毁闭包的路由。
    if (typeof ctx.effect === 'function' && typeof dispose === 'function') {
      ctx.effect(() => dispose, 'zhiyun: pdf viewer route');
    }
    if (typeof dispose !== 'function') warn('webServer.register 没有返回 disposer，PDF 路由将随宿主退出才消失');
    log(`PDF 阅读器路由：${PDF_ROUTE_PREFIX}`);
  }

  const removeService = ctx.provide('zhiyunVaultNotes', {
    routePath,
    dir,
    list: () => invoke('list'),
    tree: () => invoke('tree'),
    read: (name) => invoke('read', { name }),
    write: (name, markdown) => invoke('write', { name, markdown }),
    create: (title, folder) => invoke('create', { title, folder }),
    /** 导入二进制（当前只有 PDF）。`args` 形状见 `invoke` 的 `importAsset`。 */
    importAsset: (args) => invoke('importAsset', args),
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
