import { ParserError } from './errors.js';

/** Persist only model identifiers and quotas, never provider credentials. */
export function normalizeWorkers(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 16) throw new ParserError('INPUT', '请选择 1–16 个供应商');
  const seen = new Set();
  return entries.map(entry => {
    const { provider, model, workers } = entry ?? {};
    if (typeof provider !== 'string' || !provider.trim() || provider.length > 200 || typeof model !== 'string' || !model.trim() || model.length > 300
      || !Number.isInteger(workers) || workers < 1 || workers > 32 || seen.has(provider)) throw new ParserError('INPUT', '每个供应商选择一个模型，worker 数须为 1–32');
    seen.add(provider);
    return { provider, model, workers };
  });
}

/** One run owns one pool. All v4 stages share each provider's in-flight quota. */
export class WorkerPoolLlm {
  constructor({ base, entries }) {
    this.base = base;
    this.entries = normalizeWorkers(entries).map(entry => ({ ...entry, active: 0, completed: 0, failed: 0 }));
    this.concurrency = this.entries.reduce((sum, entry) => sum + entry.workers, 0);
    this.acceptsAccel = base.acceptsAccel;
    this.managesConcurrency = true;
    this.queue = [];
    this.cursor = 0;
  }
  image(...args) { return this.base.image(...args); }
  get snapshot() { return this.entries.map(({ provider, model, workers, active, completed, failed }) => ({ provider, model, workers, active, completed, failed })); }
  async prepare(signal) {
    this.ready ??= Promise.all(this.entries.map(async entry => {
      const info = await this.base.llm.resolveModelInfo(entry.provider, entry.model, signal);
      entry.vision = info.inputModalities?.includes('image') === true;
      entry.routes = await this.base.resolve(signal, { vision: entry.vision, selection: { provider: entry.provider, model: entry.model } });
    })).catch(error => { this.ready = null; throw error; });
    await this.ready;
    signal?.throwIfAborted();
  }
  async resolve(signal, { vision = true } = {}) {
    await this.prepare(signal);
    if (vision && !this.entries.some(entry => entry.vision)) throw new ParserError('VISION_MODEL', '所选模型中至少需要一个支持图片的模型');
    // Cache identity includes the entire eligible model pool and resolved settings.
    const identity = kind => ({ workerPool: this.entries.filter(entry => kind !== 'vision' || entry.vision)
      .map(entry => ({ ...entry.routes[kind], workers: entry.workers })), modality: kind });
    return { text: identity('text'), ...(vision ? { vision: identity('vision') } : {}) };
  }
  async call(request) {
    await this.prepare(request.signal);
    request.signal?.throwIfAborted();
    const vision = Boolean(request.image);
    if (vision && !this.entries.some(entry => entry.vision)) throw new ParserError('VISION_MODEL', '所选模型不支持图片');
    return new Promise((resolve, reject) => {
      const item = { request, vision, resolve, reject };
      item.cancel = () => {
        const index = this.queue.indexOf(item);
        if (index >= 0) this.queue.splice(index, 1);
        request.signal?.removeEventListener('abort', item.cancel);
        reject(request.signal.reason);
      };
      request.signal?.addEventListener('abort', item.cancel, { once: true });
      this.queue.push(item);
      this.drain();
    });
  }
  drain() {
    for (let index = 0; index < this.queue.length;) {
      const item = this.queue[index];
      const available = this.entries.map((_, offset) => (this.cursor + offset) % this.entries.length)
        .filter(i => this.entries[i].active < this.entries[i].workers && (!item.vision || this.entries[i].vision));
      if (!available.length) { index++; continue; }
      const chosen = available.reduce((a, b) => this.entries[b].active / this.entries[b].workers < this.entries[a].active / this.entries[a].workers ? b : a);
      const entry = this.entries[chosen];
      this.cursor = (chosen + 1) % this.entries.length;
      this.queue.splice(index, 1);
      item.request.signal?.removeEventListener('abort', item.cancel);
      entry.active++;
      const route = { ...entry.routes[item.vision ? 'vision' : 'text'] };
      if (item.request.route?.maxTokens !== undefined) route.maxTokens = item.request.route.maxTokens;
      Promise.resolve().then(() => {
        item.request.signal?.throwIfAborted();
        return this.base.call({ ...item.request, route });
      }).then(result => { entry.completed++; item.resolve(result); }, error => { entry.failed++; item.reject(error); })
        .finally(() => { entry.active--; this.drain(); });
    }
  }
}
