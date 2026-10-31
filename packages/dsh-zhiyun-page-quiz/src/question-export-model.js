/**
 * 题库 PDF 的排版模型：**纯函数**，不碰 DOM、不碰 React。
 *
 * 与 `question-export.jsx`（渲染 + 打印）和 `question-export.css`（纸面样式）
 * 分开，是因为这里的东西全都能在 node 里断言：分组、编号、文件名。
 * 那两处一旦出错只能靠人眼看打印结果，而编号错位、文件名带非法字符这类问题
 * 恰恰最容易被忽略 —— 导出的是一份「看起来对、其实答案对不上题号」的卷子。
 */

/** 导出文档挂载点的 id。桌面壳的 PDF 处理器按这个 id 判断文档是否还在。 */
export const QUIZ_EXPORT_ROOT_ID = 'zs-quiz-export';

/** 文件名/正文里不能出现的字符（Windows 与 macOS 的并集）。 */
const UNSAFE_FILENAME = /[<>:"/\\|?*\u0000-\u001f]/g;

/**
 * 清洗一段可用于文件名的文字。
 *
 * 与 `dsh-zhiyun-page-study` 的 `pdfFilename` 保持同一套规则（NFKC + 去非法字符 +
 * 去尾部点空格 + 截断），只是这里不拼讲义后缀 —— 两份导出件放在同一个下载目录里，
 * 命名规则漂移会让用户分不清哪份是卷子、哪份是讲义。
 */
export function safeFilenamePart(value, fallback = '') {
  const text = String(value ?? '').normalize('NFKC').replace(UNSAFE_FILENAME, '_').replace(/[. ]+$/g, '').trim();
  return text.slice(0, 80) || fallback;
}

/**
 * 导出件的文件名。
 *
 * 单课程带课程名（用户下载目录里常有多个课程的卷子），跨课程退化成「题库练习卷」，
 * 并且总是带日期 —— 同一天导两次不该互相覆盖，而重名时浏览器/保存对话框给的
 * 「已存在」提示，比自动加 (2) 更容易让人搞清自己存了哪个版本。
 */
export function quizPdfFilename(questions, date = new Date()) {
  const list = (Array.isArray(questions) ? questions : []).filter(q => q && q.status !== 'rejected');
  const courses = [...new Set(list.map(q => String(q.courseTitle ?? '').trim()).filter(Boolean))];
  const base = courses.length === 1 ? `${courses[0]} - 练习卷`
    : courses.length > 1 ? `题库练习卷 - ${courses.length} 门课`
    : '题库练习卷';
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return `${safeFilenamePart(base, '题库练习卷')} - ${day}.pdf`;
}

/**
 * 把选中的题目编成「卷面 + 卷末答案」两段结构。
 *
 * # 分两层：课程/节次 → 知识点
 *
 * 纸面卷子按「哪门课、哪一节」分段，用户才能把一叠打印件按课次分开；知识点作为
 * 第二层，因为出题本来就是围着知识点转的（同 `quiz-export.js` 里 Markdown 导出的
 * 心智模型）。只有一层的话，跨课程批量导出会糊成一张没有边界的清单。
 *
 * # 编号是**全文连续**的
 *
 * 卷末答案按题号索引，每段从 1 重新编号会让「第 3 题」在文档里出现三次，
 * 读者根本对不上。所以编号在整份文档上递增，答案附录直接复用同一批数字。
 *
 * # 已弃用的题不进卷子
 *
 * 与 `bank-export` 服务端一致：用户刚把这几道移出题库，再导进练习卷是反着来。
 * 判定放在这里而不是调用方，是为了让「界面上勾了 8 道、卷面只有 6 道」这件事
 * 有一个统一且可测的解释。
 *
 * @param {Array<object>} questions 按用户在列表里看到的顺序传入
 * @returns {{sections: Array<object>, items: Array<{number:number, question:object}>, total:number}}
 */
export function buildQuizPdfOutline(questions) {
  const list = (Array.isArray(questions) ? questions : []).filter(q => q && q.status !== 'rejected');
  const sections = [];
  const items = [];
  const sectionByKey = new Map();
  const pointByKey = new Map();

  for (const question of list) {
    const courseTitle = String(question.courseTitle ?? '').trim();
    const lessonTitle = String(question.lessonTitle ?? '').trim();
    const sectionKey = `${courseTitle}\u0000${lessonTitle}`;
    let section = sectionByKey.get(sectionKey);
    if (!section) {
      section = { key: sectionKey, courseTitle, lessonTitle, points: [] };
      sectionByKey.set(sectionKey, section);
      sections.push(section);
    }

    const title = String(question.pointTitle ?? '').trim() || '未标注知识点';
    const pointKey = `${sectionKey}\u0000${title}`;
    let point = pointByKey.get(pointKey);
    if (!point) {
      point = { title, items: [] };
      pointByKey.set(pointKey, point);
      section.points.push(point);
    }

    const entry = { number: items.length + 1, question };
    point.items.push(entry);
    items.push(entry);
  }

  return { sections, items, total: items.length };
}

/** 卷面用到的题型分布，写进封面元信息里，用户扫一眼就知道这份卷子考什么。 */
export function typeBreakdown(items) {
  const counts = new Map();
  for (const entry of (Array.isArray(items) ? items : [])) {
    const type = entry?.question?.type ?? '';
    if (!type) continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  return [...counts].map(([type, count]) => ({ type, count }));
}

/**
 * 题干里的挖空标记（`{{c1::答案}}`）换成横线。
 *
 * 与页面上 `questionText()` 的规则一致：只替换这一层，**不碰 `$...$`** ——
 * 公式交给 MarkdownText（它内部带 KaTeX）处理。导出件是给**人做**的卷子，
 * 标记本身、以及答案，都不能出现在题干里。
 */
export function stemForPrint(stem) {
  return String(stem ?? '').replace(/\{\{c\d+::[^}]*\}\}/g, '____');
}
