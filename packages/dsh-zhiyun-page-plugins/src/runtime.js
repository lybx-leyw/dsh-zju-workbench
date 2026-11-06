// 依赖图的**折叠**：把宿主面与浏览器面各自的运行时读数，折成页面要的那一张图。
//
// 为什么是「折叠」而不是「扫描源码」：DSH 运行时本来就把依赖认好了，而且是两套真源 ——
//   1. 模块边：`ctx.modules.manifest.modules`（宿主侧 `ctx.clientModules.graph().entries`）。
//      它**已经是拓扑序** —— DSH 的 `orderByModuleGraph`（packages/client/modules/src/index.ts）
//      保证「被请求的行排在消费者之前」，每行带 `inject`（包名边）与 `external`（精确模块请求）；
//   2. 硬边：每个 Cordis fiber 的 `inject` 声明的服务名，加上 `ctx.reflect.store` 里该服务的
//      提供者 fiber。这是唯一「停用提供方 → 消费者变 pending」的关系，也就是界面上那句
//      「等待依赖」（`rowPhasePending`）。
// 本模块只做纯粹的合并、判定与排序：不碰 ctx、不认识 React，因此可以直接单测。
//
// 「叶」= 没有任何包请求它（在上述两套真源里都没有入边）。本仓的设计刻意让可选的加工步骤
// 走 `ctx.get` 惰性取而不是写进 `inject`（见 dsh-zhiyun-core-study/README.md「只声明硬依赖」），
// 所以叶就是可以安全取消的那一批，不需要再叠一层「入口包」保护。

/** 只看本仓的包；上游 @deepseek-ai/* 一律不进这张图。 */
export const ZHIYUN_PREFIX = 'dsh-zhiyun-';

/**
 * 把模块说明符归一到拥有它的图行。
 *
 * 一个插件 bundle 就是它所在包的客户端半边，所以 `<包名>/client` 与裸包名解析到同一份导出。
 * 与 DSH 自己的 `stripClientSuffix` 保持同一条规则 —— 两边不一致会让边凭空消失。
 * @param spec - `dsh.client.external` 里写的或 `require` 用的说明符。
 * @returns 去掉尾部 `/client` 的说明符。
 */
export function stripClientSuffix(spec) {
  return spec.endsWith('/client') ? spec.slice(0, -'/client'.length) : spec;
}

const EMPTY = Object.freeze([]);

/**
 * 把某个 fiber 追溯到拥有它的包名。
 *
 * 包的 Loader 条目只有一条 fiber，但包里的 `ctx.inject([...], cb)` / `ctx.plugin(...)` 会生出
 * 子 fiber —— 那些子 fiber 才是「等 zhiyunStudyController 到位」这类等待关系的真正持有者。
 * 顺着 `parent.fiber` 往上走就能把它们归到同一个包，这也是 Cordis 自己在解析服务时走的路径。
 * @param owner - 包 fiber → 包名。
 * @param fiber - 起点 fiber。
 * @returns 包名，追不到时 undefined。
 */
function makePackageOf(owner) {
  return function packageOf(fiber) {
    let current = fiber;
    // 环与深链条都终止：根 fiber 的 parent 是它自己。
    for (let step = 0; current != null && step < 64; step += 1) {
      const name = owner.get(current);
      if (name !== undefined) return name;
      const parent = current.parent?.fiber;
      if (parent === undefined || parent === current) return undefined;
      current = parent;
    }
    return undefined;
  };
}

/**
 * 读一个 Cordis 平面（宿主面或浏览器面）的服务依赖事实。
 *
 * 只读运行时自己用的字段：Loader 条目的 `options.name`/`fiber`、fiber 的 `inject` 与
 * `store`、以及 `ctx.reflect.store` 里每条实现的 `name`/`fiber`。不读私有字段，也不解析源码。
 *
 * 「在等哪个依赖」用的是 **fiber 自己的答案**：fiber `inject` 里列了、但它的 `store` 里没有
 * 那一项，就是此刻真的没解析到（Cordis 判定 fiber 能否激活用的正是同一份 `store`）。
 * 刻意不用「提供者能不能归到某个包」来判 —— `loader`、`profileContext` 这类由内核或引导
 * 提供的服务，提供者 fiber 不属于任何 Loader 条目，那样判会把它们全算成「等待依赖」
 * （真机截图上出现过）。
 * @param plane - `entries`（`ctx.loader.entries()`）、`runtimes`（`ctx.registry.values()`）、
 *   `store`（`ctx.reflect.store`）。
 * @returns 每个包的 `requires`/`unresolved`，以及全平面「服务 → 提供者包」（只含能归属的）。
 */
export function readPlane({ entries, runtimes, store }) {
  const owner = new Map();
  for (const entry of entries ?? []) {
    const name = entry?.options?.name;
    if (typeof name === 'string' && name !== '' && entry.fiber != null) owner.set(entry.fiber, name);
  }
  const packageOf = makePackageOf(owner);

  // 谁提供哪个服务：reflect 的 store 是全局的，按 impl.fiber 归属到包。归不到包的服务
  // （内核服务）不进这张表 —— 表只用来连边，不参与「是否在等待」的判定。
  const providers = new Map();
  for (const key of Reflect.ownKeys(store ?? {})) {
    const impl = store[key];
    if (impl == null || typeof impl.name !== 'string' || impl.name === '') continue;
    const pkg = packageOf(impl.fiber);
    if (pkg !== undefined && !providers.has(impl.name)) providers.set(impl.name, pkg);
  }

  // 谁需要哪个服务、其中哪些还没解析：把每个 fiber（含子 fiber）的 inject 与它自己的
  // store 累加到所属包上。
  const requires = new Map();
  const unresolved = new Map();
  for (const runtime of runtimes ?? []) {
    for (const fiber of runtime?.fibers ?? []) {
      const pkg = packageOf(fiber);
      if (pkg === undefined) continue;
      const set = requires.get(pkg) ?? new Set();
      const missing = unresolved.get(pkg) ?? new Set();
      const resolved = fiber?.store ?? {};
      for (const service of Object.keys(fiber?.inject ?? {})) {
        set.add(service);
        if (!(service in resolved)) missing.add(service);
      }
      requires.set(pkg, set);
      unresolved.set(pkg, missing);
    }
  }

  const rows = [];
  for (const name of new Set([...owner.values(), ...requires.keys()])) {
    rows.push({
      name,
      requires: [...(requires.get(name) ?? EMPTY)].sort(),
      unresolved: [...(unresolved.get(name) ?? EMPTY)].sort(),
    });
  }
  rows.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  return { rows, providers };
}

/**
 * 把某棵插槽活声明树折成「填内容者 → 声明者」的边。
 *
 * 为什么这条边必须进图：本仓的页面与外壳之间**只有**一条边 —— 「外壳声明插槽、页面填内容」
 * （见 dsh-zhiyun-page-today/README.md）。这条边既不是 `dsh.client.inject`/`external`，
 * 也不是服务 inject：页面用 `ctx.slots.inject('zhiyun.today.content', …)` 等外壳声明。
 * 少了它，`dsh-zhiyun-shell-workbench` 就会因为没有入边被判成「可以取消的叶」—— 而取消外壳正是
 * 会让五个页面一起消失的那种操作。
 *
 * 两个名字都不是包名，必须先翻回来（真机验证时两条都踩到过）：
 *   - `occupants[].registrant` 是 **fiber 名**（`ctx.fiber.name`，即插件导出的 `name`，
 *     如 `zhiyun-page-today-client`）；
 *   - `declaredBy` 是**诊断串**，DSH 的两种写法是 `an entry in "<插槽名>" (<registrant>)`
 *     与 `factory "<名>" (<registrant>)`，所以声明者的名字在末尾括号里，得解出来。
 * @param roots - `ctx.slots.snapshot()` 的结果。
 * @param inScope - 在范围内的包名。
 * @param fiberNames - fiber 名 → 包名（`fiberNameIndex`）。
 * @returns `{ from, to }` 对，from 依赖 to。
 */
export function slotEdges(roots, inScope, fiberNames = new Map()) {
  const packageOf = value => {
    if (typeof value !== 'string' || value === '') return undefined;
    if (inScope.has(value)) return value;
    const direct = fiberNames.get(value);
    if (direct !== undefined) return direct;
    // 诊断串：`an entry in "main" (zhiyun-shell-client)` / `factory "x" (name)`。
    const tagged = /\(([^()]+)\)\s*$/.exec(value);
    return tagged === null ? undefined : fiberNames.get(tagged[1]);
  };
  const pairs = [];
  const walk = (node) => {
    const owner = packageOf(node?.declaredBy);
    for (const occupant of node?.occupants ?? EMPTY) {
      const registrant = packageOf(occupant?.registrant);
      if (owner !== undefined && registrant !== undefined) pairs.push({ from: registrant, to: owner });
    }
    for (const child of node?.children ?? EMPTY) walk(child);
  };
  for (const root of roots ?? EMPTY) walk(root);
  return pairs;
}

/**
 * 建 fiber 名 → 包名的对照表。
 *
 * Loader 条目的名字是包名，而 fiber 的名字是插件自己导出的 `name`（两者不同，见
 * `slotEdges` 的说明）。两个都收：`runtime.name` 是插件直接声明的，`fiber.name` 是会向
 * 上继承的取值器（未命名插件继承最近的有名祖先）。`runtime.fibers` 里混着的
 * `ctx.inject`/`ctx.plugin` 子 fiber 没有条目，进不了表 —— 它们只用来算服务硬边。
 * @param entries - `ctx.loader.entries()`。
 * @returns fiber 名 → 包名。
 */
export function fiberNameIndex(entries) {
  const index = new Map();
  for (const entry of entries ?? EMPTY) {
    const pkg = entry?.options?.name;
    if (typeof pkg !== 'string' || pkg === '') continue;
    for (const name of [entry?.fiber?.runtime?.name, entry?.fiber?.name]) {
      if (typeof name === 'string' && name !== '' && name !== 'root' && !index.has(name)) index.set(name, pkg);
    }
  }
  return index;
}

/**
 * 求强连通分量（Tarjan）。
 * @param remaining - 尚未排定的节点。
 * @param edges - 邻接表。
 * @returns 每个分量一组。
 */
function components(remaining, edges) {
  let counter = 0;
  const index = new Map(), low = new Map(), stack = [], onStack = new Set(), out = [];
  const visit = (node) => {
    index.set(node, counter);
    low.set(node, counter);
    counter += 1;
    stack.push(node);
    onStack.add(node);
    for (const dep of edges.get(node) ?? EMPTY) {
      if (!remaining.has(dep)) continue;
      if (!index.has(dep)) {
        visit(dep);
        low.set(node, Math.min(low.get(node), low.get(dep)));
      } else if (onStack.has(dep)) {
        low.set(node, Math.min(low.get(node), index.get(dep)));
      }
    }
    if (low.get(node) !== index.get(node)) return;
    const group = [];
    let member;
    do {
      member = stack.pop();
      onStack.delete(member);
      group.push(member);
    } while (member !== node);
    out.push(group);
  };
  for (const node of remaining) if (!index.has(node)) visit(node);
  return out;
}

/**
 * 按依赖关系排序：被依赖的在前。
 *
 * 平局用运行时给的基线序（模块图序优先、profile 层序兜底）打散，所以图和 DSH 自己的顺序
 * 一致，不会因为一次重建就换一张排布。真出现环时**不抛错**：把最小的那个环整组按基线序落地
 * 并记下来，让页面能如实显示「这里有个环」，而不是让整页打不开。
 * @param names - 要排序的包名。
 * @param edges - 邻接表（依赖方向：消费者 → 被依赖者）。
 * @param baseline - 包名 → 基线序号。
 * @returns `{ order, cycles }`。
 */
export function orderGraph(names, edges, baseline) {
  const byBaseline = (a, b) => (baseline(a) - baseline(b)) || a.localeCompare(b, 'en');
  const depsOf = name => edges.get(name) ?? EMPTY;
  const remaining = new Set(names);
  const order = [];
  const cycles = [];
  while (remaining.size > 0) {
    const ready = [...remaining]
      .filter(name => [...depsOf(name)].every(dep => !remaining.has(dep)))
      .sort(byBaseline);
    if (ready.length === 0) {
      const groups = components(remaining, edges)
        .filter(group => group.length > 1 || depsOf(group[0]).has(group[0]))
        .sort((a, b) => byBaseline([...a].sort(byBaseline)[0], [...b].sort(byBaseline)[0]));
      const group = groups[0];
      if (group === undefined) break;
      const sorted = [...group].sort(byBaseline);
      cycles.push(sorted);
      for (const name of sorted) { order.push(name); remaining.delete(name); }
      continue;
    }
    for (const name of ready) { order.push(name); remaining.delete(name); }
  }
  return { order, cycles };
}

/**
 * 折出页面要的整张图。
 *
 * @param input - `bundles`（`listBundles()`）、`modules`（模块图行，已拓扑序）、`host`/`client`
 *   （两面的 `readPlane` 结果）、`plugins`（`listPlugins()`，用来取行级开关与 fiber 相位）、
 *   `slots`（`ctx.slots.snapshot()`）、`fiberNames`（`fiberNameIndex()`，把插槽里的 fiber 名
 *   翻回包名）、`prefix`。
 * @returns 拓扑序的 `rows`、`leaves`、层序违例、环，以及计数。
 */
export function buildView({ bundles, modules, host, client, plugins, slots, fiberNames, prefix = ZHIYUN_PREFIX }) {
  const list = (bundles ?? []).filter(bundle => typeof bundle?.name === 'string' && bundle.name.startsWith(prefix));
  const names = list.map(bundle => bundle.name);
  const inScope = new Set(names);
  const layerIndex = new Map(names.map((name, index) => [name, index]));

  // 行级开关才是这一页的写落点：一个包就是一个 bundle 插进来的一行，而「取消」用的是
  // `setPluginEnabled`（把 disabled 写进用户自己的 cordis.patch.yml）。它不动 profile 的
  // bundles 列表，所以行还在、可撤销，也不会被 profile 初始化重新补上。
  const pluginByEntryId = new Map();
  const pluginByModule = new Map();
  for (const plugin of plugins ?? []) {
    if (typeof plugin?.entryId === 'string') pluginByEntryId.set(plugin.entryId, plugin);
    if (typeof plugin?.moduleName === 'string' && !pluginByModule.has(plugin.moduleName)) pluginByModule.set(plugin.moduleName, plugin);
  }

  // 模块图的序号就是 DSH 自己算出来的拓扑序，所以它是打散平局的第一基线。
  const moduleIndex = new Map();
  for (const [index, row] of (modules ?? []).entries()) moduleIndex.set(row.id, index);
  const baseline = name => (moduleIndex.has(name) ? moduleIndex.get(name) : names.length + (layerIndex.get(name) ?? 0));

  const edges = new Map(names.map(name => [name, new Set()]));
  const addEdge = (from, to) => {
    if (from === to || !inScope.has(from) || !inScope.has(to)) return;
    edges.get(from).add(to);
  };

  // 一、模块边：inject 是包名边，external 是精确模块请求（`<包名>/client` 折回包名）。
  for (const row of modules ?? []) {
    if (!inScope.has(row.id)) continue;
    for (const spec of [...(row.inject ?? EMPTY), ...(row.external ?? EMPTY)]) {
      if (typeof spec === 'string') addEdge(row.id, stripClientSuffix(spec));
    }
  }

  // 二、硬边：包 A 需要服务 S，而 S 由包 B 提供 —— 停用 B 会让 A 变 pending。
  //
  // 「在等」用 fiber 自己的答案（`unresolved`），不在这里二次推断：服务有没有实现是 Cordis
  // 按 fiber 的 `store` 判的，而有些服务的提供者不属于任何 Loader 条目（内核/引导服务），
  // 照样是「已经有实现」。两面的读数都要先并进来，再判边 —— 否则结论会随遍历顺序而变。
  const serviceProviders = new Map();
  for (const plane of [host, client]) {
    for (const [service, provider] of plane?.providers ?? EMPTY) {
      if (!serviceProviders.has(service)) serviceProviders.set(service, provider);
    }
  }
  const waiting = new Map(names.map(name => [name, new Set()]));
  for (const plane of [host, client]) {
    for (const row of plane?.rows ?? EMPTY) {
      if (!inScope.has(row.name)) continue;
      for (const service of row.unresolved ?? EMPTY) waiting.get(row.name).add(service);
      for (const service of row.requires ?? EMPTY) {
        const provider = serviceProviders.get(service);
        // 提供者就在这个包里（自己 provide 自己 inject）不算依赖边。
        if (provider !== undefined && provider !== row.name) addEdge(row.name, provider);
      }
    }
  }

  // 三、插槽边：页面填内容、外壳声明插槽。这条边不在前面两套真源里，少了它外壳会被
  // 误判成叶（见 slotEdges 的说明）。
  for (const { from, to } of slotEdges(slots, inScope, fiberNames)) addEdge(from, to);

  const dependents = new Map(names.map(name => [name, new Set()]));
  for (const [from, targets] of edges) {
    for (const to of targets) dependents.get(to).add(from);
  }

  const { order, cycles } = orderGraph(names, edges, baseline);

  const rows = order.map(name => {
    const bundle = list.find(item => item.name === name);
    // 一个包由它 bundle 插进来的那些行构成；状态取自己的行（本仓每包恰好一行）。
    const row = bundle?.rows?.[0];
    const plugin = (row?.entryId === undefined ? undefined : pluginByEntryId.get(row.entryId))
      ?? (row?.moduleName === undefined ? undefined : pluginByModule.get(row.moduleName));
    const deps = [...edges.get(name)].sort();
    const parents = [...dependents.get(name)].sort();
    // 行级开关：`entryId` 是写动作要的句柄，`enabled` 是该行此刻是否运行。
    const enabled = plugin === undefined ? bundle?.enabled === true : plugin.enabled === true;
    const readOnlyReason = plugin?.readOnlyReason ?? bundle?.readOnlyReason;
    return {
      name,
      short: name.slice(prefix.length),
      enabled,
      entryId: typeof plugin?.entryId === 'string' ? plugin.entryId : undefined,
      readOnlyReason,
      phase: plugin?.fiberPhase ?? null,
      deps,
      dependents: parents,
      waiting: [...waiting.get(name)].sort(),
      leaf: parents.length === 0,
      // 可取消 = 正在运行、宿主允许改这一行、且没有任何包请求它。
      // 闸门口径照宿主自己的行开关（ui-plugin-manager 只看 readOnlyReason 与有无活条目）。
      cancellable: enabled && readOnlyReason === undefined && plugin?.entryId !== undefined && parents.length === 0,
      blocking: parents.length > 0 ? parents : undefined,
    };
  });

  // 层序违例：profile 的 bundles 顺序就是层顺序，后层覆盖前层；依赖若排在消费者之后，
  // 那张图与真正生效的层序就打架了 —— 页面必须把这件事说出来，而不是偷偷重排。
  const layerViolations = [];
  for (const [from, targets] of edges) {
    for (const to of targets) {
      if (layerIndex.get(to) > layerIndex.get(from)) layerViolations.push({ dependent: from, dependency: to });
    }
  }

  return {
    rows,
    order,
    leaves: rows.filter(row => row.leaf).map(row => row.name),
    cancellable: rows.filter(row => row.cancellable).map(row => row.name),
    cycles,
    layerViolations,
    enabled: rows.filter(row => row.enabled).map(row => row.name),
    disabled: rows.filter(row => !row.enabled).map(row => row.name),
  };
}
