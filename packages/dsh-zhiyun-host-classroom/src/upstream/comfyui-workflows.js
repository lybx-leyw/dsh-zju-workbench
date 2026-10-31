/**
 * ComfyUI 工作流发现（源文件:lib/media/comfyui-workflows.ts:1-107）。
 *
 * 上游把「哪些 workflow JSON 可选」这件事放在一个模块里，`GET /api/comfyui-workflows`
 * 与 ComfyUI 图像适配器共用，所以列表与实际可接受的文件**必然一致**。
 * 这里整份搬（判定规则、显示名转换、排序键、失败回 `[]`），只把 `public/`
 * 目录从 `process.cwd()/public` 改成可注入的 `publicDir`（桌面端没有 cwd/public）。
 *
 * 上游用 `await import('fs')` 是为了让模块在浏览器打包里可解析；本包是纯服务端
 * 包，静态 import 即可（`node:fs` 前缀也让它不可被打进浏览器）。
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** 把 workflow 文件名转成显示名（源:33-43，逐行照搬）。 */
export function filenameToDisplayName(filename) {
  return (
    filename
      .replace(/\.json$/i, '')
      .replace(/^comfyui[-_]?/i, '')
      .replace(/[-_]+/g, ' ')
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase())
    || 'Default Workflow'
  );
}

/** 文件名白名单（源:49-57）：必须 `.json`，且以 comfyui 开头或含 workflow。 */
export function isComfyuiWorkflowFilename(filename) {
  if (filename.includes('/') || filename.includes('\\') || filename.includes('..')) return false;
  const lower = filename.toLowerCase();
  return lower.endsWith('.json') && (lower.startsWith('comfyui') || lower.includes('workflow'));
}

/**
 * 上游 `listComfyuiWorkflows`（源:75-99）。
 *
 * @param {object} [options]
 * @param {string} [options.publicDir] 默认 `process.cwd()/public`
 * @param {{ error: Function }} [options.log]
 */
export async function listComfyuiWorkflows({ publicDir = join(process.cwd(), 'public'), log } = {}) {
  try {
    if (!existsSync(publicDir)) return [];
    return readdirSync(publicDir)
      .filter((file) => isComfyuiWorkflowFilename(file) && statSync(join(publicDir, file)).isFile())
      .map((filename) => ({ id: filename, name: filenameToDisplayName(filename) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    log?.error?.('[ComfyUI Workflows] Failed to list workflows:', error);
    return [];
  }
}
