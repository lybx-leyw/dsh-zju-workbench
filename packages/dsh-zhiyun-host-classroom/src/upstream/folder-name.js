/**
 * 目录名校验（源文件:lib/utils/folder-name-validation.ts，逐行照搬）。
 *
 * 规则是**显示宽度**而不是字符数：全角计 2、半角计 1，上限 40。
 * `POST /api/folders` 的 400（`FOLDER_NAME_EMPTY` / `FOLDER_NAME_TOO_LONG`）
 * 完全由这个函数决定，客户端弹窗也 import 同一份规则，所以两端不会漂。
 */

/** 目录名的最大显示宽度（约 20 个汉字 / 40 个半角字符）。 */
export const FOLDER_NAME_MAX_WIDTH = 40;

/** 每个用户的目录数软上限。 */
export const FOLDER_COUNT_LIMIT = 50;

/** 全角字符范围（CJK、谚文、全角形式、CJK 标点、假名）。 */
const FULL_WIDTH_CHARS =
  /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE10-\uFE19\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6\u3000-\u303F\u3040-\u30FF]/;

/** 目录名拒绝（源:26-34）。`kind` 是机器码，UI 据此本地化。 */
export class FolderNameError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'FolderNameError';
    this.kind = kind;
  }
}

/** 上游 `displayNameWidth`（源:63-69）。 */
export function displayNameWidth(str) {
  let width = 0;
  for (const ch of str) width += FULL_WIDTH_CHARS.test(ch) ? 2 : 1;
  return width;
}

/** 上游 `validateFolderName`（源:76-84）。不查重（查重要拿到现有列表）。 */
export function validateFolderName(name) {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return { ok: false, kind: 'empty', width: 0 };
  const width = displayNameWidth(trimmed);
  if (width > FOLDER_NAME_MAX_WIDTH) return { ok: false, kind: 'tooLong', width };
  return { ok: true };
}
