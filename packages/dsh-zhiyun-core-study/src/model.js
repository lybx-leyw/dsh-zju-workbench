import { createQuestionBankController } from './question-bank-client.js';
﻿export function createStudyController(call, navigation) {
  let state = { loading: true, user: null, courses: [], lessons: [], course: null, lesson: null, content: null, result: null, job: null, activeJob: null, jobs: [], queueOpen: false, error: null, busy: false, sectionLoading: false, contentLoading: false, coursesMeta: null, lessonsMeta: null, lessonsByCourse: {}, lessonMetaByCourse: {}, lessonHiddenByCourse: {}, loadingCourses: {}, sectionStates: {}, expandedCourses: {}, lecture: null, lectureBusy: false, lecturePhase: null, polishBusy: false, quiz: null, quizBusy: false, note: null, noteBusy: false, noteWired: true, schedule: null, scheduleMeta: null, scheduleLoading: false, scheduleError: null, corpusHits: null, corpusQuery: "", corpusBusy: false, corpusError: null, recent: null, recentLoading: false, recentError: null, review: null, reviewTruncated: false, reviewLoading: false, reviewError: null, focusTab: null, live: null, liveBusy: false, liveError: null, liveStreams: null, liveToday: null, liveTodayLoading: false };
  const listeners = new Set(), lifetime = new AbortController();
  let closed = false, selection = 0, account = 0, timer = null, polling = false, scheduleTicket = 0, corpusTicket = 0, recentTicket = 0, reviewTicket = 0, liveTodayTicket = 0, liveStreamsTicket = 0;
  const lessonLoads = new Map();
  const update = (patch) => {
    if (closed) return;
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  };
  async function request(method, payload = {}) {
    return call(method, payload, lifetime.signal);
  }
  const questionBank = createQuestionBankController(request,{...navigation,openSource:async(question,point)=>{
    const course=state.courses.find(c=>String(c.id)===String(question.courseId))??{id:question.courseId,title:question.courseTitle};
    const loaded=await loadCourse(course);
    const lesson=(loaded?.items??[]).find(l=>String(l.subId)===String(question.subId))??{subId:question.subId,title:question.lessonTitle};
    await selectLesson(lesson,course);
    update({focusTab:{tab:'题目来源',courseId:String(course.id),subId:String(lesson.subId),chapterNo:point.chapterIndex+1,topicNo:point.topicIndex+1}});
    navigation?.navigate?.('study');
  }});
  const currentKey = () => state.lesson ? { courseId: state.course.id, subId: state.lesson.subId } : null;
  /**
   * 从「今天的直播列表」里挑出与某节课对应的一条，作为 `state.live`。
   *
   * 为什么 `live` 由本控制器**推导**而不是留给界面写：它和 `lesson` 是同一个
   * 选择的两个面（一节可回放的课，同时可能有正在进行的直播）。若让多个组件各自
   * 记住「这节有没有直播」，切节次时就会一半新一半旧。所以只留一个真源 ——
   * `liveToday`，`live` 永远从它按 courseId/subId 派生。
   *
   * 两种形状都收：`liveToday` 希望是完整的 `{ items, meta }`（`meta.complete`
   * 决定「今天到底收全了没有」，界面要据此决定提示语），但早期/测试里也可能
   * 直接给数组。缺 ID 时返回 null，而不是拿一节无关的课顶上。
   */
  const liveOf = (liveToday, courseId, subId) => {
    if (courseId == null || subId == null) return null;
    const list = Array.isArray(liveToday) ? liveToday : Array.isArray(liveToday?.items) ? liveToday.items : [];
    return list.find((item) => String(item?.courseId ?? "") === String(courseId) && String(item?.subId ?? "") === String(subId)) ?? null;
  };
  async function refresh() {
    questionBank.reset();
    const epoch = ++account;
    selection++;
    lessonLoads.clear();
    update({ loading: true, error: null, course: null, lesson: null, result: null, content: null, lessons: [], courses: [], job: null, activeJob: null, jobs: [], queueOpen: false, lessonsByCourse: {}, lessonMetaByCourse: {}, lessonHiddenByCourse: {}, loadingCourses: {}, sectionStates: {}, expandedCourses: {}, lecture: null, lectureBusy: false, lecturePhase: null, polishBusy: false, quiz: null, quizBusy: false, note: null, noteBusy: false, noteWired: true, busy: false, schedule: null, scheduleMeta: null, scheduleLoading: false, scheduleError: null, corpusHits: null, corpusQuery: "", corpusBusy: false, corpusError: null, recent: null, recentLoading: false, recentError: null, review: null, reviewTruncated: false, reviewLoading: false, reviewError: null, focusTab: null, live: null, liveBusy: false, liveError: null, liveStreams: null, liveToday: null, liveTodayLoading: false });
    try {
      const initial = await request("state");
      if (epoch !== account || closed) return;
      update({ user: initial.user, jobs: initial.jobs, activeJob: initial.jobs.find(j => j.state === 'running') ?? null });
      if (initial.jobs.length) schedule();
      if (initial.user) {
        const courses = await request("courses");
        if (epoch === account) update({ courses: courses.items, coursesMeta: courses.meta });
      }
    } catch (e) {
      if (epoch === account) update({ error: e.message, ...e.code === "SESSION_EXPIRED" ? { user: null } : {} });
    } finally {
      if (epoch === account) update({ loading: false });
    }
  }
  async function loadCourse(course, { force = false } = {}) {
    const id = String(course.id);
    if (!force && state.lessonsByCourse[id]) return { items: state.lessonsByCourse[id], meta: state.lessonMetaByCourse[id] };
    if (!force && lessonLoads.has(id)) return lessonLoads.get(id);
    const epoch = account;
    update({ loadingCourses: { ...state.loadingCourses, [id]: true } });
    const task = (async () => {
      try {
        const data = await request("lessons", { courseId: course.id });
        if (epoch !== account || closed) return { items: playableLessons(data.items), meta: data.meta };
        // 上游给的是**课程表上的全部槽位**，未开课、未发布的节次也在列表里。
        // 它们不可回放，也不可能有解析结果，所以在**写入口**就丢掉，与 App
        // 同口径（`ClassroomVideo.isPlayable` 即 `status === '6'`）。渲染路径
        // 因此不再需要过滤；隐藏数单独留一份，免得以后想看「另有 N 节不可
        // 回放」时无从可查。
        const items = playableLessons(data.items);
        update({ lessonsByCourse: { ...state.lessonsByCourse, [id]: items }, lessonMetaByCourse: { ...state.lessonMetaByCourse, [id]: data.meta }, lessonHiddenByCourse: { ...state.lessonHiddenByCourse, [id]: (data.items?.length ?? 0) - items.length }, ...(state.course?.id === course.id ? { lessons: items, lessonsMeta: data.meta } : {}) });
        // Load persisted parse/job state lazily for the expanded course.
        //
        // 合批成一次 RPC：一门课的可回放节次通常在十几个到几十个，逐节查询
        // 等于 O(节数) 次往返（线性代数 31 次、大学写作 61 次），而这里问的
        // 只是「有没有已存产物」，宿主侧查的是本地存储。
        const subIds = items.map((lesson) => lesson.subId).filter(Boolean).map(String);
        if (subIds.length) {
          try {
            const batch = await request("results", { courseId: course.id, subIds });
            if (epoch === account && !closed) {
              const states = { ...state.sectionStates };
              for (const [subId, status] of Object.entries(batch.items ?? {})) states[`${id}:${subId}`] = { parsed: Boolean(status.hasResult), resultStatus: status.resultStatus ?? null, job: status.job ?? null };
              update({ sectionStates: states });
            }
          } catch {
            // Keep source availability separate from parse status. The lesson
            // remains usable and its status can be retried on refresh.
          }
        }
        return { items, meta: data.meta };
      } catch (error) {
        if (epoch === account && !closed) update({ error: error.message });
        throw error;
      } finally {
        lessonLoads.delete(id);
        if (epoch === account && !closed) update({ loadingCourses: { ...state.loadingCourses, [id]: false } });
      }
    })();
    lessonLoads.set(id, task);
    return task;
  }
  async function selectCourse(course) {
    const ticket = ++selection;
    update({ course, lesson: null, lessons: [], content: null, result: null, job: null, error: null, sectionLoading: true, contentLoading: false, live: null, liveStreams: null, liveBusy: false, liveError: null, expandedCourses: { ...state.expandedCourses, [String(course.id)]: true } });
    try {
      const lessons = await loadCourse(course);
      if (ticket === selection) update({ lessons: lessons.items, lessonsMeta: lessons.meta });
    } catch (e) {
      if (ticket === selection) update({ error: e.message });
    } finally {
      if (ticket === selection) update({ sectionLoading: false });
    }
  }
  async function selectLesson(lesson, course = state.course) {
    if (!course) return;
    const ticket = ++selection, key = { courseId: course.id, subId: lesson.subId };
    // 切节次时把上一节的直播信息一起清干净：`live` 是按 courseId/subId 派生的，
    // 而刚点开的这一节还不知道有没有直播。清空之后 `loadLiveToday()` 会重新派生；
    // 留着旧值的话，界面会在新一节的标题下显示上一节的机位。
    update({ course, lesson, lessons: state.lessonsByCourse[String(course.id)] ?? state.lessons, lessonsMeta: state.lessonMetaByCourse[String(course.id)] ?? state.lessonsMeta, content: null, result: null, lecture: null, lectureBusy: false, lecturePhase: null, polishBusy: false, quiz: null, quizBusy: false, note: null, noteBusy: false, noteWired: true, busy: false, job: null, error: null, contentLoading: true, live: liveOf(state.liveToday, course.id, lesson.subId), liveStreams: null, liveBusy: false, liveError: null });
    const outcomes = await Promise.allSettled([request("content", key), request("result", key), request("quiz", key), request("note", key)]);
    if (ticket !== selection || closed) return;
    const [content, result, quiz, note] = outcomes;
    const parsed = result.status === "fulfilled" ? result.value.result : null;
    const job = result.status === "fulfilled" ? result.value.job : null;
    const sectionKey = `${course.id}:${lesson.subId}`;
    const noteWired = note.status === "fulfilled" || note.reason?.code !== "NOT_WIRED";
    const banner = [content, result, quiz, note].filter((item) => item.status === "rejected" && item.reason?.code !== "NOT_WIRED").map((item) => item.reason.message);
    update({ lecture: parsed?.lecture ?? null, content: content.status === "fulfilled" ? content.value : null, result: parsed, quiz: quiz.status === "fulfilled" ? quiz.value : null, note: note.status === "fulfilled" ? note.value : null, noteWired, job, sectionStates: { ...state.sectionStates, [sectionKey]: { parsed: Boolean(parsed), resultStatus: parsed?.status ?? null, job } }, contentLoading: false, error: banner.join("；") || null });
    if (result.status === "fulfilled" && result.value.job?.error) update({ error: result.value.job.error.message });
    if (result.status === "fulfilled" && result.value.job?.state === "running") {
      update({ activeJob: result.value.job });
      schedule();
    }
    try {
      const entry = await request("recent-save", { courseId: String(course.id), subId: String(lesson.subId), courseTitle: course.title ?? "", lessonTitle: lesson.title ?? "" });
      if (ticket === selection && !closed) update({ recent: entry });
    } catch { /* 记不住位置，不影响已经打开的这一节。 */ }
  }
  function schedule() {
    clearTimeout(timer);
    if (!closed) timer = setTimeout(poll, 800);
  }
  async function poll() {
    if (closed || polling) { if (!closed) schedule(); return; }
    polling = true;
    const epoch = account, ticket = selection;
    try {
      const data = await request('queue');
      if (epoch !== account || closed) return;
      const jobs = data.jobs ?? [], key = currentKey();
      const selectedJob = jobs.find(j => String(j.courseId) === String(key?.courseId) && String(j.subId) === String(key?.subId));
      const previous = state.jobs.find(j => j.id === selectedJob?.id);
      const sectionStates = { ...state.sectionStates };
      for (const job of jobs) {
        const sectionKey = job.courseId + ':' + job.subId;
        sectionStates[sectionKey] = { ...sectionStates[sectionKey], job, ...(['ready', 'partial'].includes(job.state) ? { parsed: true, resultStatus: job.state } : {}) };
      }
      update({ jobs, activeJob: jobs.find(j => j.state === 'running') ?? null, sectionStates,
        ...(selectedJob ? { job: selectedJob } : {}) });
      if (selectedJob && !['queued', 'running'].includes(selectedJob.state) && (previous?.state !== selectedJob.state || previous?.id !== selectedJob.id)) {
        const result = await request('result', key);
        if (epoch === account && ticket === selection && !closed) {
          update({ result: result.result ?? state.result, ...(result.result ? { lecture: result.result.lecture ?? null } : {}) });
        }
      }
      if (jobs.some(j => ['queued', 'running'].includes(j.state))) schedule();
    } catch (e) {
      if (epoch === account && !closed) { update({ error: e.message }); schedule(); }
    } finally { polling = false; }
  }

  return {
    questionBank,
    getSnapshot: () => state,
    subscribe: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    request,
    refresh,
    loadCourse,
    selectCourse,
    selectLesson,
    /**
     * 展开 / 收起某门课。展开状态放在控制器里，与 `course`/`lesson` 同寿命：
     * 组件自己的 `useState` 会随左侧导航切换而卸载丢失，于是切走再回来时
     * 右边还开着某节课、左边的树却全收起了，得重新点开。
     */
    toggleCourse(course) {
      const id = String(course.id), open = !state.expandedCourses[id];
      update({ expandedCourses: { ...state.expandedCourses, [id]: open } });
      if (open) void loadCourse(course).catch(() => {});
      return open;
    },
    navigate: (page) => navigation.navigate(page),
    /**
     * 打开壳的**账号面板**（登录 / 退出都在里面）。
     *
     * 登录入口有三个页面用得到，但那三页手上的 `controller` 是**本控制器**、
     * 不是壳的控制器 —— 所以壳的动作要顺着 `navigation` 这条路转发出来，
     * 和 `navigate` 完全一样的走法。`?.` 是防御：壳不在场时（`zhiyunNavigation`
     * 取不到）按一下不该抛异常。
     */
    openAccount: () => navigation.openAccount?.(),
    /**
     * 在当前账号已整理的终稿里做字面检索。空词不请求。
     * 失败留在 `corpusError`，不写进学习页横幅。
     */
    async searchCorpus(query) {
      const ticket = ++corpusTicket;
      const epoch = account;
      const text = typeof query === "string" ? query.trim() : "";
      if (!state.user || !text) {
        update({ corpusHits: null, corpusQuery: "", corpusBusy: false, corpusError: null });
        return;
      }
      update({ corpusBusy: true, corpusError: null, corpusQuery: text });
      try {
        const hits = await request("search", { query: text, layer: "final" });
        if (ticket !== corpusTicket || epoch !== account || closed) return;
        update({ corpusHits: Array.isArray(hits) ? hits : [] });
      } catch (e) {
        if (ticket !== corpusTicket || epoch !== account || closed) return;
        update({ corpusHits: null, corpusError: e.message });
      } finally {
        if (ticket === corpusTicket && epoch === account && !closed) update({ corpusBusy: false });
      }
    },
    async openCorpusHit(hit) {
      const course = state.courses.find((item) => String(item.id) === String(hit?.courseId));
      if (!course) {
        update({ corpusError: "这门课不在当前课程列表里。" });
        return false;
      }
      try {
        const loaded = await loadCourse(course);
        const lesson = (loaded?.items ?? []).find((item) => String(item.subId) === String(hit.subId));
        if (!lesson) {
          update({ corpusError: "这节不在可回放列表里。" });
          return false;
        }
        await selectLesson(lesson, course);
        return true;
      } catch (e) {
        update({ corpusError: e.message });
        return false;
      }
    },
    /**
     * 只读今天的课表。失败留在 `scheduleError`，不写进页面横幅用的 `error`，
     * 免得学习页把一次课表失败当成解析失败。
     */
    async loadSchedule() {
      const ticket = ++scheduleTicket;
      const epoch = account;
      if (!state.user) {
        update({ schedule: null, scheduleMeta: null, scheduleLoading: false, scheduleError: null });
        return;
      }
      update({ scheduleLoading: true, scheduleError: null });
      try {
        const data = await request("schedule");
        if (ticket !== scheduleTicket || epoch !== account || closed) return;
        update({ schedule: data.items ?? [], scheduleMeta: data.meta ?? null });
      } catch (e) {
        if (ticket !== scheduleTicket || epoch !== account || closed) return;
        update({ schedule: null, scheduleMeta: null, scheduleError: e.message });
      } finally {
        if (ticket === scheduleTicket && epoch === account && !closed) update({ scheduleLoading: false });
      }
    },
    /**
     * 读一段日期里的课表，只把结果交回去。
     *
     * 不写入 `state.schedule`：那一份是今天页用的「今天」。规划页要看截止日
     * 前后的课，若写进同一份状态，今天页会把别的日子画成今天的课。
     */
    async readScheduleWindow(start, end) {
      if (!state.user) return null;
      const data = await request("schedule", { start, end });
      return { items: data?.items ?? [], meta: data?.meta ?? null };
    },
    /**
     * 读「此刻正在上的直播」（`live-today`）。
     *
     * 与 `loadSchedule` 同一姿态：失败留在 `liveError`，不写进页面横幅的 `error`
     * —— 直播是**附加**信息，拉不到不该让学习页显示成「解析失败」。而且这个
     * 动作本身可能因为「直播未接入」（宿主那边 `classroom.live` 不存在）而失败，
     * 那是配置事实，不是当前这节课出了问题。
     *
     * 只写 `liveToday` 与 `live`，**不碰** `liveStreams`：取流是另一条独立动作
     * （用户点了某个机位才发），合在一起会让「刷新今天的直播」把正在播的地址
     * 清掉，播放器会莫名其妙断流。
     */
    async loadLiveToday() {
      const ticket = ++liveTodayTicket;
      const epoch = account;
      if (!state.user) {
        update({ liveToday: null, live: null, liveTodayLoading: false, liveError: null });
        return;
      }
      update({ liveTodayLoading: true, liveError: null });
      try {
        const data = await request("live-today");
        if (ticket !== liveTodayTicket || epoch !== account || closed) return;
        // 整个 `{ items, meta }` 一起留下（而不是只留 items）：`meta.complete` 是
        // 「今天是不是收全了」的唯一依据，界面要据此决定说「今天没有直播」还是
        // 「今天的直播没读全」。
        update({ liveToday: data ?? null, live: liveOf(data, state.course?.id, state.lesson?.subId) });
      } catch (e) {
        if (ticket !== liveTodayTicket || epoch !== account || closed) return;
        update({ liveToday: null, live: null, liveError: e.message });
      } finally {
        if (ticket === liveTodayTicket && epoch === account && !closed) update({ liveTodayLoading: false });
      }
    },
    /**
     * 取某节课的机位清单（`live-streams`）。
     *
     * 地址改写（换成 `/zhiyun-live/hls?u=…`）在**宿主侧**做，这里拿到的
     * `playUrl` 已经是能直接塞给 `<video>` 的本机地址 —— 客户端不该知道、也不
     * 该需要知道原始 CDN 域名与签名。
     *
     * 选中的 `courseId`/`subId` 记在 `liveStreams` 的返回值里（宿主会带上），
     * 这样界面能判断「手上这份清单还是不是当前这一节的」。失败**向上抛**：
     * 调用方（那个播放面板）需要在同一个地方收起 loading 并显示原因，吞掉只会
     * 让它停在「正在取流」。
     */
    async loadLiveStreams(courseId, subId) {
      const ticket = ++liveStreamsTicket;
      const epoch = account;
      if (courseId == null || subId == null) return null;
      update({ liveBusy: true, liveError: null });
      try {
        const data = await request("live-streams", { courseId: String(courseId), subId: String(subId) });
        if (ticket !== liveStreamsTicket || epoch !== account || closed) return data ?? null;
        update({ liveStreams: data ?? null });
        return data ?? null;
      } catch (e) {
        if (ticket === liveStreamsTicket && epoch === account && !closed) update({ liveStreams: null, liveError: e.message });
        throw e;
      } finally {
        if (ticket === liveStreamsTicket && epoch === account && !closed) update({ liveBusy: false });
      }
    },
    async loadRecent() {
      const ticket = ++recentTicket;
      const epoch = account;
      if (!state.user) {
        update({ recent: null, recentLoading: false, recentError: null });
        return;
      }
      update({ recentLoading: true, recentError: null });
      try {
        const recent = await request("recent");
        if (ticket !== recentTicket || epoch !== account || closed) return;
        update({ recent: recent ?? null });
      } catch (e) {
        if (ticket !== recentTicket || epoch !== account || closed) return;
        update({ recent: null, recentError: e.message });
      } finally {
        if (ticket === recentTicket && epoch === account && !closed) update({ recentLoading: false });
      }
    },
    async resumeRecent() {
      const recent = state.recent;
      if (!recent) return false;
      const course = state.courses.find((item) => String(item.id) === String(recent.courseId));
      if (!course) {
        update({ recentError: "这门课不在当前课程列表里。" });
        return false;
      }
      try {
        const loaded = await loadCourse(course);
        const lesson = (loaded?.items ?? []).find((item) => String(item.subId) === String(recent.subId));
        if (!lesson) {
          update({ recentError: "这节不在可回放列表里。" });
          return false;
        }
        await selectLesson(lesson, course);
        return true;
      } catch (e) {
        update({ recentError: e.message });
        return false;
      }
    },
    async loadReview() {
      const ticket = ++reviewTicket;
      const epoch = account;
      if (!state.user) {
        update({ review: null, reviewTruncated: false, reviewLoading: false, reviewError: null });
        return;
      }
      update({ reviewLoading: true, reviewError: null });
      try {
        const data = await request("review");
        if (ticket !== reviewTicket || epoch !== account || closed) return;
        update({ review: data.items ?? [], reviewTruncated: Boolean(data.truncated) });
      } catch (e) {
        if (ticket !== reviewTicket || epoch !== account || closed) return;
        update({ review: null, reviewTruncated: false, reviewError: e.message });
      } finally {
        if (ticket === reviewTicket && epoch === account && !closed) update({ reviewLoading: false });
      }
    },
    async openReview(item) {
      if (!item) return false;
      const course = state.courses.find((row) => String(row.id) === String(item.courseId));
      if (!course) {
        update({ reviewError: "这门课不在当前课程列表里。" });
        return false;
      }
      try {
        const loaded = await loadCourse(course);
        const lesson = (loaded?.items ?? []).find((row) => String(row.subId) === String(item.subId));
        if (!lesson) {
          update({ reviewError: "这节不在可回放列表里。" });
          return false;
        }
        await selectLesson(lesson, course);
        update({ focusTab: { tab: "出题", courseId: String(course.id), subId: String(lesson.subId) }, reviewError: null });
        return true;
      } catch (e) {
        update({ reviewError: e.message });
        return false;
      }
    },
    async authenticate(credentials) {
      update({ busy: true, error: null });
      try {
        await request("login", credentials);
        await refresh();
      } catch (e) {
        update({ error: e.message });
      } finally {
        update({ busy: false });
      }
    },
    async logout() {
      update({ busy: true, error: null });
      try {
        await request("logout");
        clearTimeout(timer);
        await refresh();
      } catch (e) {
        update({ error: e.message });
      } finally {
        update({ busy: false });
      }
    },
    async start() {
      const key = currentKey();
      if (!key) return;
      const epoch = account;
      update({ busy: true, error: null });
      try {
        const job = await request("start", { ...key, context: `${key.courseId}-${key.subId}`, courseTitle: state.course?.title, lessonTitle: state.lesson?.title });
        if (epoch === account) {
          const selected = key.courseId === state.course?.id && key.subId === state.lesson?.subId;
          update({ ...(selected ? { job } : {}), queueOpen: true, activeJob: job.state === 'running' ? job : state.activeJob, jobs: [...state.jobs.filter(row => row.id !== job.id && !(row.courseId === job.courseId && row.subId === job.subId)), job] });
          const sectionKey = `${key.courseId}:${key.subId}`;
          update({ sectionStates: { ...state.sectionStates, [sectionKey]: { ...state.sectionStates[sectionKey], ...(selected ? { parsed: Boolean(state.result), resultStatus: state.result?.status ?? null } : {}), job } } });
          schedule();
        }
      } catch (e) {
        update({ error: e.message });
      } finally {
        update({ busy: false });
      }
    },
    setQueueOpen(open) { update({ queueOpen: open }); },
    async openTask(job) {
      const course = state.courses.find(row => String(row.id) === String(job.courseId));
      if (!course) return;
      try {
        const loaded = await loadCourse(course);
        const lesson = loaded?.items?.find(row => String(row.subId) === String(job.subId));
        if (lesson) { await selectLesson(lesson, course); navigation?.navigate?.("study"); update({ queueOpen: false }); }
      } catch (e) { update({ error: e.message }); }
    },
    async cancel(job = state.activeJob) {
      if (!job) return;
      update({ busy: true });
      try {
        await request("cancel", { courseId: job.courseId, subId: job.subId });
        await poll();
      } catch (e) {
        update({ error: e.message });
      } finally {
        update({ busy: false });
      }
    },
    /**
     * 讲义终稿 → AI 课件。
     *
     * 必须带上 `courseId` / `subId`：宿主侧 `dispatch` 第一行就是
     * `identifier(payload.subId)`，缺了会直接报「课程或节次编号无效」。
     * `quiz-generate` 用的是同一个模式（`{ ...key, ...input }`）。
     *
     * 与 quiz 的区别：这里**不吞异常** —— 生成失败要让调用方（AI 教学栏）
     * 拿到真实原因并显示出来，而不是变成 `state.error` 里一条泛泛的提示。
     */
    async generateTeaching(input = {}) {
      const key = currentKey();
      if (!key) throw new Error('请先选择一节课');
      const ticket = selection;
      try {
        const result = await request("teach-generate", { ...key, ...input });
        if (ticket !== selection) return null;
        return result;
      } catch (e) {
        if (ticket !== selection) return null;
        throw e;
      }
    },

    /** 查一次备课进度（配合 generateTeaching 的两段式）。 */
    async pollTeaching(runId) {
      return request("teach-poll", { runId });
    },
    async generateQuiz(input) {
      const key = currentKey(); if (!key) return;
      const ticket = selection, epoch = account;
      update({ quizBusy: true, error: null });
      try {
        const quiz = await request("quiz-generate", { ...key, ...input });
        if (ticket === selection && epoch === account) update({ quiz });
      } catch (e) { if (ticket === selection && epoch === account) update({ error: e.message }); }
      finally { if (ticket === selection && epoch === account) update({ quizBusy: false }); }
    },
    async adoptQuiz(id) { return this.changeQuiz("quiz-adopt", id); },
    async discardQuiz(id) { return this.changeQuiz("quiz-discard", id); },
    async changeQuiz(method, id) {
      const key = currentKey(); if (!key) return;
      const ticket = selection, epoch = account;
      update({ quizBusy: true, error: null });
      try {
        const quiz = await request(method, { ...key, id });
        if (ticket === selection && epoch === account) update({ quiz });
      } catch (e) { if (ticket === selection && epoch === account) update({ error: e.message }); }
      finally { if (ticket === selection && epoch === account) update({ quizBusy: false }); }
    },
    async saveNote(markdown) {
      const key = currentKey(); if (!key) return;
      const ticket = selection, epoch = account;
      update({ noteBusy: true, error: null });
      try {
        const note = await request("note-save", { ...key, markdown, title: state.lesson?.title });
        if (ticket === selection && epoch === account) update({ note, noteWired: true });
        return note;
      } catch (e) {
        if (ticket === selection && epoch === account) update({ error: e.message, ...(e.code === "NOT_WIRED" ? { noteWired: false } : {}) });
        return null;
      } finally { if (ticket === selection && epoch === account) update({ noteBusy: false }); }
    },
    dispose() {
      questionBank.dispose();
      closed = true;
      selection++;
      account++;
      clearTimeout(timer);
      lifetime.abort();
      listeners.clear();
    }
  };
}
export const time = (ms) => {
  const seconds = Math.floor(ms / 1e3);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
/**
 * 节次可回放判定 —— 与 App 同口径（`ClassroomVideo.isPlayable`，即
 * `status === '6'`）。
 *
 * 上游给的是**课程表上的全部槽位**：尚未开课、尚未发布的节次也在列表里。
 * App 拉全量后在 UI 层丢掉它们（`study_section_list.dart:482`，收藏空态
 * 「这门课还没有可回放的节」），这里保持一致。
 *
 * 缺字段时按可回放处理：判定权在上游，客户端不该因为字段缺失而藏掉课程。
 */
export const playableLessons = (items = []) => items.filter((lesson) => lesson?.isPlayable !== false);

// 检索不再放在控制器里：档位、2×11 维与层范围都是**纯函数**的输入，
// 由 `layers.js`（层/档位注册表）与 `layered-search.js`（检索引擎）承担，
// 视图自己持有那几个 useState。控制器只管数据与任务。


export function lessonWhen(value) {
  if (value == null || value === '') return '课堂学习';
  const raw = String(value).trim();
  const n = /^\d{10,13}$/.test(raw) ? Number(raw) : null;
  const date = new Date(n === null ? raw : n < 1e12 ? n * 1000 : n);
  return Number.isNaN(date.getTime()) ? raw : new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date);
}
