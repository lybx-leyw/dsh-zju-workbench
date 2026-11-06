/**
 * **Cordis 插件包装（薄）**：把标准学习资源的四个纯函数挂到 ctx 上。
 *
 * # 本包的定位
 *
 * 这里承载的是**契约层**，不是业务层：`schema`（真源）、`validate`（结构闸门）、
 * `contentHash`/`revision`（缓存键）、`project`（给上游的紧凑视图 + 反查锚点）、
 * `anchors`（锚点索引）、`fromLecture`（从既有讲义投影）。
 *
 * 它**不落盘、不读环境变量、不碰宿主存储**：快照的落盘是宿主侧
 * `packages/dsh-zhiyun-host-deeptutor/src/resources.js` 的事（那边才知道数据目录在哪）。
 * 本包只保证「同一份内容永远得到同一个 revision」——缓存键这件事一旦有两个实现，
 * 半年内一定会漂开，而漂开的后果是派生产物被静默重算或命中错误的旧结果。
 *
 * # 为什么 inject 是空数组
 *
 * 校验、哈希、投影都是**纯函数**，不依赖宿主任何服务。写成 `inject: []` 而不是省略
 * `inject`，是为了让「本包不依赖宿主」这件事在启动图谱上直接可见 —— 它可以在任何
 * profile 里被加载而不拖慢启动。
 */

import { validate, loadSchema, formatErrors, assertValid, SCHEMA_PATH, KNOWN_KEYWORDS } from './validate.js';
import { contentHash, revisionOf, canonicalJson, hashOf, stamp, contentOf } from './hash.js';
import { project, lookupAnchor } from './project.js';
import { anchors, buildAnchorIndex, normalizeAnchor } from './anchors.js';
import { fromLecture, describeResource, resourceIdFor, lectureBlockText, lectureBlockType, LECTURE_BLOCK_TYPE_MAP } from './sources.js';

export const name = 'zhiyun-learning-resource';

/** 不依赖任何宿主服务：全是纯函数（见文件头注释）。 */
export const inject = [];

/**
 * 提前把 schema 读进来并做关键字白名单检查。
 *
 * 放在模块顶层（而不是 apply 里）是有意的：如果 schema 用了本校验器没实现的关键字，
 * 这个错应该在 `import` 时就炸，而不是等到用户第一次 attach 资源时才发现在校验变松。
 * 读文件失败也不抛 —— schema 缺失时 validate() 会自己再抛一次带路径的错，
 * 那种错比「模块加载失败」更好定位。
 */
let schemaError = null;
try {
  loadSchema();
} catch (error) {
  schemaError = error;
}

export function apply(ctx, config = {}) {
  const service = {
    /** schema 真源（只读；调用方不要就地改它）。 */
    get schema() {
      return loadSchema();
    },
    schemaPath: SCHEMA_PATH,
    keywords: KNOWN_KEYWORDS,

    validate,
    assertValid,
    formatErrors,
    contentHash,
    revisionOf,
    canonicalJson,
    hashOf,
    contentOf,
    stamp,
    project,
    lookupAnchor,
    anchors,
    buildAnchorIndex,
    normalizeAnchor,
    fromLecture,
    describeResource,
    resourceIdFor,
    lectureBlockText,
    lectureBlockType,
    blockTypeMap: LECTURE_BLOCK_TYPE_MAP,

    /** schema 加载是否正常（`false` 时 `schemaError` 给出原因）。 */
    get ready() {
      return schemaError === null;
    },
    get schemaError() {
      return schemaError;
    },

    /**
     * 一次性校验并签章：`bundle → 合法且带 revision/contentHash 的 bundle`。
     *
     * 宿主侧 attach 走的就是这条路：**先校验再算哈希**。反过来（先算哈希再校验）
     * 会让一份不合法的资源拿到一个看起来完全正常的 revision，然后被写进快照目录，
     * 之后所有人都会认为它是好的。
     */
    seal(bundle, options = {}) {
      const stamped = stamp(bundle, { generatedAt: options.generatedAt });
      const result = validate(stamped);
      if (!result.valid) {
        const error = new TypeError(`学习资源不符合 schema：${formatErrors(result.errors)}`);
        error.kind = 'E_RESOURCE_INVALID';
        error.errors = result.errors;
        throw error;
      }
      return stamped;
    },
  };

  const removeService = typeof ctx?.provide === 'function' ? ctx.provide('zhiyunLearningResource', service) : undefined;

  return () => {
    if (typeof removeService === 'function') removeService();
  };
}

// 纯函数也直接从包里导出：宿主侧（resources.js）要在没有 ctx 的单测里直接调用，
// 走 `ctx.zhiyunLearningResource` 反而要求测试先搭一个假 ctx。
export { validate, loadSchema, formatErrors, assertValid, SCHEMA_PATH, KNOWN_KEYWORDS };
export { contentHash, revisionOf, canonicalJson, hashOf, stamp, contentOf };
export { project, lookupAnchor };
export { anchors, buildAnchorIndex, normalizeAnchor };
export { fromLecture, describeResource, resourceIdFor, lectureBlockText, lectureBlockType, LECTURE_BLOCK_TYPE_MAP };
