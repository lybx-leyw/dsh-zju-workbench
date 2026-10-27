/**
 * 零依赖的 JSON Schema 子集校验器（2020-12）。
 *
 * # 为什么自己实现，而不是装 ajv
 *
 * 本仓硬约束是「零新 npm 依赖」，而这个 schema 用到的关键字是**闭集**：
 * `type`（含 type 数组）、`enum`、`const`、`required`、`additionalProperties:false`、
 * `properties`、`items`、`$ref`（含 `#/$defs/xxx`）、`pattern`、`minimum`、`maximum`、
 * `minLength`、`maxLength`、`format`（只做宽松的 `date-time`）。为这十几个关键字
 * 拉一个通用引擎进来，换来的只是「某天上游 schema 用了新关键字而校验器静默放过」的风险。
 * 这里反过来：**不认识的关键字直接报错**（见 `KNOWN_KEYWORDS`），
 * 于是 schema 一旦用到未实现的语义，测试会立刻红，而不是悄悄失真。
 *
 * # 三条硬要求
 *
 * 1. **带 JSON Pointer 路径**：错误定位到 `/chapters/0/topics/1/title` 这种粒度。
 *    只报「校验失败」的校验器在 chapter 嵌套 block 的深度下等于没报。
 * 2. **一次收集全部错误**：不是遇到第一个就抛。用户改一处、重跑一次、再看到下一处，
 *    是修复循环里最贵的那种交互。
 * 3. **不因类型错而级联**：一个字段是字符串而不是对象时，只报这一条，
 *    不再对它报「缺少 required 字段」—— 后者是噪声，会让真正的错因排到后面。
 *
 * # 语义对照（与 JSON Schema 一致，且都是有意为之）
 *
 * - `required` / `properties` / `additionalProperties` 只对**对象**生效；
 *   `anchor.timeRange` 的 type 是 `["object","null"]`，为 null 时不能报「缺少 startMs」。
 * - `minimum` / `maximum` 只对**数字**生效；`page` 的 type 是 `["integer","null"]`。
 * - `pattern` / `minLength` / `maxLength` 只对**字符串**生效。
 * - `enum` / `const` 走**规范化 JSON 深比较**，与 `hash.js` 用同一套键序无关的比较。
 */

import { readFileSync } from 'node:fs';

import { canonicalJson } from './hash.js';

/** schema 文件位置：真源在包内 `schema/`，只读，本模块从不写它。 */
export const SCHEMA_PATH = new URL('../schema/learning-resource.v1.json', import.meta.url);

/** 本校验器实现的全部关键字。schema 里出现别的关键字会在加载时直接报错。 */
export const KNOWN_KEYWORDS = Object.freeze([
  '$schema',
  '$id',
  '$defs',
  '$ref',
  'title',
  'description',
  'type',
  'enum',
  'const',
  'required',
  'additionalProperties',
  'properties',
  'items',
  'pattern',
  'minimum',
  'maximum',
  'minLength',
  'maxLength',
  'format',
]);

/** 只做声明、不做断言的注解关键字。 */
const ANNOTATION_KEYWORDS = Object.freeze(['$schema', '$id', '$defs', 'title', 'description']);

/** 宽松的 RFC 3339 date-time：日期 + 时分秒 + 可选小数秒 + 可选时区偏移。 */
const DATE_TIME_RE = /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:[Zz]|[+-]\d{2}:?\d{2})?$/;

/** type 关键字允许的取值；`integer` 是 `number` 的细化（要求 Number.isInteger）。 */
const TYPE_NAMES = Object.freeze([
  'null',
  'boolean',
  'object',
  'array',
  'number',
  'integer',
  'string',
]);

let cachedSchema = null;

/**
 * 读取并缓存包内 schema。
 *
 * 用 `readFileSync` 而不是 JSON import 属性：后者在不同 Node 小版本上的
 * 支持状态不一致（`with { type: 'json' }` vs 旧的 `assert`），而本包的
 * engines 是 `^22.19.0 || >=24.0.0`，二者都要能跑。
 */
export function loadSchema() {
  if (cachedSchema) return cachedSchema;
  const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
  assertKnownKeywords(schema, '#');
  cachedSchema = schema;
  return schema;
}

/**
 * 关键字白名单检查（加载期，不是校验期）。
 *
 * 这样「上游 schema 加了新关键字」这件事会以一句明确的中文错误暴露出来，
 * 而不是变成「校验变松了但没人发现」。
 */
export function assertKnownKeywords(schema, pointer = '#') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error(`schema 在 ${pointer} 处不是对象，无法校验`);
  }
  for (const key of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.includes(key)) {
      throw new Error(`schema 在 ${pointer} 处使用了本校验器未实现的关键字「${key}」`);
    }
  }
  for (const [key, child] of Object.entries(schema.properties ?? {})) {
    assertKnownKeywords(child, `${pointer}/properties/${key}`);
  }
  if (schema.items && typeof schema.items === 'object') {
    assertKnownKeywords(schema.items, `${pointer}/items`);
  }
  for (const [key, child] of Object.entries(schema.$defs ?? {})) {
    assertKnownKeywords(child, `${pointer}/$defs/${key}`);
  }
  return schema;
}

/** 运行时类型名（JSON 语义，不是 `typeof`）。 */
export function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function typeMatches(value, type) {
  const actual = jsonType(value);
  if (type === 'integer') return actual === 'number' && Number.isInteger(value);
  if (type === 'number') return actual === 'number' && Number.isFinite(value);
  return actual === type;
}

function describe(value) {
  const actual = jsonType(value);
  if (actual === 'string') return `字符串（${value.length} 字符）`;
  if (actual === 'number') return `数字 ${value}`;
  if (actual === 'boolean') return `布尔 ${value}`;
  if (actual === 'null') return 'null';
  if (actual === 'array') return `数组（${value.length} 项）`;
  return '对象';
}

function sameValue(left, right) {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

/** JSON Pointer 转义：`~` → `~0`，`/` → `~1`。 */
function escapePointer(segment) {
  return String(segment).replace(/~/g, '~0').replace(/\//g, '~1');
}

function childPath(path, segment) {
  return `${path}/${escapePointer(segment)}`;
}

/** `#/$defs/anchor` → 在根 schema 里取出对应子 schema。 */
function resolveRef(root, ref) {
  if (typeof ref !== 'string' || !ref.startsWith('#')) {
    throw new Error(`不支持的 $ref「${ref}」：本校验器只认本文档内的 # 开头指针`);
  }
  const raw = ref.slice(1);
  if (raw === '') return root;
  if (!raw.startsWith('/')) throw new Error(`$ref「${ref}」不是合法的 JSON Pointer`);
  let node = root;
  for (const part of raw.slice(1).split('/')) {
    const key = decodeURIComponent(part).replace(/~1/g, '/').replace(/~0/g, '~');
    node = node?.[key];
    if (node === undefined) throw new Error(`$ref「${ref}」在 schema 里找不到目标`);
  }
  return node;
}

/**
 * 校验单个值。
 *
 * @param value 待校验的值
 * @param schema 当前层 schema
 * @param path 当前 JSON Pointer（根为 `''`）
 * @param errors 收集器（会被就地追加）
 * @param root 根 schema（解析 `$ref` 用）
 * @param depth 递归深度护栏（防止自引用 schema 打死进程）
 */
function checkValue(value, schema, path, errors, root, depth = 0) {
  if (depth > 200) {
    errors.push({ path, keyword: 'depth', message: '嵌套层级过深，疑似 schema 自引用' });
    return;
  }
  if (!schema || typeof schema !== 'object') return;

  // $ref 与兄弟关键字并存时（2020-12 允许），先展开目标再把兄弟关键字也跑一遍。
  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    checkValue(value, target, path, errors, root, depth + 1);
    const siblings = { ...schema };
    delete siblings.$ref;
    if (Object.keys(siblings).some((key) => !ANNOTATION_KEYWORDS.includes(key))) {
      checkValue(value, siblings, path, errors, root, depth + 1);
    }
    return;
  }

  const actual = jsonType(value);

  // ---- type：不通过就到此为止，避免后续 required/pattern 级联出一堆噪声 ----
  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => TYPE_NAMES.includes(type) && typeMatches(value, type))) {
      errors.push({
        path,
        keyword: 'type',
        params: { expected: types },
        message: `类型应为 ${types.join(' | ')}，实际是${describe(value)}`,
      });
      return;
    }
  }

  // ---- enum / const ----
  if (Array.isArray(schema.enum) && !schema.enum.some((item) => sameValue(item, value))) {
    errors.push({
      path,
      keyword: 'enum',
      params: { allowed: schema.enum },
      message: `取值必须是 ${schema.enum.map((item) => JSON.stringify(item)).join(' / ')} 之一，实际是 ${JSON.stringify(value)}`,
    });
  }
  if ('const' in schema && !sameValue(schema.const, value)) {
    errors.push({
      path,
      keyword: 'const',
      params: { expected: schema.const },
      message: `取值必须恒为 ${JSON.stringify(schema.const)}，实际是 ${JSON.stringify(value)}`,
    });
  }

  // ---- 字符串关键字 ----
  if (actual === 'string') {
    const length = [...value].length;
    if (Number.isInteger(schema.minLength) && length < schema.minLength) {
      errors.push({
        path,
        keyword: 'minLength',
        params: { minLength: schema.minLength },
        message: `不能为空或过短：至少 ${schema.minLength} 个字符，实际 ${length} 个`,
      });
    }
    if (Number.isInteger(schema.maxLength) && length > schema.maxLength) {
      errors.push({
        path,
        keyword: 'maxLength',
        params: { maxLength: schema.maxLength },
        message: `过长：最多 ${schema.maxLength} 个字符，实际 ${length} 个`,
      });
    }
    if (typeof schema.pattern === 'string') {
      let re = null;
      try {
        re = new RegExp(schema.pattern, 'u');
      } catch {
        re = null;
      }
      if (re && !re.test(value)) {
        errors.push({
          path,
          keyword: 'pattern',
          params: { pattern: schema.pattern },
          message: `格式不符合 ${schema.pattern}，实际是「${value}」`,
        });
      }
    }
    if (schema.format === 'date-time') {
      // 宽松校验：形状对 + 能被 Date 解析。不做严格的日历月日校验 ——
      // 时间串来自上游/本地时钟，卡太死只会把「差一个闰秒」变成资源生成失败。
      const parsed = DATE_TIME_RE.test(value) ? Date.parse(value) : Number.NaN;
      if (!Number.isFinite(parsed)) {
        errors.push({
          path,
          keyword: 'format',
          params: { format: 'date-time' },
          message: `应为 ISO 8601 时间（如 2026-10-25T12:00:00.000Z），实际是「${value}」`,
        });
      }
    }
  }

  // ---- 数字关键字 ----
  if (actual === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push({
        path,
        keyword: 'minimum',
        params: { minimum: schema.minimum },
        message: `不能小于 ${schema.minimum}，实际是 ${value}`,
      });
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push({
        path,
        keyword: 'maximum',
        params: { maximum: schema.maximum },
        message: `不能大于 ${schema.maximum}，实际是 ${value}`,
      });
    }
  }

  // ---- 数组 ----
  if (actual === 'array') {
    if (schema.items && typeof schema.items === 'object' && !Array.isArray(schema.items)) {
      for (let index = 0; index < value.length; index++) {
        checkValue(value[index], schema.items, childPath(path, index), errors, root, depth + 1);
      }
    }
  }

  // ---- 对象 ----
  if (actual === 'object') {
    const properties = schema.properties ?? {};
    for (const key of schema.required ?? []) {
      if (value[key] === undefined) {
        errors.push({
          path: childPath(path, key),
          keyword: 'required',
          params: { required: key },
          message: `缺少必填字段「${key}」`,
        });
      }
    }
    for (const [key, item] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(properties, key)) {
        checkValue(item, properties[key], childPath(path, key), errors, root, depth + 1);
        continue;
      }
      // additionalProperties 省略时 = 允许任何额外字段；这里是白名单模式。
      if (schema.additionalProperties === false) {
        errors.push({
          path: childPath(path, key),
          keyword: 'additionalProperties',
          params: { property: key, allowed: Object.keys(properties) },
          message: `不允许出现未定义的字段「${key}」（允许的字段：${Object.keys(properties).join(', ') || '（无）'}）`,
        });
        continue;
      }
      if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        checkValue(item, schema.additionalProperties, childPath(path, key), errors, root, depth + 1);
      }
    }
  }
}

/**
 * 校验一份标准学习资源。
 *
 * @returns `{ valid: boolean, errors: Array<{path,keyword,params?,message}> }`
 *          —— 不抛异常：调用方要自己决定「报错」还是「降级」。
 *          路径用 JSON Pointer，根节点的错误是空字符串（表示「整个对象」）。
 */
export function validate(bundle, { schema = null } = {}) {
  const root = schema ?? loadSchema();
  /** @type {Array<{path: string, keyword: string, params?: object, message: string}>} */
  const errors = [];
  checkValue(bundle, root, '', errors, root);
  return { valid: errors.length === 0, errors };
}

/** 把错误列表拼成一段中文文案（日志/异常 message 用）。 */
export function formatErrors(errors, { limit = 8 } = {}) {
  if (!errors || errors.length === 0) return '';
  const shown = errors.slice(0, limit).map((error) => `${error.path === '' ? '(根)' : error.path}: ${error.message}`);
  const rest = errors.length - shown.length;
  return rest > 0 ? `${shown.join('；')}；另有 ${rest} 处错误` : shown.join('；');
}

/** 校验失败即抛出；成功时原样返回输入（便于链式）。 */
export function assertValid(bundle, options = {}) {
  const result = options.result ?? validate(bundle, options);
  if (!result.valid) {
    const error = new TypeError(`学习资源不符合 schema：${formatErrors(result.errors)}`);
    error.kind = 'E_RESOURCE_INVALID';
    error.errors = result.errors;
    throw error;
  }
  return bundle;
}
