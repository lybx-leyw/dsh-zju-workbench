/**
 * 右栏：知识点轨道（替代原来的字幕列表）。
 *
 * # 为什么换掉字幕
 *
 * 字幕已经**烧在画面底部**了（`burnLine`）。右下角再放一份完整列表，是同一份
 * 信息的第二个副本，而且用户在画面里就能读到当前那句 —— 同一块屏幕上的
 * 两处显示同一件事，其中一处必然浪费。
 *
 * 而"现在讲到哪、接下来是哪"这个问题，原字幕列表回答不了：它只有时间顺序，
 * 没有层级（不知道哪几句属于同一个知识点）。
 *
 * # 为什么是纵向轨道而不是力导向图
 *
 * 仓库里有 `dsh-zhiyun-graph-render`（cytoscape 力导向），但它服务的是
 * 「笔记之间的关联发现」。播放器要回答的是**有序序列**问题：
 * 我在哪、下一个是什么、点一下跳过去。
 *
 * 力导向图会把顺序打乱，而顺序恰恰是这里最重要的信息（视频只有一条时间线）。
 * 右栏约 300px 宽，力导向图在这个尺寸下也只会缩成一团。
 *
 * 所以用**纵向轨道**：按时间从上往下，当前高亮，上下各留几步，
 * 折叠处显示「还有 N 个」。
 */
import React from 'react';
import { buildTrack, currentState, seekTargetMs, stateLabel, trackNote } from './topic-track.js';
import { resolveBrowse, stepChapter } from './topic-browse.js';

/**
 * 毫秒 → `mm:ss`（超过一小时给 `h:mm:ss`）。
 *
 * 与 `video-panel.jsx` 的 `time()` 是同一份逻辑。三处各写一遍看着冗余，
 * 但它们分处两个文件、都是 6 行 —— 抽公共模块要新建文件 + 改三处 import，
 * 收益不如各自保留。**改的时候三处一起改**。
 */
function time(ms) {
  const total = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60) % 60;
  const h = Math.floor(total / 3600);
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/**
 * @param ranges - `buildTopicRanges()` 的 `ranges`（按时间升序）。
 * @param atMs - 当前播放时刻。
 * @param onJump - 点节点时跳转（毫秒）。
 * @param browseChapterNo - 用户手动选的章序号；`null` 表示跟随视频。
 * @param onBrowseChapter - 切换章（传 `null` 恢复跟随）。
 */
export function TopicTrack({ ranges, atMs, onJump, browseChapterNo = null, onBrowseChapter }) {
  const track = buildTrack(ranges, atMs);
  const phase = currentState(ranges, atMs);
  const note = trackNote(phase);
  /**
   * 浏览态：用户可能翻到别的章看，那时**不被视频拽回**。
   *
   * 与课件同一套三态思路（见 `video-panel.jsx` 的 `pinnedIndex`）：
   * 翻回来就恢复跟随，`following` 为假时才显示「回到当前」。
   */
  const browse = resolveBrowse(ranges, atMs, browseChapterNo);
  const currentChapterIndex = browse.chapters.findIndex((c) => c.chapterNo === browse.activeChapterNo);
  const prevChapter = stepChapter(browse.chapters, browse.activeChapterNo, -1);
  const nextChapter = stepChapter(browse.chapters, browse.activeChapterNo, 1);

  // 没有任何知识点：说清楚是"没生成讲义"，而不是"这里没东西"。
  if (track.total === 0) {
    return <aside className="zs-topic-track" aria-label="知识点">
      <div className="zs-topic-track-head">
        <span>知识点</span>
      </div>
      <p className="zs-topic-track-empty">
        这节课还没有知识点结构。生成讲义后，这里会显示知识点路径。
      </p>
    </aside>;
  }

  return <aside className="zs-topic-track" aria-label="知识点">
    <div className="zs-topic-track-head">
      <span>知识点</span>
      <small>{track.currentIndex + 1} / {track.total}</small>
      {/* 「回到当前」：只有**真的脱离**视频时才出现。
          用户翻回当前章时 `following` 为真，按钮自动消失。 */}
      {!browse.following && <button
        type="button"
        className="zs-topic-follow"
        onClick={() => onBrowseChapter?.(null)}
        title="回到视频正在讲的知识点"
      >回到当前</button>}
    </div>

    {/* 章节切换条：只在**多于一章**且章有标题时出现。
        单章的课（没做整节梳理）给它只会多两个灰按钮。 */}
    {browse.chapters.length > 1 && browse.chapters.some((c) => c.chapterTitle) && <div className="zs-topic-chapters">
      <button
        type="button"
        className="zs-topic-chapter-step"
        aria-label="上一章"
        disabled={prevChapter === null}
        onClick={() => onBrowseChapter?.(prevChapter)}
      >‹</button>
      <span className="zs-topic-chapter-name" title={browse.chapters[currentChapterIndex]?.chapterTitle}>
        <span className="zs-topic-chapter-no">{currentChapterIndex + 1}/{browse.chapters.length}</span>
        {' '}
        {browse.chapters[currentChapterIndex]?.chapterTitle || '（未命名章）'}
      </span>
      <button
        type="button"
        className="zs-topic-chapter-step"
        aria-label="下一章"
        disabled={nextChapter === null}
        onClick={() => onBrowseChapter?.(nextChapter)}
      >›</button>
    </div>}

    {/* 空档/首尾的说明。只在需要澄清时出现 —— 常态（inside）下不占位置。 */}
    {note && <p className="zs-topic-track-note">{note}</p>}

    <div className="zs-topic-track-body">
      {browse.items.length === 0 && <p className="zs-topic-track-empty">这一章没有已定位的知识点。</p>}

      {browse.items.map((item) => {
        const target = seekTargetMs(item);
        /* 状态色只在**跟随态**下画：浏览态里用户可能正看第三章而视频在第一章，
           那时给节点标"已讲/接下来"会让他以为视频已经讲到那里了。 */
        const isLive = browse.following && item.index === track.currentIndex;
        const nodeState = browse.following
          ? (item.index === track.currentIndex ? 'current' : item.index < track.currentIndex ? 'past' : 'next')
          : undefined;
        return <button
          key={`${item.index}-${item.fromMs}`}
          type="button"
          className="zs-topic-node"
          data-state={nodeState}
          data-inview={isLive && phase === 'inside' ? 'true' : undefined}
          title={item.title || '（无名知识点）'}
          onClick={() => { if (target != null) onJump?.(target); }}
        >
          <span className="zs-topic-dot" aria-hidden="true" />
          <span className="zs-topic-text">
            <span className="zs-topic-title">{item.title || '（无名知识点）'}</span>
            <span className="zs-topic-meta">
              <time>{time(item.fromMs)}</time>
              {browse.following && <span className="zs-topic-state">{stateLabel(nodeState)}</span>}
            </span>
          </span>
        </button>;
      })}

      {/* 折叠提示：一章知识点多于 `pageSize` 时，告诉用户这一章还有多少没显示。
          用的是 `browse.hidden`（当前章被折叠的条数），不是轨道的前后折叠 ——
          后者是"按当前位置取前后几个"，在按章浏览的列表里没有意义。 */}
      {browse.hidden > 0 && <p className="zs-topic-track-more">本章还有 {browse.hidden} 个（切换章节可看更多）</p>}
    </div>
  </aside>;
}
