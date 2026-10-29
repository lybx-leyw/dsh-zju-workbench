/**
 * 讲义导出到笔记库：路径推导与重名规避。**纯函数**，零 IO。
 *
 * # 这个包只做一件事
 *
 * 把当前讲义（`record.lecture`）**单向导出**成笔记库里的一份 md。
 *
 * # 三条刻意的边界
 *
 * 1. **单向**。导出只写、不回读。笔记库里的 md 是用户的东西，本包不把它当真源。
 * 2. **不覆盖**。每次导出都新写一份；重名时按「（2）（3）…」加后缀，
 *    由用户自己在笔记库里挑哪个留、哪个删。
 * 3. **`record.lecture` 不动**。学习页显示、讲义检索、出题、知识点导航全都继续读它，
 *    导出的笔记与它们无关 —— 导出失败不影响生成，导出成功也不改变任何既有行为。
 *
 * # 为什么没有版本对 / 归档 / swap
 *
 * 早期设计把「版本 =（AI 基线, 讲义 md）」做成本包的核心：重新生成时换版、
 * 旧版进归档、回退时对调正文与基线。那套设计要让 md 成为真源，就必须改掉
 * 四处读取路径（学习页、两层检索、出题），也就是把讲义与笔记库**深度挂钩**。
 *
 * 后来定了更简单的口径：导出只是给用户一份**可以自己编辑的副本**，
 * 副本的历史与回退由用户在笔记库里自己处理。于是版本对、归档目录、swap
 * 全部不再需要 —— 保留它们只会留下一堆没人调的代码和没人读的文件。
 *
 * 代价是明确的：**回退不会改变学习页看到的讲义**。学习页继续显示 `record.lecture`，
 * 那是「AI 生成的最新一份」；笔记库里的副本是用户自己的，两者不必一致。
 */

/**
 * 一节课的讲义在笔记库里的基准路径（不带 `.md`，与笔记页的键一致）。
 *
 * # 为什么按「学期 / 课程 / 节次」组织
 *
 * 只按「课程 / 节次」摆的话，同一个课程名在不同学期会落进同一个文件夹，
 * 版本一多就分不清哪些讲义属于哪一学期。学期是用户自己脑子里用的第一层分类，
 * 笔记库跟着它走，用户不用重新建立归属感。
 *
 * `termName` 缺失时退化成「课程 / 节次」两层 —— **不编造一个「未分学期」的假目录**：
 * 多一层假分类比少一层真分类更难解释。
 *
 * @param {{courseTitle: string, lessonTitle: string, termName?: string|null}} input
 */
export function currentNotePath(input) {
  const course = segment(input?.courseTitle);
  const lesson = segment(input?.lessonTitle);
  const term = typeof input?.termName === 'string' && input.termName.trim() !== '' ? input.termName.trim() : null;
  return term === null ? `${course}/${lesson}` : `${segment(term)}/${course}/${lesson}`;
}

/**
 * 由「想要的键」推一个**不与已有笔记冲突**的键。
 *
 * 重名不覆盖是有意的：导出是附加动作，用户可能在导出的那份上手写了很久。
 * 再导一次就拿新内容盖掉它，等于把用户的工作删了 —— 而用户点「导出」时
 * 期待的是「再拿一份」，不是「覆盖上次那份」。
 *
 * 后缀用全角 `（2）`，与用户在中文笔记里的习惯一致；序号从 2 开始
 * （第一份不带后缀，否则用户看到的第一份就叫「（1）」，反直觉）。
 *
 * @param {string} base - `currentNotePath` 给出的基准键。
 * @param {Iterable<string>} taken - 笔记库里**已存在**的键（不带 `.md`）。
 * @returns {string} 可用的键；基准本身可用时原样返回。
 */
export function availableNotePath(base, taken) {
  const used = taken instanceof Set ? taken : new Set(taken ?? []);
  if (!used.has(base)) return base;
  // 上限是防御性的：真到 1000 份说明用户根本没在清理，给个明确的错误
  // 比继续往后加序号更有用。
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base}（${n}）`;
    if (!used.has(candidate)) return candidate;
  }
  throw Object.assign(new Error('同名笔记太多（已到 1000 份），请先清理笔记库'), { code: 'TOO_MANY' });
}

/**
 * 把笔记库的条目表折成「已存在的键」集合。
 *
 * 笔记页的条目表里，笔记是 `{path, type:'note'}` 且 `path` **不带 `.md`**，
 * 文件夹与附件也在表里（`type` 是 `folder` / `attachment`）。只取笔记的原因：
 * 重名避让只需要避开同名的**笔记文件**；同名文件夹是另一回事（本包不建文件夹目录，
 * 只在已有的课程目录下写文件）。
 *
 * @param {Array<{path: string, type?: string}>} entries - `tree()` 的扁平条目表。
 * @returns {Set<string>}
 */
export function existingNoteKeys(entries) {
  const out = new Set();
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (entry?.type !== 'note') continue;
    const path = String(entry.path ?? '').replace(/\\/g, '/');
    if (path !== '') out.add(path);
  }
  return out;
}

/**
 * 由课程名 / 节名拼出一段安全路径。
 *
 * 这里**不做**笔记库那套完整清洗（那是它的职责，并且有自己的测试）。
 * 但空名必须挡住：空段会被下游的中和逻辑吃掉，最后两节课写进同一个路径。
 */
function segment(raw) {
  const text = String(raw ?? '').trim();
  if (text === '') throw Object.assign(new Error('课程名与节名不能为空'), { code: 'INPUT' });
  return text;
}
