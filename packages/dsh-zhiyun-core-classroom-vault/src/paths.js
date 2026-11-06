/**
 * 上游表 → 本地文件布局的**唯一**映射点。
 *
 * 源：ref/OpenMAIC/packages/@openmaic/storage/src/document/pg.ts:200-262
 *     ref/OpenMAIC/packages/@openmaic/storage/src/asset/pg.ts:194-248
 *     ref/OpenMAIC/lib/persistence/generation-runs.ts:44-104
 *     ref/OpenMAIC/lib/persistence/stage-meta.ts:24-45
 *     ref/OpenMAIC/packages/@openmaic/storage/src/material/pg.ts:58-88
 *     ref/OpenMAIC/lib/store/snapshot.ts:38-120
 *
 * 布局（`<root>` = `<profile>/data/zhiyun-classroom`）：
 *
 * ```
 * classroom/<stageId>/meta.json              document_stages 一行
 * classroom/<stageId>/stage-meta.json       stage_meta 一行
 * classroom/<stageId>/outline.json          document_outlines 一行
 * classroom/<stageId>/scenes/<order>-<id>.json  document_scenes 一行
 * classroom/<stageId>/assets/entries/<id>.json  asset_entries 一行
 * classroom/<stageId>/assets/refs/<scope>-<scene>-<asset>.json  document_asset_refs 一行
 * classroom/<stageId>/assets/blobs/<sha256>     asset_blobs.bytes（内容寻址）
 * classroom/<stageId>/snapshots/<seq>.json      lib/store/snapshot.ts 的快照历史
 * folders/<id>.json                         document_folders 一行
 * runs/<runId>/run.json                     generation_runs 一行
 * runs/<runId>/steps/<stepId>.json          generation_run_steps 一行
 * runs/<runId>/events/<seq>.json            generation_run_events 一行
 * runs/<runId>/commands/<commandId>.json    generation_run_commands 一行
 * materials/<sessionId>/<materialId>.json   agent_session_materials 一行
 * kv/<scope>/<sha256(key)>.json             KVStore 一个键
 * ```
 *
 * 复合主键（上游 `PRIMARY KEY (stage_id, id)` 之类）在端口里写成 `<父>/<子>`，
 * 与表的主键列顺序一致。id 中的 `/` 只用作父键分隔符，其余字符原样进文件名，
 * 但**拒绝**路径穿越（`..`、反斜杠、NUL、控制字符）——文件名是我们唯一的路径。
 */

import { join } from 'node:path';
import { listDir, readJson } from './fs.js';

/** id 不合法（含路径分隔/穿越）。端口读遇到它按"没有这一行"处理并 warn。 */
export class VaultPathError extends Error {
  constructor(message) {
    super(message);
    this.name = 'VaultPathError';
    this.code = 'E_INVALID_ID';
  }
}

/** 表名 → 主键段数。键同时是上游表名的别名表。 */
export const TABLE_SPECS = Object.freeze({
  'document_stages': { parts: 1, alias: ['classroom', 'stage', 'stages'] },
  'stage_meta': { parts: 1, alias: ['stageMeta', 'stage-meta'] },
  'document_scenes': { parts: 2, alias: ['scene', 'scenes'] },
  'document_outlines': { parts: 1, alias: ['outline', 'outlines'] },
  'document_folders': { parts: 1, alias: ['folder', 'folders'] },
  'generation_runs': { parts: 1, alias: ['run', 'runs'] },
  'generation_run_steps': { parts: 2, alias: ['run_step', 'runStep'] },
  'generation_run_events': { parts: 2, alias: ['run_event', 'runEvent'] },
  'generation_run_commands': { parts: 2, alias: ['run_command', 'runCommand'] },
  'asset_entries': { parts: 2, alias: ['asset', 'assets'] },
  'document_asset_refs': { parts: 4, alias: ['asset_ref', 'assetRef'] },
  'agent_session_materials': { parts: 2, alias: ['material', 'materials'] },
});

const ALIASES = (() => {
  const map = new Map();
  for (const [name, spec] of Object.entries(TABLE_SPECS)) {
    map.set(name.toLowerCase(), name);
    for (const alias of spec.alias) map.set(alias.toLowerCase(), name);
  }
  return map;
})();

/** 归一化表名；未知表名抛 `VaultPathError`（别静默落到某个默认目录）。 */
export function normalizeTable(table) {
  const name = ALIASES.get(String(table ?? '').toLowerCase());
  if (!name) throw new VaultPathError(`未知的存储表：${String(table)}`);
  return name;
}

/** 一个路径段是否安全。允许任意 Unicode，只挡路径语义与控制字符。 */
export function assertSegment(value, label = 'id') {
  const text = typeof value === 'string' ? value : String(value ?? '');
  if (text.length === 0) throw new VaultPathError(`${label} 不能为空`);
  if (text.length > 160) throw new VaultPathError(`${label} 过长（>160）：${text.slice(0, 24)}…`);
  if (text === '.' || text === '..') throw new VaultPathError(`${label} 不能是 ${text}`);
  if (/[/\\\0]/.test(text)) throw new VaultPathError(`${label} 不能包含路径分隔符：${text}`);
  // 控制字符会让文件名在某些平台上不可见，等于制造"找不到的文件"。
  if (/[\u0000-\u001f\u007f]/.test(text)) throw new VaultPathError(`${label} 含控制字符：${text}`);
  return text;
}

/** 把复合 id 拆成主键各段，段数必须与表定义一致。 */
export function splitId(table, id) {
  const name = normalizeTable(table);
  const parts = TABLE_SPECS[name].parts;
  const text = typeof id === 'string' ? id : String(id ?? '');
  const segments = text.split('/');
  if (segments.length !== parts) {
    throw new VaultPathError(`表 ${name} 的主键需要 ${parts} 段，收到 ${segments.length} 段：${text}`);
  }
  return segments.map((segment, index) => assertSegment(segment, `${name} 主键第 ${index + 1} 段`));
}

/** 场景文件名：`<order>-<id>.json`。order 补零到 6 位，字典序即数值序。 */
export function sceneFileName(order, sceneId) {
  const numeric = Number(order);
  if (!Number.isFinite(numeric)) throw new VaultPathError(`场景 order 不是数字：${String(order)}`);
  return `${String(Math.trunc(numeric)).padStart(6, '0')}-${assertSegment(sceneId, 'sceneId')}.json`;
}

/** 由场景文件名反解出 `{ order, id }`；不匹配返回 null。 */
export function parseSceneFileName(name) {
  const match = /^(\d+)-(.+)\.json$/.exec(name);
  if (!match) return null;
  return { order: Number(match[1]), id: match[2] };
}

export const dirs = {
  classroom: (root) => join(root, 'classroom'),
  classroomOne: (root, stageId) => join(root, 'classroom', assertSegment(stageId, 'stageId')),
  scenes: (root, stageId) => join(dirs.classroomOne(root, stageId), 'scenes'),
  assets: (root, stageId) => join(dirs.classroomOne(root, stageId), 'assets'),
  assetEntries: (root, stageId) => join(dirs.assets(root, stageId), 'entries'),
  assetRefs: (root, stageId) => join(dirs.assets(root, stageId), 'refs'),
  assetBlobs: (root, stageId) => join(dirs.assets(root, stageId), 'blobs'),
  snapshots: (root, stageId) => join(dirs.classroomOne(root, stageId), 'snapshots'),
  folders: (root) => join(root, 'folders'),
  runs: (root) => join(root, 'runs'),
  runOne: (root, runId) => join(root, 'runs', assertSegment(runId, 'runId')),
  materials: (root) => join(root, 'materials'),
  materialSession: (root, sessionId) => join(root, 'materials', assertSegment(sessionId, 'sessionId')),
  kv: (root, scope) => join(root, 'kv', assertSegment(scope, 'kv scope')),
};

/** 一行在磁盘上的路径。复合主键按主键段还原成目录层级。 */
export function rowPath(root, table, id) {
  const name = normalizeTable(table);
  const parts = splitId(name, id);
  switch (name) {
    case 'document_stages': return join(dirs.classroomOne(root, parts[0]), 'meta.json');
    case 'stage_meta': return join(dirs.classroomOne(root, parts[0]), 'stage-meta.json');
    case 'document_outlines': return join(dirs.classroomOne(root, parts[0]), 'outline.json');
    case 'document_scenes': return join(dirs.scenes(root, parts[0]), `${parts[1]}.json`);
    case 'document_folders': return join(dirs.folders(root), `${parts[0]}.json`);
    case 'generation_runs': return join(dirs.runOne(root, parts[0]), 'run.json');
    case 'generation_run_steps': return join(dirs.runOne(root, parts[0]), 'steps', `${parts[1]}.json`);
    case 'generation_run_events': return join(dirs.runOne(root, parts[0]), 'events', `${parts[1]}.json`);
    case 'generation_run_commands': return join(dirs.runOne(root, parts[0]), 'commands', `${parts[1]}.json`);
    case 'asset_entries': return join(dirs.assetEntries(root, parts[0]), `${parts[1]}.json`);
    case 'document_asset_refs': return join(dirs.assetRefs(root, parts[0]), `${parts[1]}-${parts[2]}-${parts[3]}.json`);
    case 'agent_session_materials': return join(dirs.materialSession(root, parts[0]), `${parts[1]}.json`);
    default: throw new VaultPathError(`表 ${name} 没有文件映射`);
  }
}

/**
 * 枚举一张表的全部 id（扫目录，不读内容）。
 *
 * 课堂量级是几百到几千，扫目录比维护一份"索引文件"便宜，也根除了
 * "索引与文件不一致"这类最难查的错 —— 与 `dsh-zhiyun-core-vault` 同一取舍。
 */
export async function listIds(root, table) {
  const name = normalizeTable(table);
  const ids = [];
  switch (name) {
    case 'document_stages':
    case 'stage_meta':
    case 'document_outlines': {
      const file = name === 'document_stages' ? 'meta.json'
        : name === 'stage_meta' ? 'stage-meta.json' : 'outline.json';
      for (const entry of await listDir(dirs.classroom(root))) {
        if (!entry.isDirectory()) continue;
        const children = await listDir(join(dirs.classroom(root), entry.name));
        if (children.some((child) => child.isFile() && child.name === file)) ids.push(entry.name);
      }
      return ids;
    }
    case 'document_scenes': {
      for (const entry of await listDir(dirs.classroom(root))) {
        if (!entry.isDirectory()) continue;
        for (const child of await listDir(dirs.scenes(root, entry.name))) {
          if (!child.isFile()) continue;
          const parsed = parseSceneFileName(child.name);
          if (parsed) ids.push(`${entry.name}/${parsed.id}`);
        }
      }
      return ids;
    }
    case 'document_folders':
      return collectFileIds(dirs.folders(root), (file) => file.replace(/\.json$/, ''));
    case 'generation_runs': {
      for (const entry of await listDir(dirs.runs(root))) {
        if (!entry.isDirectory()) continue;
        const children = await listDir(join(dirs.runs(root), entry.name));
        if (children.some((child) => child.isFile() && child.name === 'run.json')) ids.push(entry.name);
      }
      return ids;
    }
    case 'generation_run_steps':
    case 'generation_run_events':
    case 'generation_run_commands': {
      const folder = name === 'generation_run_steps' ? 'steps'
        : name === 'generation_run_events' ? 'events' : 'commands';
      for (const entry of await listDir(dirs.runs(root))) {
        if (!entry.isDirectory()) continue;
        for (const child of await collectFileIds(join(dirs.runs(root), entry.name, folder),
          (file) => file.replace(/\.json$/, ''))) {
          ids.push(`${entry.name}/${child}`);
        }
      }
      return ids;
    }
    case 'asset_entries': {
      for (const entry of await listDir(dirs.classroom(root))) {
        if (!entry.isDirectory()) continue;
        for (const child of await collectFileIds(dirs.assetEntries(root, entry.name),
          (file) => file.replace(/\.json$/, ''))) {
          ids.push(`${entry.name}/${child}`);
        }
      }
      return ids;
    }
    case 'document_asset_refs': {
      // 文件名是 `<scope>-<scene>-<asset>`，每段自身可能含 `-`，拆字符串会切错，
      // 所以从**文件内容**取回三段主键（refs 体量小，读内容可接受）。
      for (const entry of await listDir(dirs.classroom(root))) {
        if (!entry.isDirectory()) continue;
        for (const child of await listDir(dirs.assetRefs(root, entry.name))) {
          if (!child.isFile() || !child.name.endsWith('.json')) continue;
          const parsed = await readJson(join(dirs.assetRefs(root, entry.name), child.name));
          if (!parsed.ok || !parsed.value || typeof parsed.value !== 'object') continue;
          const row = parsed.value;
          if (typeof row.sceneId !== 'string' || typeof row.assetId !== 'string'
            || typeof row.scope !== 'string') continue;
          ids.push(`${entry.name}/${row.scope}/${row.sceneId}/${row.assetId}`);
        }
      }
      return ids;
    }
    case 'agent_session_materials': {
      for (const entry of await listDir(dirs.materials(root))) {
        if (!entry.isDirectory()) continue;
        for (const child of await collectFileIds(dirs.materialSession(root, entry.name),
          (file) => file.replace(/\.json$/, ''))) {
          ids.push(`${entry.name}/${child}`);
        }
      }
      return ids;
    }
    default:
      return ids;
  }
}

async function collectFileIds(dir, toId) {
  const out = [];
  for (const entry of await listDir(dir)) {
    if (entry.isFile() && entry.name.endsWith('.json')) out.push(toId(entry.name));
  }
  return out;
}

/** 由 `document_asset_refs` 的文件名与内容推出复合 id。签名里保留两个参数以便将来扩展。 */
export function assetRefId(row) {
  return `${assertSegment(row.stageId, 'stageId')}/${assertSegment(row.scope, 'scope')}`
    + `/${assertSegment(row.sceneId, 'sceneId')}/${assertSegment(row.assetId, 'assetId')}`;
}
