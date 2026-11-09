/**
 * 能力层协议 —— 上游 `core/capability_protocol.py` 的 JS 对位。
 *
 * 只搬出题链真正会用到的部分：清单形状、能力目录、以及"前置条件失败"这个专用
 * 错误类型。
 *
 * # `CapabilityPrerequisiteError` 为什么要单独一个类型
 *
 * 上游的注释是"绝不要用强制收尾绕过它"。这条规则有实际后果：能力的前置条件
 * （缺讲义、模型不带工具能力）不满足时，正确的动作是**报错终止**，而不是让
 * 模型硬编一个答案出来 —— 后者会产出一批看起来合格、实际无据的题目，而评分器
 * 只会说"写作瑕疵有点多"，不会指出根因。
 */

export class CapabilityPrerequisiteError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CapabilityPrerequisiteError';
  }
}

/** 一个能力的静态元数据。 */
export function createCapabilityManifest({
  name,
  description = '',
  stages = [],
  toolsUsed = [],
  cliAliases = [],
  requestSchema = {},
  configDefaults = {},
} = {}) {
  if (!name) throw new Error('CapabilityManifest.name must not be empty');
  return {
    name,
    description,
    stages,
    tools_used: toolsUsed,
    cli_aliases: cliAliases,
    request_schema: requestSchema,
    config_defaults: configDefaults,
  };
}

/**
 * 能力目录：两层执行级别（`turn` / `loop_extension`）共用的工厂注册表。
 *
 * 键是 `(kind, name)` 而不是单独的 `name`：同一个名字可以既是 turn 能力又是
 * 循环扩展，两者不该互相覆盖。
 */
export class CapabilityCatalog {
  #entries = new Map();

  register({ name, kind, manifest, factory, configModel = null, replace = false } = {}) {
    const normalized = String(name ?? '').trim();
    if (!normalized) throw new Error('Capability name must not be empty');
    if (kind !== 'turn' && kind !== 'loop_extension') {
      throw new Error(`Unknown capability kind: ${String(kind)}`);
    }
    const key = `${kind}\u0000${normalized}`;
    if (this.#entries.has(key) && !replace) {
      throw new Error(`Capability already registered: ${kind}:${normalized}`);
    }
    const entry = {
      name: normalized,
      kind,
      manifest,
      factory,
      config_model: configModel,
      create: () => factory(),
    };
    this.#entries.set(key, entry);
    return entry;
  }

  get(kind, name) {
    return this.#entries.get(`${kind}\u0000${String(name ?? '').trim()}`) ?? null;
  }

  create(kind, name) {
    const entry = this.get(kind, name);
    return entry === null ? null : entry.create();
  }

  entries(kind = null) {
    const values = [...this.#entries.values()];
    return kind === null ? values : values.filter((entry) => entry.kind === kind);
  }

  clear() {
    this.#entries.clear();
  }
}

let defaultCatalog = null;

export function getCapabilityCatalog() {
  if (defaultCatalog === null) defaultCatalog = new CapabilityCatalog();
  return defaultCatalog;
}

export function setCapabilityCatalog(catalog = null) {
  defaultCatalog = catalog;
}

/**
 * 能力的抽象基类（JS 版就是约定 + 构造器）。
 *
 * 子类必须提供 `manifest` 并实现 `run(context, stream)`。
 */
export class TurnCapability {
  constructor(manifest) {
    if (!manifest) throw new Error('TurnCapability requires a manifest');
    this.manifest = manifest;
  }

  get name() {
    return this.manifest.name;
  }

  get stages() {
    return this.manifest.stages ?? [];
  }

  async run(_context, _stream) {
    throw new Error(`${this.constructor.name} must implement run()`);
  }
}
