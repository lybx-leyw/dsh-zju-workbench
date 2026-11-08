/**
 * 用量日志读取（源文件:lib/server/usage-storage.ts:1-211，只搬读侧）。
 *
 * `GET /api/usage` 只调 `readUsageRecords({ months })`，所以写侧（`recordUsage`）
 * 不在本批范围（它是生成链路的副作用，属 L2）。读侧逐行照搬：
 * 目录不存在返回 `[]`、坏行跳过、无 `kind` 的旧行按 `llm`、按文件名排序后逐行解析。
 *
 * 唯一改动：目录从 `process.cwd()/data/usage` 变成可注入的 `baseDir`
 * （桌面端数据根在 profile 下，不在 cwd）。
 */

import { promises as fs } from 'node:fs';
import { join } from 'node:path';

/** 上游 `usageDir`（源:9-11）。 */
export function usageDir(baseDir) {
  return baseDir ?? join(process.cwd(), 'data', 'usage');
}

/**
 * 上游 `readUsageRecords`（源:178-211）。
 *
 * @param {{ baseDir?: string, months?: string[] }} [opts]
 * @returns {Promise<object[]>}
 */
export async function readUsageRecords(opts = {}) {
  const dir = usageDir(opts.baseDir);
  let files;
  try {
    files = (await fs.readdir(dir)).filter((file) => file.endsWith('.jsonl'));
  } catch {
    return [];
  }
  if (opts.months?.length) {
    files = files.filter((file) => opts.months.some((month) => file.startsWith(month)));
  }

  const records = [];
  for (const file of files.sort()) {
    let content;
    try {
      content = await fs.readFile(join(dir, file), 'utf-8');
    } catch {
      continue;
    }
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed);
        if (!row.kind) row.kind = 'llm';
        records.push(row);
      } catch {
        // 跳过坏行（上游同样处理）
      }
    }
  }
  return records;
}
