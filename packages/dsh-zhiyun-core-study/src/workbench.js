import { readFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { exportReorganization, mergeReorganization } from "dsh-zhiyun-core-lecture/agent-text";
import { QUIZ_TYPES } from "dsh-zhiyun-core-quiz/model";
import { QUIZ_MATERIAL_SELECTIONS, makeSourceMaterial } from "dsh-zhiyun-core-quiz/generate";
import { createQuizStore } from "dsh-zhiyun-core-quiz/store";
import { hasContent, pageLink, parseZySectionUri, timeLink } from "dsh-zhiyun-core-notes/note";
import { writeFileAtomic } from "@deepseek-ai/dsh-atomic-write";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const fault = (code, message) => Object.assign(new Error(message), { code });
const identifier = (value) => {
  if (typeof value !== "string" || !/^\d{1,20}$/.test(value)) throw fault("INPUT", "课程或节次编号无效");
  return value;
};
// 与课堂包 `models.date` 同一条规则：只认 YYYY-MM-DD，并且拒掉 `2026-02-31`
// 这种「格式对、日子不存在」的日期（`Date.parse` 会把它悄悄滚到三月）。
//
// 为什么不直接 import `models.date`：本包的依赖表里没有 `dsh-zhiyun-source-classroom`
// （classroom 是宿主 inject 进来的**服务实例**，不是可 import 的模块对象），
// 为一行校验添一条运行时依赖不划算。代价是这条规则有两份，改动时要两边同步。
const isoDay = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw fault("INPUT", "日期须为 YYYY-MM-DD");
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) throw fault("INPUT", "日期不存在");
  return value;
};
// 直播流必须经本机转发端点播放，浏览器才能放：CDN 校验 Referer/Origin、清单里
// 写的是相对分片、并且跨域（三条原因都写在 `classroom/src/stream.js` 的文件头）。
// 前缀与那边的 `STREAM_ROUTE_PREFIX` 必须一致 —— 同样因为依赖表里没有 classroom
// 包，这里留一份字符串常量，而不是为了一个字符串去 import 一个包。
const LIVE_RELAY_PREFIX = "/zhiyun-live";
const liveRelayUrl = (url) => (typeof url === "string" && url ? `${LIVE_RELAY_PREFIX}/hls?u=${encodeURIComponent(url)}` : null);
/**
 * 把一路直播流收敛成**客户端该怎么播**的样子。
 *
 * 两条取舍：
 *
 * 1. 只留转发地址，**不留原始 CDN 地址**。原始直链交给浏览器既放不出来（CDN 校验
 *    Referer、清单里是相对分片、还有跨域），也没必要让它出现在页面的 DOM、React
 *    props 与网络面板里。所以 `url` / `watchUrl` / `recordUrl` 三个字段**一律**换成
 *    转发地址 —— 键名一个不少（按老字段读的界面不会读到 undefined），但读到的一定
 *    是能播的本机地址；原始地址在返回值里不再出现。
 * 2. 转发端点只接受 `https:` 目标（`stream.js` 的 `checkTarget` 有一条协议白名单），
 *    所以 `rtmp:` / `webrtc:` 这类地址改写过去只会换回 403。与其给一个注定失败的
 *    播放按钮，不如把地址留空、让 `playable: false` 说明「这路流浏览器放不了」。
 *    `type` 原样保留，界面想自己判断也有依据。
 */
const relayStream = (stream) => {
  const watch = typeof stream?.watchUrl === "string" && stream.watchUrl ? stream.watchUrl : stream?.url;
  const record = typeof stream?.recordUrl === "string" && stream.recordUrl ? stream.recordUrl : watch;
  const hls = (value) => (/^https:\/\//i.test(value ?? "") ? liveRelayUrl(value) : null);
  const play = hls(watch);
  return {
    key: stream?.key ?? "extra", label: stream?.label ?? null, type: stream?.type ?? "unknown",
    url: play, watchUrl: play, recordUrl: hls(record), playUrl: play, playable: Boolean(play),
  };
};
// dropped 里只剩「哪几路没被采用」的安全元数据：key / label / type 够界面说明情况，
// host 是 CDN 主机名，客户端用不到，白白送进 DOM 也没有收益。
const relayDropped = (item) => ({ key: item?.key ?? "extra", label: item?.label ?? null, type: item?.type ?? "unknown" });

// The parser's final transcript is immutable input to the separately versioned handout.
export const finalVersion = record => digest(JSON.stringify([record.sourceId, record.pages, record.sentences, record.unassignedSentences, record.blocks, record.spine, record.outline]));
const identity = key => { const [accountId, courseId, subId] = key.split(":"); return { accountId, courseId, subId }; };
const faultMessages = {
  NOT_WIRED: "所需加工插件未启用，请检查插件配置。", FORMAT: "终审稿格式无法读取，已保留上一版讲义。",
  CORRUPT: "已有学习资料无法读取，原文件已保留。", INVALID_RECORD: "产物未通过存储校验，未覆盖已有资料。",
  TIMEOUT: "加工超时，已有终稿和讲义已保留。", ABORTED: "加工已取消。",
  NO_PROVIDER: "终审所需的宿主子 Agent 服务不可用。", AGENT_START_FAILED: "终审 Agent 启动失败，请检查宿主模型和预设。",
  NO_MAIN: "本节没有可用的主线块，请先完成终稿标注。", NO_TOPICS: "未从课件中提取出可写成讲义的知识点。",
  SLIDE_READ_FAILED: "课件图片尚未成功解析。请重新整理这节课，再生成讲义。",
  NOT_FOUND: "找不到这道题，它可能已被丢弃。",
  PERSIST: "笔记没有写入，请重试。",
  RECENT: "上次打开的位置读不出来，原文件已保留。",
};
export const publicError = (error) => ({ code: error.code ?? "FAILED", message: {
  ...faultMessages,
  VISION_MODEL: "请选择支持图片的视觉模型，再开始解析。",
  CONFIG: "请先在个人面板配置可用的 AI 服务。",
  SESSION_EXPIRED: "课堂登录已过期，请重新登录。",
  CANCELLED: "已取消解析。",
  PARTIAL_SOURCE: "课件或字幕仍在处理中，请稍后再试。",
  INPUT: "输入信息无效。",
  NETWORK: "课堂服务暂时无法连接，请稍后重试。",
  API_SHAPE: "课堂服务返回的数据格式发生变化，请更新应用或反馈问题。",
  AUTH_REJECTED: "账号或密码未通过验证。",
  CREDENTIALS: "请输入浙大账号和密码。",
  ACCOUNT_BUSY: "账号正在切换，请稍候。",
  BUSY: "已有加工任务正在运行，请等待完成或先取消。"
}[error.code] ?? "操作未完成，请重试。" });
export class StudyWorkbench {
  constructor({ classroom, parser, llm, directory, lecture, finalPass, quiz, notes, knowledge }) {
    this.classroom = classroom;
    this.parser = parser;
    this.llm = llm;
    this.directory = directory;
    if (!knowledge?.get || !knowledge?.put) throw fault("CONFIG", "学习工作台需要知识库存储服务");
    this.knowledge = knowledge;
    this.mutations = new Map();
    this.migrations = new Map();
    // 讲义装配与无曰终审**惰性取用**（传进来的是取值函数，不是服务实例）。
    //
    // ⚠️ 不写进插件的 `inject` 是有意的：`inject` 是**硬依赖** —— 任一被停用
    //    都会让整个学习面板 pending（连解析都用不了）。这两个是可选的加工步骤，
    //    缺了应当只让「讲义 / 终审」这两个动作如实报未接入，而不是把页面拖死。
    this.lectureOf = lecture ?? (() => undefined);
    this.finalPassOf = finalPass ?? (() => undefined);
    // 出题与节笔记同样是可选加工：停用其中一个只让对应动作报未接入。
    // 出题的题库不使用插件上的单例 store（那个 store 跨节共享、且不落盘），
    // 每次按本节记录自建一份，再把快照写回知识库。
    this.quizOf = quiz ?? (() => undefined);
    this.notesOf = notes ?? (() => undefined);
    this.jobs = new Map();
    this.closed = false;
    this.accountBusy = false;
    this.controllers = new Set();
    this.recentQueue = Promise.resolve();
    this.ready = this.loadRoutes();
  }
  async loadRoutes() {
    try {
      const r = JSON.parse(await readFile(path.join(this.directory, "models.json"), "utf8"));
      this.parser.llm.routes = this.cleanRoutes(r);
    } catch (e) {
      if (e.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
    }
  }
  cleanRoutes(routes = {}) {
    const out = {};
    for (const key of ["vision", "text"]) {
      const r = routes[key];
      if (r == null) continue;
      if (typeof r.provider !== "string" || typeof r.model !== "string" || !r.provider || !r.model || r.provider.length > 200 || r.model.length > 300) throw fault("INPUT", "模型路由无效");
      out[key] = { provider: r.provider, model: r.model };
    }
    return out;
  }
  async atomic(file, data) {
    // 复用宿主的原子替换：它专门处理了 Windows 上 rename 的瞬态
    // EACCES/EBUSY/EPERM 重试，并保证替换后的 inode 带上传入的权限位。
    // 手写 `writeFile` + `rename` 在 Windows 上会偶发失败。
    await writeFileAtomic(file, JSON.stringify(data), { mode: 0o600, dirMode: 0o700 });
  }
  async scheduleWindow(payload, signal) {
    const window = {};
    for (const key of ["start", "end"]) {
      if (payload[key] == null || payload[key] === "") continue;
      if (typeof payload[key] !== "string") throw fault("INPUT", "日期无效");
      window[key] = payload[key];
    }
    try {
      return await this.classroom.getSchedule({ ...window, signal });
    } catch (error) {
      if (error instanceof TypeError) throw fault("INPUT", "日期无效");
      throw error;
    }
  }
  recentFile() { return path.join(this.directory, "recent.json"); }
  async readRecentFile() {
    try {
      const parsed = JSON.parse(await readFile(this.recentFile(), "utf8"));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw fault("RECENT", "上次打开的位置无法读取");
      return parsed;
    } catch (error) {
      if (error.code === "ENOENT") return {};
      if (error.code === "RECENT") throw error;
      if (error instanceof SyntaxError) throw fault("RECENT", "上次打开的位置无法读取");
      throw error;
    }
  }
  enqueueRecent(task) {
    const run = this.recentQueue.then(task, task);
    this.recentQueue = run.then(() => {}, () => {});
    return run;
  }
  clipTitle(value) {
    if (value == null || value === "") return "";
    if (typeof value !== "string") throw fault("INPUT", "标题无效");
    return value.slice(0, 200);
  }
  async recall(user) {
    if (!/^[^\s:]+$/.test(String(user.id))) throw fault("INPUT", "账号标识无效");
    const all = await this.readRecentFile();
    return all[String(user.id)] ?? null;
  }
  async remember(user, payload) {
    if (!/^[^\s:]+$/.test(String(user.id))) throw fault("INPUT", "账号标识无效");
    const entry = {
      courseId: identifier(payload.courseId),
      subId: identifier(payload.subId),
      courseTitle: this.clipTitle(payload.courseTitle),
      lessonTitle: this.clipTitle(payload.lessonTitle),
      openedAt: new Date().toISOString(),
    };
    await this.enqueueRecent(async () => {
      const all = await this.readRecentFile();
      all[String(user.id)] = entry;
      await this.atomic(this.recentFile(), all);
    });
    return entry;
  }
  async user() {
    if (this.accountBusy) throw fault("ACCOUNT_BUSY", "账号正在切换");
    const user = await this.classroom.getCurrentUser();
    if (!user) throw fault("SESSION_EXPIRED", "需要登录");
    return user;
  }
  key(user, courseId, subId) {
    if (!/^[^\s:]+$/.test(String(user.id))) throw fault("INPUT", "账号标识无效");
    return `${user.id}:${identifier(courseId)}:${identifier(subId)}`;
  }
  file(key) {
    return path.join(this.directory, "results", `${digest(key)}.json`);
  }
  async result(key) {
    const current = await this.knowledge.get(identity(key));
    if (current) return structuredClone(current);
    if (this.migrations.has(key)) return this.migrations.get(key);
    const migration = this.migrate(key); this.migrations.set(key, migration);
    try { return await migration; } finally { this.migrations.delete(key); }
  }
  async migrate(key) {
    // Lazy migration: only the currently authenticated account can derive this
    // old hash. Keep the old file as a recovery copy; never dual-write it.
    let old;
    try { old = JSON.parse(await readFile(this.file(key), "utf8")); }
    catch (e) { if (e.code === "ENOENT") return null; if (e instanceof SyntaxError) throw fault("CORRUPT", "旧产物 JSON 损坏"); throw e; }
    if (old.schema !== 1 || !Array.isArray(old.blocks)) throw fault("CORRUPT", "旧产物格式无效");
    const { finalPass: legacyReview, ...record } = old;
    record.sourceVersion = finalVersion(record);
    if (record.lecture) record.lecture = { ...record.lecture, sourceVersion: record.sourceVersion,
      revision: digest(JSON.stringify(record.lecture)), review: null,
      warnings: [...(record.lecture.warnings ?? []), ...(legacyReview ? ["旧终审文本未合回结构，请重新终审讲义。"] : [])] };
    // A concurrent migration may have already populated the domain.
    if (!await this.knowledge.get(identity(key))) await this.knowledge.put({ ...record, ...identity(key) });
    return structuredClone(await this.knowledge.get(identity(key)));
  }
  async save(key, record) { await this.knowledge.put(JSON.parse(JSON.stringify({ ...record, ...identity(key) }))); }
  async mutate(key, signal, work) {
    if (this.closed) throw fault("DISPOSED", "服务已关闭");
    if (this.accountBusy) throw fault("ACCOUNT_BUSY", "账号正在切换");
    if (this.mutations.has(key)) throw fault("BUSY", "这一节已有加工任务");
    const controller = new AbortController();
    const entry = { controller, done: null };
    this.mutations.set(key, entry);
    entry.done = Promise.resolve().then(() => work(AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])));
    try { return await entry.done; } finally { if (this.mutations.get(key) === entry) this.mutations.delete(key); }
  }
  view(job) {
    return job ? { id: job.id, courseId: job.courseId, subId: job.subId, state: job.state, progress: job.progress, error: job.error ?? null } : null;
  }
  async account(action, credentials, signal) {
    if (this.accountBusy) throw fault("ACCOUNT_BUSY", "账号正在切换");
    this.accountBusy = true;
    try {
      for (const job of this.jobs.values()) if (job.state === "running") job.controller.abort();
      for (const op of this.mutations.values()) op.controller.abort();
      await Promise.allSettled([...this.jobs.values()].map(j => j.done).concat([...this.mutations.values()].map(op => op.done)));
      if (action === "logout") {
        await this.classroom.logout();
        return { user: null };
      }
      if (typeof credentials?.username !== "string" || typeof credentials?.password !== "string" || credentials.username.length > 200 || credentials.password.length > 1e3) throw fault("INPUT", "账号信息无效");
      const result = await this.classroom.login({ username: credentials.username.trim(), password: credentials.password }, { signal });
      return { user: result.user };
    } finally {
      this.accountBusy = false;
    }
  }
  async start(courseId, subId, context) {
    await this.ready;
    const user = await this.user(), key = this.key(user, courseId, subId), existing = this.jobs.get(key);
    if (existing?.state === "running") return this.view(existing);
    if ([...this.jobs.values()].some((j) => j.state === "running")) throw fault("BUSY", "请先等待或取消当前解析");
    if (this.mutations.has(key)) throw fault("BUSY", "这一节已有加工任务");
    const controller = new AbortController();
    const job = { id: randomUUID(), courseId, subId, state: "running", progress: { phase: "source", done: 0, total: 0 }, controller, userId: user.id };
    this.jobs.set(key, job);
    job.done = (async () => {
      try {
        await this.mutate(key, controller.signal, async signal => {
        const result = await this.parser.parseClassroom(courseId, subId, { context: typeof context === "string" ? context.slice(0, 500) : `${courseId} · ${subId}`, signal, onProgress: (p) => job.progress = p });
        signal.throwIfAborted();
        const sourceVersion = finalVersion(result), previous = await this.result(key);
        // Equal transcript preserves its derived handout. A changed transcript
        // explicitly invalidates the handout and review; no stale final-pass text.
        const keep = previous?.sourceVersion === sourceVersion;
        await this.save(key, { ...result, sourceVersion, title: typeof context === "string" ? context : result.sourceId,
          lecture: keep ? previous.lecture ?? null : null, knowledgeTree: keep ? previous.knowledgeTree ?? null : null,
          lectureHistory: keep ? previous.lectureHistory ?? [] : [],
          quiz: keep ? previous.quiz ?? null : null });
        job.state = result.status === "ready" ? "ready" : "partial";
        });
      } catch (error) {
        job.state = controller.signal.aborted ? "cancelled" : "failed";
        job.error = publicError(error);
      }
    })();
    return this.view(job);
  }
  /**
   * 把一节**已经解析过**的产物装配成讲义，并落进同一份记录里。
   *
   * # 为什么讲义是「投影」，不原地改树
   *
   * 知识树是空间性的课程图谱（后续出题、复习、知识树视图都建在它上面），
   * 而讲义只是「这次课讲到了哪几块」的一次投影。所以这里每次都用
   * `buildTree` **重建**一棵树再交给装配器，而不是把上一版的树读回来改 ——
   * 原地改树等于把「这次有没有讲到」写回地图，App 侧已经写错过一次。
   */
  async assembleLecture(key, payload, signal) {
    return this.mutate(key, signal, async signal => {
      const lecture = this.lectureOf();
      if (!lecture?.assemble || !lecture?.buildTree) throw fault("NOT_WIRED", "讲义装配未接入");
      const stored = await this.result(key);
      if (!stored) throw fault("INPUT", "请先生成终稿");
      // App uses pageText for its knowledge tree, not visual description.
      const slides = stored.pages.filter(p => p.transcription?.pageText?.trim())
        .map(p => ({ page: p.page, text: p.transcription.pageText }));
      if (!slides.length && stored.pages.some(p => !p.transcription)) throw fault("SLIDE_READ_FAILED", "课件图片尚未成功解析");
      const selected = stored.blocks.filter(b => b.tag?.role === "主线");
      if (!selected.length) throw fault("NO_MAIN", "本节没有主线块");
      const excluded = stored.blocks.length - selected.length;
      const blocks = selected.map(b => ({ index: b.index, page: b.page,
        text: b.sentences.map(s => s.text).join(""), summary: b.tag?.summary ?? "", startMs: b.startMs ?? null }));
      const tree = lecture.buildTree({ slides, blocks, outline: stored.outline ?? [] });
      const title = typeof payload.context === "string" ? payload.context.slice(0, 500) : String(stored.title ?? stored.sourceId ?? "");
      const out = await lecture.assemble({ tree, blocks, context: title, signal });
      signal.throwIfAborted();
      if (!out.chapters.length) throw fault("NO_TOPICS", "没有可用讲义知识点");
      const generated = { schema: 1, title, chapters: out.chapters,
        warnings: [...(tree.warnings ?? []), ...(out.warnings ?? []), ...(excluded ? [`已排除 ${excluded} 个支线或未标注块；终稿保留全部内容。`] : [])],
        failures: out.failures, sourceVersion: stored.sourceVersion, revision: randomUUID(), review: null, at: new Date().toISOString() };
      await this.save(key, { ...stored, lectureHistory: [], knowledgeTree: { ...tree, sourceVersion: stored.sourceVersion }, lecture: generated });
      return generated;
    });
  }
  async finalPass(key, payload, signal) {
    return this.mutate(key, signal, async signal => {
      const pass = this.finalPassOf();
      if (!pass?.run) throw fault("NOT_WIRED", "讲义终审未接入");
      const stored = await this.result(key), lecture = stored?.lecture;
      if (!lecture?.chapters?.length) throw fault("INPUT", "请先生成讲义");
      // Use the account-scoped key, not caller-provided ids, for sandbox files.
      const sectionId = digest(key);
      const before = exportReorganization(lecture, sectionId, stored);
      const out = await pass.run({ text: before, sectionId, signal });
      signal.throwIfAborted();
      const merged = mergeReorganization(lecture, out.text, stored, sectionId);
      const reviewed = { ...merged.lecture, revision: randomUUID(), review: {
        schema: 2, sourceVersion: stored.sourceVersion, baseRevision: lecture.revision, coverage: merged.coverage,
        text: out.text, unchanged: out.unchanged, updatedTopics: merged.updated,
        childEvents: out.childEvents ?? null, at: new Date().toISOString(),
      } };
      // Parser pages, sentences, timestamps, roles and block indexes are untouched.
      await this.save(key, { ...stored, lectureHistory: [...(stored.lectureHistory ?? []), lecture].slice(-3), lecture: reviewed });
      return { lecture: reviewed, unchanged: out.unchanged };
    });
  }
  quizView(store, extra = {}) {
    const pub = (item) => ({
      id: item.id, type: item.type.code, stem: item.stem, answer: item.answer, status: item.status.code,
      blockIndex: item.blockIndex, page: item.page, atSec: item.atSec,
    });
    return {
      pending: store.pending.map(pub),
      queue: store.reviewQueue.map(pub),
      discarded: store.all.filter((item) => item.status.code === "rejected").length,
      problems: extra.problems ?? [],
      rejected: (extra.rejected ?? []).map((item) => ({ rule: item.rule ?? "", reason: String(item.reason ?? ""), blockIndex: item.blockIndex ?? null })),
      saved: extra.saved ?? 0,
      loadNotes: extra.loadNotes ?? [],
    };
  }
  openQuizStore(stored) {
    const store = createQuizStore();
    const loaded = store.loadItems(Array.isArray(stored?.quiz?.items) ? stored.quiz.items : []);
    if (Array.isArray(stored?.quiz?.attempts)) store.loadAttempts(stored.quiz.attempts);
    return { store, loaded };
  }
  quizTypes(raw) {
    const codes = raw == null ? ["cloze", "shortAnswer"] : raw;
    if (!Array.isArray(codes) || codes.length === 0 || codes.length > 4) throw fault("INPUT", "题型无效");
    return codes.map((code) => {
      const type = { cloze: QUIZ_TYPES.cloze, shortAnswer: QUIZ_TYPES.shortAnswer, mcq: QUIZ_TYPES.mcq, caseStudy: QUIZ_TYPES.caseStudy }[code];
      if (!type) throw fault("INPUT", "题型无效");
      return type;
    });
  }
  quizMaterials(stored, indexes) {
    if (!Array.isArray(indexes) || indexes.length === 0) throw fault("INPUT", "请先选择要出题的知识片段");
    return indexes.map((index) => {
      if (!Number.isInteger(index)) throw fault("INPUT", "知识片段编号无效");
      const block = stored.blocks.find((item) => item.index === index);
      if (!block) throw fault("INPUT", "选中的知识片段不在这节终稿里");
      return makeSourceMaterial({
        blockIndex: block.index, page: block.page ?? 0, atSec: Math.floor((block.startMs ?? 0) / 1000),
        summary: block.tag?.summary ?? null, facets: block.tag?.facets ?? [],
        text: (block.sentences ?? []).map((line) => line.text).join(""),
        selection: QUIZ_MATERIAL_SELECTIONS.userSelected,
      });
    });
  }
  async quizState(key) {
    const stored = await this.result(key);
    let opened;
    try { opened = this.openQuizStore(stored); }
    catch { throw fault("CORRUPT", "已有题目无法读取"); }
    return this.quizView(opened.store, { loadNotes: opened.loaded.notes ?? [] });
  }
  async generateQuiz(key, payload, signal) {
    const quiz = this.quizOf();
    if (typeof quiz?.generate !== "function") throw fault("NOT_WIRED", "出题未接入");
    return this.mutate(key, signal, async (signal) => {
      const stored = await this.result(key);
      if (!stored) throw fault("INPUT", "请先生成终稿");
      const materials = this.quizMaterials(stored, payload.blockIndexes);
      const maxCards = payload.maxCards == null ? null : payload.maxCards;
      if (maxCards !== null && (!Number.isInteger(maxCards) || maxCards < 1 || maxCards > 20)) throw fault("INPUT", "出题数量无效");
      let outcome;
      try {
        outcome = await quiz.generate({
          blocks: materials,
          context: {
            courseId: identity(key).courseId, sectionId: identity(key).subId,
            pageCount: Array.isArray(stored.pages) ? stored.pages.length : 0,
            sourceRevision: stored.sourceVersion ?? "", types: this.quizTypes(payload.types),
          },
          signal, maxCards,
        });
      } catch (error) {
        if (signal.aborted || error?.code === "CANCELLED") throw error;
        throw fault(error.code || "FAILED", error.message);
      }
      const { store, loaded } = this.openQuizStore(stored);
      const saved = outcome.admitted?.length ? store.saveGenerated(outcome.admitted) : { saved: 0, notes: [] };
      if (saved.saved > 0) await this.save(key, { ...stored, quiz: store.snapshot() });
      return this.quizView(store, {
        problems: outcome.problems ?? [], rejected: outcome.rejected ?? [], saved: saved.saved,
        loadNotes: [...(loaded.notes ?? []), ...(saved.notes ?? [])],
      });
    });
  }
  async changeQuiz(key, id, action, signal) {
    const quiz = this.quizOf();
    if (typeof quiz?.generate !== "function") throw fault("NOT_WIRED", "出题未接入");
    if (typeof id !== "string" || !id || id.length > 200) throw fault("INPUT", "题目编号无效");
    return this.mutate(key, signal, async () => {
      const stored = await this.result(key);
      if (!stored) throw fault("INPUT", "请先生成终稿");
      const { store } = this.openQuizStore(stored);
      try { store[action](id); }
      catch (error) { throw fault(error.code === "NOT_FOUND" ? "NOT_FOUND" : "INPUT", error.message); }
      await this.save(key, { ...stored, quiz: store.snapshot() });
      return this.quizView(store);
    });
  }
  noteIds(user, courseId, subId) {
    const accountId = String(user.id);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(accountId)) throw fault("INPUT", "账号标识不能写入笔记");
    return { courseId, sectionId: `${accountId}.${subId}` };
  }
  noteView(note) {
    return {
      courseId: note.courseId, sectionId: note.sectionId, title: note.title ?? "",
      markdown: note.markdown ?? "", updatedAt: note.updatedAt ?? null, hasContent: hasContent(note),
    };
  }
  notesService() {
    const notes = this.notesOf();
    if (typeof notes?.getOrEmpty !== "function" || typeof notes?.put !== "function") throw fault("NOT_WIRED", "节笔记未接入");
    return notes;
  }
  async readNote(user, courseId, subId) {
    const ids = this.noteIds(user, courseId, subId);
    try { return this.noteView(await this.notesService().getOrEmpty(ids)); }
    catch (error) { if (error.code === "NOT_WIRED" || error.code === "INPUT") throw error; throw fault(error.code || "FAILED", error.message); }
  }
  async saveNote(user, courseId, subId, payload) {
    const ids = this.noteIds(user, courseId, subId);
    if (typeof payload.markdown !== "string" || payload.markdown.length > 100000) throw fault("INPUT", "笔记正文无效");
    const title = payload.title == null ? undefined : payload.title;
    if (title !== undefined && (typeof title !== "string" || title.length > 200)) throw fault("INPUT", "笔记标题无效");
    try { return this.noteView(await this.notesService().put({ ...ids, markdown: payload.markdown, title })); }
    catch (error) {
      if (error.code === "NOT_WIRED" || error.code === "INPUT") throw error;
      throw fault(error.code === "PERSIST" ? "PERSIST" : (error.code || "FAILED"), error.message);
    }
  }
  linkText(user, payload) {
    const ids = this.noteIds(user, identifier(payload.courseId), identifier(payload.subId));
    try {
      if (payload.kind === "page") {
        if (!Number.isInteger(payload.page)) throw fault("INPUT", "页码无效");
        return { markdown: pageLink({ ...ids, page: payload.page }) };
      }
      if (payload.kind === "time") {
        if (typeof payload.atSec !== "number" || !Number.isFinite(payload.atSec)) throw fault("INPUT", "时间无效");
        return { markdown: timeLink({ ...ids, atSec: payload.atSec }) };
      }
    } catch (error) {
      if (error.code) throw error;
      throw fault("INPUT", error.message);
    }
    throw fault("INPUT", "链接类型无效");
  }
  /**
   * 直播数据源（`classroom.live`）的取用入口。
   *
   * ⚠️ 这里**必须**能优雅降级：`live` 是另一个任务接线进来的可选能力，宿主那边
   *    `zhiyunClassroom` 是服务实例，谁都不知道它有没有 `.live`（旧版本没有、
   *    接线失败没有、单测里的假 classroom 也没有）。缺了只让这三个 RPC 如实报
   *    「未接入」，绝不能让学习页的其他动作跟着挂 —— 直播与课程/解析/讲义是
   *    互不相交的几条通路，缺一条不该连坐。
   *
   * 报 `NOT_WIRED` 而不是 `FAILED`：前者在 `publicError` 里有一句「所需加工插件
   * 未启用」，是**配置**语义，用户不需要重试；后者会被当成一次性的网络抖动。
   */
  liveSource() {
    const live = this.classroom?.live;
    if (!live || typeof live.listCurrent !== "function" || typeof live.listLiveDay !== "function" || typeof live.resolveStreams !== "function") {
      throw fault("NOT_WIRED", "直播未接入");
    }
    return live;
  }
  // 列表原样返回 `{ items, meta }`：`meta` 里的 `complete` / `reason` 是「这天是不是
  // 收全了」的唯一依据（按时段分片请求，个别时段失败会标 `partial-quantum`），
  // 界面据此决定要不要提示「部分时段没读到」，工作台不该替它猜。
  async liveToday(signal) {
    return this.liveSource().listCurrent({ signal });
  }
  async liveDay(payload, signal) {
    const date = isoDay(payload.date);
    return this.liveSource().listLiveDay(date, { signal });
  }
  // 返回形状与 `live-day` 有意不同：`{ streams, dropped, source }` 是**一路课**的
  // 机位清单，不是列表页。改写只在这里做（见 `relayStream`），客户端拿到的
  // `playUrl` / `watchUrl` / `recordUrl` 全部指向本机转发端点。
  async liveStreams(payload, signal) {
    const courseId = identifier(payload.courseId), subId = identifier(payload.subId);
    const out = await this.liveSource().resolveStreams(courseId, subId, { signal });
    return {
      courseId, subId,
      streams: (Array.isArray(out?.streams) ? out.streams : []).map(relayStream),
      dropped: (Array.isArray(out?.dropped) ? out.dropped : []).map(relayDropped),
      source: out?.source ?? "live",
    };
  }
  async restoreLecture(key, signal) {
    return this.mutate(key, signal, async () => {
      const stored = await this.result(key), history = [...(stored?.lectureHistory ?? [])];
      const lecture = history.pop();
      if (!lecture || lecture.sourceVersion !== stored.sourceVersion) throw fault("INPUT", "没有可恢复的同版本讲义");
      await this.save(key, { ...stored, lecture, lectureHistory: history });
      return { lecture, historyCount: history.length };
    });
  }
  async dispatch(method, payload = {}, signal) {
    if (this.closed) throw fault("DISPOSED", "服务已关闭");
    await this.ready;
    signal?.throwIfAborted();
    if (method === "state") {
      const user2 = await this.classroom.getCurrentUser();
      return { user: user2, jobs: [...this.jobs.values()].filter((j) => j.state === "running" && j.userId === user2?.id).map((j) => this.view(j)) };
    }
    if (method === "login" || method === "logout") return this.account(method, payload, signal);
    if (method === "models") {
      const catalog = await Promise.all(this.llm.listProviders().map(async (p) => ({ id: p.id, name: p.name, models: await this.llm.listModels(p.id) })));
      return { catalog, routes: this.parser.llm.routes };
    }
    if (method === "models-save") {
      if (this.mutations.size) throw fault("BUSY", "加工完成后才能切换模型");
      const routes = this.cleanRoutes(payload.routes);
      for (const r of Object.values(routes)) await this.llm.resolveModelInfo(r.provider, r.model, signal);
      await this.atomic(path.join(this.directory, "models.json"), routes);
      this.parser.llm.routes = routes;
      return { routes };
    }
    const user = await this.user();
    if (method === "courses") return this.classroom.listCourses({ signal });
    // 直播三条**必须排在下面 `const courseId = identifier(payload.courseId)` 之前**：
    // 那句是给「每一条都要一门课」的节次级方法准备的，而 `live-today` / `live-day`
    // 根本不该带 courseId —— 排到后面会让一次「看今天有什么直播」被课程编号校验
    // 拦下来。三条都放在这里，顺序即契约。
    if (method === "live-today") return this.liveToday(signal);
    if (method === "live-day") return this.liveDay(payload, signal);
    if (method === "live-streams") return this.liveStreams(payload, signal);
    if (method === "schedule") return this.scheduleWindow(payload, signal);
    if (method === "recent") return this.recall(user);
    if (method === "recent-save") return this.remember(user, payload);
    if (method === "review") return this.knowledge.acceptedQuiz({ accountId: String(user.id) });
    if (method === "search") {
      if (typeof payload.query !== "string" || payload.query.length > 500) throw fault("INPUT", "检索词无效");
      return this.knowledge.search({ accountId: String(user.id), query: payload.query,
        ...(payload.courseId == null ? {} : { courseId: identifier(payload.courseId) }), layer: payload.layer ?? "final" });
    }
    if (method === "note-link") {
      if (typeof payload.href !== "string" || payload.href.length > 2000) throw fault("INPUT", "链接无效");
      return { target: parseZySectionUri(payload.href) };
    }
    const courseId = identifier(payload.courseId);
    if (method === "lessons") return this.classroom.listLessons(courseId, { onlyPlayable: false, signal });
    // 批量解析状态：界面展开一门课时要知道每个节次有没有已存产物，逐节
    // 发 `result` 等于 O(节数) 次往返（线性代数 31、大学写作 61）。这里
    // 一次问完整门课，宿主侧只是查本地存储。单个坏编号跳过即可，不该让
    // 一个陈旧 id 把整棵课程树打空。
    if (method === "results") {
      const subIds = Array.isArray(payload.subIds) ? payload.subIds.slice(0, 200) : [];
      const items = {};
      await Promise.all(subIds.map(async (raw) => {
        let id;
        try { id = identifier(raw); } catch { return; }
        const itemKey = this.key(user, courseId, id), stored = await this.result(itemKey);
        items[id] = { hasResult: Boolean(stored), resultStatus: stored?.status ?? null, job: this.view(this.jobs.get(itemKey)) };
      }));
      return { items };
    }
    const subId = identifier(payload.subId), key = this.key(user, courseId, subId);
    if (method === "content") return this.classroom.getLessonContent(courseId, subId, { signal });
    if (method === "result") {
      const stored = await this.result(key);
      return { result: payload.includeResult === false ? null : stored, hasResult: Boolean(stored), resultStatus: stored?.status ?? null, job: this.view(this.jobs.get(key)) };
    }
    if (method === "lecture") return this.assembleLecture(key, payload, signal);
    if (method === "final-pass") return this.finalPass(key, payload, signal);
    if (method === "lecture-restore") return this.restoreLecture(key, signal);
    if (method === "quiz") return this.quizState(key);
    if (method === "quiz-generate") return this.generateQuiz(key, payload, signal);
    if (method === "quiz-adopt") return this.changeQuiz(key, payload.id, "adopt", signal);
    if (method === "quiz-discard") return this.changeQuiz(key, payload.id, "discard", signal);
    if (method === "note") return this.readNote(user, courseId, subId);
    if (method === "note-save") return this.saveNote(user, courseId, subId, payload);
    if (method === "note-link-text") return this.linkText(user, payload);
    if (method === "start") return this.start(courseId, subId, payload.context);
    if (method === "cancel") {
      const job = this.jobs.get(key);
      if (job?.state === "running") {
        job.controller.abort();
        await job.done;
      }
      return this.view(job);
    }
    throw fault("INPUT", "未知操作");
  }
  async invoke(method, payload, signal) {
    const controller = new AbortController();
    this.controllers.add(controller);
    try {
      return await this.dispatch(method, payload, AbortSignal.any([controller.signal, ...signal ? [signal] : []]));
    } finally {
      this.controllers.delete(controller);
    }
  }
  async dispose() {
    this.closed = true;
    for (const c of this.controllers) c.abort();
    for (const job of this.jobs.values()) job.controller.abort();
    for (const op of this.mutations.values()) op.controller.abort();
    await Promise.allSettled([...this.jobs.values()].map(j => j.done).concat([...this.mutations.values()].map(op => op.done)));
  }
}
