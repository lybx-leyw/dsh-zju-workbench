// 「今天」页：读今天的课表。日历和自建计划仍不在这里。
import React, { useEffect } from 'react';
import { Icon, Notice, SectionTitle, mountStyle, useStudy } from 'dsh-zhiyun-ui-primitives';
import { clock, projectAgenda } from './agenda.js';
import css from './style.css';

export const name = 'zhiyun-page-today-client';
export const inject = ['slots'];
export function apply(ctx) {
  mountStyle(ctx, { attribute: 'zhiyunTodayStyle', css, label: 'zhiyun: today page styles' });
  // 惰性取学习控制器：停用领域包时这一页不注册，外壳显示占位，不把整个前端拖成 pending。
  ctx.inject(['zhiyunStudyController'], (scope) => {
    scope.slots.inject('zhiyun.today.content', () => scope.slots.register(
      { name: 'zhiyun.today.content', priority: 10 },
      () => <Today controller={scope.zhiyunStudyController} />,
    ));
  });
}

function place(entry) {
  return [entry.roomName, entry.teacherName].filter(Boolean).join(' · ');
}

function Row({ entry, onOpen }) {
  const where = place(entry);
  return <button className="zt-row" type="button" onClick={() => onOpen(entry)}>
    <span className="zt-time">{clock(entry.startAt)}–{clock(entry.endAt)}</span>
    <span><strong>{entry.courseTitle || '未命名课程'}</strong>{where ? <p>{where}</p> : null}</span>
  </button>;
}

export function Today({ controller }) {
  const s = useStudy(controller);
  useEffect(() => {
    if (!s.loading && s.user) void controller.loadSchedule();
  }, [controller, s.loading, s.user]);
  const agenda = projectAgenda(s.schedule, s.scheduleMeta, Date.now());
  const openCourse = (entry) => {
    const course = s.courses.find((item) => String(item.id) === String(entry.courseId));
    if (course) {
      void controller.selectCourse(course);
      controller.navigate('study');
      return;
    }
    controller.navigate('courses');
  };
  const lead = !s.user ? null : s.scheduleLoading && !s.schedule ? null : s.scheduleError ? null : agenda.current ?? agenda.upcoming[0] ?? null;

  return <>
    <div className="zy-intro"><div><span className="zy-eyebrow">一点一滴，学有所获</span><h1>今天，从容开始。</h1><p>看看接下来的安排，留一点时间给自己。</p></div><span className="zy-date-icon"><Icon name="sun" size={42}/></span></div>
    <SectionTitle>今天的安排</SectionTitle>
    {!s.user ? <section className="zy-now"><span className="zy-pill"><span/>今天</span><h2>先连接课堂</h2><p>登录之后，这里只显示今天的课。日历和自建计划还没有做。</p><button className="zy-text-button" onClick={() => controller.navigate('me')}>前往个人面板登录 <Icon name="arrow" size={16}/></button></section> : <>
      {s.scheduleError ? <Notice>{s.scheduleError}</Notice> : null}
      {s.loading || (s.scheduleLoading && !s.schedule) ? <section className="zy-now"><span className="zy-pill"><span/>今天</span><h2>正在读取课表</h2><p>还不能判断今天有没有课。</p></section> : s.scheduleError ? <section className="zy-now"><span className="zy-pill"><span/>今天</span><h2>课表没有读出来</h2><p>这次失败不代表今天没有课。</p><button className="zy-text-button" onClick={() => controller.loadSchedule()}>再读一次 <Icon name="arrow" size={16}/></button></section> : agenda.kind === 'incomplete' ? <section className="zy-now"><span className="zy-pill"><span/>今天</span><h2>课表还没有收全</h2><p>先不把它画成今天的全部安排。</p><button className="zy-text-button" onClick={() => controller.loadSchedule()}>重新读取 <Icon name="arrow" size={16}/></button></section> : lead ? <section className="zy-now"><span className="zy-pill"><span/>{agenda.current ? '现在' : '下一节'}</span><h2>{lead.courseTitle || '未命名课程'}</h2><p>{clock(lead.startAt)}–{clock(lead.endAt)}{place(lead) ? ` · ${place(lead)}` : ''}</p><button className="zy-text-button" onClick={() => openCourse(lead)}>去这门课 <Icon name="arrow" size={16}/></button></section> : <section className="zy-now"><span className="zy-pill"><span/>今天</span><h2>{agenda.kind === 'empty' ? '今天没有课' : '今天的课已经上完'}</h2><p>{agenda.kind === 'empty' ? '课表已经确认，今天没有固定时间的课。' : '下面不再有还没开始的课。'}</p></section>}
    </>}
    <div className="zy-agenda-grid">
      <section><SectionTitle aside="按时间先后">今天的课</SectionTitle>{!s.user || s.scheduleError || agenda.kind === 'incomplete' || s.scheduleLoading && !s.schedule ? <div className="zy-empty-row"><Icon name="calendar"/><div><strong>固定时间的安排</strong><p>{!s.user ? '登录后显示今天的课' : '课表确认之后才会列在这里'}</p></div></div> : agenda.entries.length ? <div className="zt-list">{agenda.entries.map((entry) => <Row key={`${entry.day}:${entry.sourceId ?? entry.subId}:${entry.startMs}`} entry={entry} onOpen={openCourse}/>)}</div> : <div className="zy-empty-row"><Icon name="calendar"/><div><strong>今天没有固定时间的课</strong><p>课表已经确认，这一天是空的</p></div></div>}</section>
      <section><SectionTitle aside="按空闲时间处理">插空完成</SectionTitle><div className="zy-empty-row"><Icon name="check"/><div><strong>留给空档的小任务</strong><p>自建计划还没有接入</p></div></div></section>
    </div>
    <SectionTitle aside="接着上次的进度">最近在看</SectionTitle>
    <div className="zy-resume"><span className="zy-book-cover"><Icon name="book" size={26}/></span><div><h3>下一次打开，从上次继续</h3><p>最近学到哪一节，还没有接到这一页。</p></div><button className="zy-secondary" onClick={() => controller.navigate('courses')}>我的课 <Icon name="arrow" size={15}/></button></div>
    <div className="zy-quiet-footer">不必一次学完所有，今天也可以只前进一步。</div>
  </>;
}
