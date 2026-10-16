// 「我的课」页：课程列表 → 展开看到节次 → 进看课页。
//
// # 这一页的职责（对齐原始设计）
//
// 参照实现的「我的课」是**两层**：
//   `courses_page.dart`（235 行）  只列**有可播放节次**的课，点开就地展开节次
//   `course_detail_page.dart`（93 行）  某门课的节次列表 + 每节下载入口
//
// 本仓曾是**一层网格 + 跳「学习」页** —— 包内 README 自己写明那是「权宜之计」。
// 现在改成与原始设计一致的形状：**点课程就地展开节次，点节次进看课**。
//
// # 为什么不再跳「学习」页
//
// 「学习」是**知识的整理与复习**（讲义、终稿、出题、笔记），
// 「我的课」是**回到课堂**（哪一节没看完、进去接着看）。两者动线不同：
// 把「看课」塞进「学习」会让「我想接着上次看」多点一次跳转、还丢掉节次上下文。
//
// # 只列有可播放节次的课
//
// 与原始设计一致：课程列表先把**没有录播的课**滤掉，而不是列出来再让用户点空。
// 一门课全部节次都不可播放时它不出现在列表里 —— 那是「暂时没有可播放的课程」，
// 是一句话，不是一屏空卡片。
import React, { useState } from 'react';
import { Notice, mountStyle, useStudy } from 'dsh-zhiyun-ui-primitives';
import css from './style.css';

export const name = 'zhiyun-page-courses-client';
export const inject = ['slots'];
export function apply(ctx) {
  // 样式随本包生命周期装卸。
  mountStyle(ctx, { attribute: 'zhiyunCoursesStyle', css, label: 'zhiyun: courses page styles' });
  // 惰性取数据服务：停用领域状态包时这一页只是空着（壳显示占位），不会像硬 inject
  // 那样把整个前端拖成 pending（`web boot: N entries did not activate`）。
  ctx.inject(['zhiyunStudyController'], (scope) => {
    // priority 10：外部扩展（如测试提供方）用 0 就能遮蔽这一页。
    scope.slots.inject('zhiyun.courses.content', () => scope.slots.register(
      { name: 'zhiyun.courses.content', priority: 10 },
      () => <Courses controller={scope.zhiyunStudyController} />,
    ));
  });
}

export function SignIn({ controller }) {
  return <div className="zs-empty"><span className="zs-empty-title">连接你的课堂</span><p>登录浙大账号，把课程、课件和课堂字幕带到学习空间。</p><button className="zs-primary" onClick={() => controller.openAccount()}>登录智云课堂</button></div>;
}

/**
 * 节次列表里的条目数（**课程列表上那个「N 节可看」用的**）。
 *
 * ⚠️ 数据层在**写入口**就已经丢掉了不可回放的节次
 * （`study-core/src/model.js` 的 `playableLessons(data.items)`，与 App 的
 * `ClassroomVideo.isPlayable` 同口径），所以这里**不再过滤一遍** ——
 * 多一层 `videoUrl` 判断看起来更安全，实际是在第二处表达同一个规则：
 * 哪天口径变了（比如允许音频回放），改一处漏一处。
 *
 * 返回 `null` 表示**这门课的节次还没读过**（懒加载）—— 与"读过了但是 0 节"
 * 是两件事：前者显示「查看节次」，后者显示「暂无回放」。
 */
function loadedLessonCount(s, courseId) {
  const list = s.lessonsByCourse?.[String(courseId)];
  return Array.isArray(list) ? list.length : null;
}

/** 节次的日期标签（用起课时间，取不到就不显示而不是编一个）。 */
function dateLabel(lesson) {
  const raw = lesson?.startAt;
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' }).format(date);
}

/**
 * 这门课在列表上该显示什么。
 *
 * 三态，且**不撒谎**：
 *   - 还没读过节次（懒加载）→ 「查看节次」
 *   - 读过了、有 N 节 → 「N 节可看」
 *   - 读过了、0 节 → 「暂无回放」
 *
 * 为什么不做成"进列表时把 30 门课的节次全拉一遍"（参照实现是那么做的）：
 * 那是 30 个并发请求，而用户往往只看其中一两门。本仓用懒加载，
 * 代价是列表上第一眼看不到节数 —— 用「查看节次」如实表达这个过程，
 * 比开屏等 30 个请求更可取。这是与参照实现**有意的差异**。
 */
function courseBadge(s, courseId) {
  const count = loadedLessonCount(s, courseId);
  if (count === null) return '查看节次';
  return count > 0 ? `${count} 节可看` : '暂无回放';
}

/**
 * 一门课：一行摘要 + 点开后的节次列表。
 *
 * 展开状态走控制器的 `expandedCourses`（不是组件自己的 `useState`）——
 * 组件 state 会随页面切换卸载丢失，于是切走再回来时右边还开着某节课、
 * 左边的树却全收起了，得重新点开。这条是控制器注释里写明的理由。
 */
function CourseNode({ course, controller, s }) {
  const open = s.expandedCourses?.[String(course.id)] === true;
  const lessons = s.lessonsByCourse?.[String(course.id)] ?? [];
  const loading = s.loadingCourses?.[String(course.id)] === true;
  const loaded = loadedLessonCount(s, course.id) !== null;

  return <section className={`zs-myc-node${open ? ' is-open' : ''}`}>
    <button className="zs-myc-head" aria-expanded={open} onClick={() => controller.toggleCourse(course)}>
      <span className="zs-myc-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
      <span className="zs-myc-main">
        <span className="zs-course-code">{course.termName ?? '智云课堂'}</span>
        <strong>{course.title}</strong>
        <small>{course.teacher ?? '教师信息未提供'}</small>
      </span>
      <span className="zs-myc-count">{courseBadge(s, course.id)}</span>
    </button>
    {open && <div className="zs-myc-lessons">
      {loading && <p className="zs-muted">正在读取节次…</p>}
      {/* 只有「读过了且真的是 0 节」才说没有 —— 加载中不说，否则一闪而过的
          「这门课还没有节次」会骗人。 */}
      {!loading && loaded && lessons.length === 0
        && <p className="zs-muted">这门课暂时没有可回放的节次。</p>}
      {lessons.map((lesson) => <button
        key={lesson.subId ?? lesson.id}
        className="zs-myc-lesson"
        onClick={() => {
          // ⚠️ 必须**先** selectCourse 再 selectLesson。
          //
          // `selectLesson(lesson, course = state.course)` 在 `state.course` 为空时
          // **直接 return**（控制器源码第一行），也就是说：只展开课程而不选它，
          // 点节次会**静默什么都不做** —— 页面跳过去了，但 `state.lesson` 仍是 null，
          // 看课页只好显示「还没有选择要看的节次」。这个坑实测踩到过。
          controller.selectCourse(course);
          controller.selectLesson(lesson);
          controller.navigate('player');
        }}
      >
        <span className="zs-myc-lesson-main">
          <strong>{lesson.title ?? '未命名节次'}</strong>
          <small>{[dateLabel(lesson), lesson.lecturerName].filter(Boolean).join(' · ') || '时间未提供'}</small>
        </span>
        <span className="zs-myc-lesson-go" aria-hidden="true">▷ 看课</span>
      </button>)}
    </div>}
  </section>;
}

export function Courses({ controller }) {
  const s = useStudy(controller), [query, setQuery] = useState("");
  const q = query.trim();
  // 搜索匹配课程名或教师名（与原始设计一致）。
  const visible = s.courses.filter((c) => !q || `${c.title} ${c.teacher ?? ''}`.includes(q));

  return <section className="zs-courses">
    <header className="zs-heading">
      <div><small>课程 · 回放 · 资料</small><h1>我的课</h1><p>点开一门课，接着上次的地方看。</p></div>
      <button className="zs-button" disabled={s.loading || s.busy} onClick={() => controller.refresh()}>刷新课程</button>
    </header>
    <Notice>{s.error}</Notice>
    {s.loading
      ? <p className="zs-muted">正在读取课程…</p>
      : !s.user
        ? <SignIn controller={controller} />
        : <>
          <label className="zs-search">查找课程<input type="search" placeholder="课程名称、教师" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
          {s.coursesMeta?.complete !== true && <Notice>课程列表尚未确认收全，可刷新重试。</Notice>}
          {visible.length === 0
            ? <p className="zs-muted">{q ? `没有匹配「${q}」的课程。` : '这个账号暂时没有课程。'}</p>
            : <div className="zs-myc-list">{visible.map((c) => <CourseNode key={c.id} course={c} controller={controller} s={s} />)}</div>}
        </>}
  </section>;
}
