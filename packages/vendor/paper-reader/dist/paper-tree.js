/**
 * 论文库的**多级文件树**：在「上游只认一层 topic」的硬约束下，把层级编码进目录名。
 *
 * # 为什么必须编码，而不是直接建多级目录
 *
 * 上游的 `listPapers`（`dist/library.js:42-53`）只做**一层**遍历：
 * `join(dataDir, topic)` 下面直接读文件。也就是说磁盘上若真建成
 * `dataDir/理学/力学/讲义.pdf`，上游会认为 `dataDir/理学` 里没有 PDF
 * （它把 `力学` 当目录跳过），这篇文献就**在上游眼里不存在** ——
 * 整篇翻译、伴读会话、search_paper 全都用不了。
 *
 * 所以磁盘布局必须是 `dataDir/<单段 topic>/<name>.pdf`，多级路径编码进 topic：
 *
 *     理学/力学/讲义.pdf   →   dataDir/理学+力学/讲义.pdf
 *     理学/讲义.pdf        →   dataDir/理学/讲义.pdf
 *
 * **磁盘上的目录名就是唯一真相**：上游按它工作，本文件把 `+` 解码成 `/` 供树展示。
 * 展示层解码不会引入第二套真相。
 *
 * # 编码必须可逆且无撞名
 *
 * 朴素方案 `join('__')` 会让「真名就叫 `a__b` 的目录」与「深层 `a/b`」撞车
 * （两者都会变成 topic `a__b`，于是两篇文献抢同一个目录）。
 * 因此把分隔符自身也转义：`%` → `%25`，`+` → `%2B`，段间用 `+`。
 * 已实测往返无损，且 `a+b` 与 `a/b` 编码后不同。
 *
 * # 从 `dsh-zju-host-paper` 迁入
 *
 * 纯函数，零宿主依赖。页面侧保留了同规则的 `decodeTopic` 副本（客户端不能
 * import 宿主模块），`tests/paper-tree.test.mjs` 守两份规则一致。
 */
import { readdir } from 'node:fs/promises';
import path from 'node:path';
// 布局判据**复用** `library.ts` 的那两份实现，不在这里另写一套：
// 两套判据漂移的后果是「树里有一行、点开却 404」，而那种不一致不会报错。
import { isPaperDir, isPaperPDF } from "./library.js";
/** 隐藏文件与上游的临时/虚拟环境目录都不列。 */
const SKIP = new Set(['.pdf2zh-tmp', '.venv-pdf2zh']);
/**
 * 深层路径 → 上游能接受的**单段** topic。
 * @param rel - 形如 `理学/力学` 的相对路径；空串表示库根。
 */
export function encodeTopic(rel) {
    return String(rel ?? '')
        .split('/')
        .filter((segment) => segment !== '')
        .map((segment) => segment.replace(/%/g, '%25').replace(/\+/g, '%2B'))
        .join('+');
}
/**
 * `encodeTopic` 的逆运算。
 * @param topic - 单段 topic。
 */
export function decodeTopic(topic) {
    return String(topic ?? '')
        .split('+')
        .map((segment) => segment.replace(/%2B/g, '+').replace(/%25/g, '%'))
        .join('/');
}
/**
 * 读论文库，产出**扁平条目表**（文件夹 + 文献）。
 *
 * # 必须同时认两种布局，否则「刚上传的论文」根本不在树里
 *
 * 写侧（`host.ts` 的上传路由）落的是**新布局**：
 *
 *     <dataDir>/<topic>/<论文名>/<论文名>.pdf
 *
 * 而这里原先只扫 `<topic>/` 一层的 `*.pdf`：上传刚写完的论文是一个**目录**，
 * 于是树里只剩一个空的专题文件夹 —— 页面侧 `refreshTree()` 拿到的条目里没有它，
 * 侧栏的行数、树的层级都少这一篇，用户看到的就是「传上去了，但侧栏没认出来」。
 *
 * 判据**复用 `library.ts` 的 `isPaperDir` / `isPaperPDF`**（与 `listPapers`、
 * 迁移、删除同一份）：论文目录 = 目录里有 `<basename(dir)>.pdf` 常规文件，
 * 遍历到此为止（绝不递归进论文目录）。
 *
 * 旧平铺布局（`<topic>/<名>.pdf`，未迁移的库）继续列出，与 `listPapers` 的
 * 「读兼容」口径一致；同名时**文件夹赢**（确定性优先级）。
 *
 * @param dataDir - 论文库根目录。
 */
export async function readPaperTree(dataDir) {
    const out = [];
    let dirs;
    try {
        dirs = await readdir(dataDir, { withFileTypes: true });
    }
    catch {
        return out;
    }
    /** 把一条解码后的多级目录补进文件夹行（幂等：深层路径逐段补齐）。 */
    const pushFolders = (relDir) => {
        let acc = '';
        for (const segment of relDir.split('/').filter(Boolean)) {
            acc = acc === '' ? segment : `${acc}/${segment}`;
            if (!out.some((row) => row.type === 'folder' && row.path === acc)) {
                out.push({ type: 'folder', path: acc, title: segment });
            }
        }
    };
    for (const dir of dirs) {
        if (!dir.isDirectory())
            continue;
        if (dir.name.startsWith('.') || SKIP.has(dir.name))
            continue;
        // 目录名就是编码后的 topic；解码成多级路径供展示。
        const relDir = decodeTopic(dir.name);
        pushFolders(relDir);
        let entries;
        try {
            entries = await readdir(path.join(dataDir, dir.name), { withFileTypes: true });
        }
        catch {
            continue;
        }
        // ── 新布局：论文文件夹 `<topic>/<论文名>/<论文名>.pdf` ────────────────
        // 先扫目录（与 `listPapers` 的顺序一致：论文目录在平铺文件之前判定）。
        const folderStems = new Set();
        for (const entry of entries) {
            if (!entry.isDirectory())
                continue;
            // 论文目录**先判后跳隐藏名**：`listPapers` 同样把 `.hidden/` 这种前导点的
            // 论文目录列出来（upload 能创建的名字必须能被看见、能点开）。
            if (!isPaperDir(path.join(dataDir, dir.name, entry.name)))
                continue;
            folderStems.add(entry.name);
            out.push({
                type: 'paper',
                path: relDir === '' ? entry.name : `${relDir}/${entry.name}`,
                title: entry.name,
                topic: dir.name,
                name: entry.name,
            });
        }
        // ── 旧布局：`<topic>/<名>.pdf`（未迁移的库，读兼容）─────────────────
        for (const entry of entries) {
            if (!entry.isFile())
                continue;
            if (!isPaperPDF(entry.name))
                continue;
            const stem = entry.name.slice(0, -4);
            // 同名论文文件夹赢：平铺产物已被收纳，不再单独成行。
            if (folderStems.has(stem))
                continue;
            out.push({
                type: 'paper',
                path: relDir === '' ? entry.name : `${relDir}/${entry.name}`,
                title: stem,
                // 打开上游要的两个坐标：topic 就是磁盘目录名，name 是文献名。
                topic: dir.name,
                name: stem,
            });
        }
    }
    return out;
}
/**
 * 一份文献在**上游坐标系**里的位置。
 * @param relPath - 树里给的路径（`理学/力学/讲义.pdf`）。
 */
export function upstreamRefFor(relPath) {
    const text = String(relPath ?? '');
    const slash = text.lastIndexOf('/');
    const dirRel = slash === -1 ? '' : text.slice(0, slash);
    const file = slash === -1 ? text : text.slice(slash + 1);
    return { topic: encodeTopic(dirRel), name: file.replace(/\.pdf$/i, '') };
}
