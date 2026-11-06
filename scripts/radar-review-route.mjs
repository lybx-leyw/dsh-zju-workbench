/**
 * 检查器：「复习」模式到底有没有把错题排在前面。
 *
 * # 为什么需要这条
 *
 * `planPractice(items, { mode })` 里有三种模式：`new` / `review` / `mixed`。
 * 用户看到的是「新题 / 复习 / 混合」三个按钮 —— 点「复习」的语义预期是
 * **「把我错过的题再给我一次」**。
 *
 * 但选池只看 `attempts.length > 0`：
 *
 *   const fresh = ...filter(q => !q.attempts?.length)
 *   const old   = ...filter(q =>  q.attempts?.length)
 *   else chosen.push(...(mode === 'new' ? fresh : old).slice(0, count));
 *
 * `attempts` 里同时装着「答对的」和「答错的」，于是 `old` 是一个**乱序混合池**，
 * `review` 取前 N 个 ≈ 在「做过的题」里随机抽。题目数据里**早就有**
 * `attempts[i].countsAsWrong` 这一维（用户自评优先、`unknown` 不算错），
 * 选池却一次都没读过它。
 *
 * r77 只在源码上读出这个结论（「`review` 叫复习，实际是做过的」）。
 * 本检查器把它变成**可复跑的黑盒判定**：构造一批「一半错过、一半只做对过」的题，
 * 反复调用真实的 `planPractice`，统计错题占比。
 *
 * # 判定
 *
 * - `ROUTE_MISSING`：`review` 取到的题里，错过过的题占比 ≤ 阈值（默认 85%）。
 * - `ROUTE_WASTED`：抽查的批次里有「从没做过的题」混进 `review`（不该发生）。
 * - `SAMPLE_TOO_SMALL`：错题数不足以做判定（< 2），本项跳过（不计入失败）。
 *
 * # 为什么是黑盒而不是读源码
 *
 * 读源码只能证明「现在这一版没看 `countsAsWrong`」。黑盒能证明
 * **行为**是错的，并且修复后**同一个脚本**会变绿 —— 它同时是验收用例。
 *
 * # 用法
 *
 *   node scripts/radar-review-route.mjs              # 人类可读
 *   node scripts/radar-review-route.mjs --json       # 机器可读
 *   node scripts/radar-review-route.mjs --runs 500   # 加大抽样次数
 *
 * 不联网。退出码：0 = 路由正常；1 = ROUTE_MISSING / ROUTE_WASTED。
 */

import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '..');
const QUIZ_SRC = path.join(ROOT, 'packages', 'dsh-zhiyun-core-quiz', 'src');

/** 确定性伪随机，保证「同一份代码跑出同一个数」。 */
function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

async function loadQuiz() {
  const points = await import(pathToFileURL(path.join(QUIZ_SRC, 'points.js')).href);
  const store = await import(pathToFileURL(path.join(QUIZ_SRC, 'store.js')).href);
  if (typeof points.planPractice !== 'function') {
    throw new Error('dsh-zhiyun-core-quiz 里没有导出 planPractice（上游改了接口？）');
  }
  if (!store.QUIZ_AUTOGRADE_VERDICTS || typeof store.makeAttempt !== 'function') {
    throw new Error('dsh-zhiyun-core-quiz 的 store 缺 makeAttempt / QUIZ_AUTOGRADE_VERDICTS');
  }
  return { planPractice: points.planPractice, makeAttempt: store.makeAttempt, VERDICT: store.QUIZ_AUTOGRADE_VERDICTS };
}

function item(id, attempts) {
  return { id, status: 'approved', type: 'cloze', strategy: 'recall', pointId: 'p1', attempts };
}

/**
 * 构造题池：`wrong` 道「错过」+ `correctOnly` 道「只做对过」+ `fresh` 道没做过。
 *
 * ⚠️ 必须用 `store.QUIZ_AUTOGRADE_VERDICTS` 里的**同一个对象**：
 * `countsAsWrong` 是 `autoVerdict === QUIZ_AUTOGRADE_VERDICTS.incorrect` —— **恒等比较**，
 * 自己造一个 `{ code: 'incorrect' }` 会静默得到 `countsAsWrong === false`（踩过）。
 */
function buildPool({ wrong, correctOnly, fresh }, makeAttempt, VERDICT) {
  const mk = (verdict) => makeAttempt({
    id: 'a', quizId: 'q', courseId: 'c', sectionId: 's', blockIndex: 0,
    response: '', autoVerdict: verdict, selfRecall: null, at: '2026-10-27T00:00:00Z',
  });
  const items = [];
  const wrongIds = new Set();
  for (let i = 0; i < wrong; i++) {
    const id = `w${i}`;
    // 先错后对：`countsAsWrong` 看的是「任一次错过」以外的语义由实现自己决定，
    // 这里给两次记录，确保「错过」不是「唯一一次」的特例。
    items.push(item(id, [mk(VERDICT.incorrect), mk(VERDICT.correct)]));
    wrongIds.add(id);
  }
  for (let i = 0; i < correctOnly; i++) {
    items.push(item(`c${i}`, [mk(VERDICT.correct), mk(VERDICT.correct)]));
  }
  for (let i = 0; i < fresh; i++) {
    items.push(item(`n${i}`, []));
  }
  return { items, wrongIds };
}

export async function audit({ runs = 200, count = 10, threshold = 0.85 } = {}) {
  const { planPractice, makeAttempt, VERDICT } = await loadQuiz();
  const { items, wrongIds } = buildPool({ wrong: 10, correctOnly: 10, fresh: 10 }, makeAttempt, VERDICT);

  // 先自证：题池里「错过」的确实被 countsAsWrong 认出来，否则后面的数没意义。
  const observedWrong = items.filter((q) => q.attempts.some((a) => a.countsAsWrong)).length;
  if (observedWrong !== wrongIds.size) {
    return {
      ok: false,
      findings: [{
        code: 'LABEL_MISMATCH',
        detail: `题池构造与实际不符：期望 ${wrongIds.size} 道「错过」，countsAsWrong 给出 ${observedWrong} 道`,
      }],
      stats: null,
    };
  }

  const rand = seeded(20261027);
  let wrongHits = 0;
  let correctHits = 0;
  let freshHits = 0;
  let shortBatches = 0;
  const sampleSizes = new Set();

  for (let r = 0; r < runs; r++) {
    const chosen = planPractice(items, { mode: 'review', count }, rand);
    sampleSizes.add(chosen.length);
    if (chosen.length !== count) shortBatches++;
    for (const q of chosen) {
      if (wrongIds.has(q.id)) wrongHits++;
      else if (q.id.startsWith('c')) correctHits++;
      else freshHits++;
    }
  }

  const total = wrongHits + correctHits + freshHits;
  const share = total ? wrongHits / total : 0;
  const findings = [];
  if (wrongHits + correctHits === 0) {
    findings.push({ code: 'SAMPLE_TOO_SMALL', detail: 'review 一次都没抽到做过的题，无法判定' });
  } else if (share <= threshold) {
    findings.push({
      code: 'ROUTE_MISSING',
      detail: `review 抽到 ${total} 题，其中「错过过的」只占 ${(share * 100).toFixed(1)}%（阈值 ${(threshold * 100).toFixed(0)}%）`
        + ' —— 与「在做过的题里随机抽」无法区分',
    });
  }
  if (freshHits > 0) {
    findings.push({ code: 'ROUTE_WASTED', detail: `review 里混进了 ${freshHits} 次「从没做过的题」` });
  }
  if (shortBatches > 0) {
    findings.push({ code: 'SHORT_BATCH', detail: `${shortBatches}/${runs} 次没取满 ${count} 题（池子够大，不该发生）` });
  }

  return {
    ok: findings.length === 0,
    findings,
    stats: {
      runs, count, threshold,
      pool: { wrong: 10, correctOnly: 10, fresh: 10 },
      wrongHits, correctHits, freshHits,
      wrongShare: Number(share.toFixed(4)),
      sampleSizes: [...sampleSizes].sort((a, b) => a - b),
    },
  };
}

function render(result) {
  const { ok, findings, stats } = result;
  const lines = [];
  lines.push('生态雷达 · 「复习」错题路由检查');
  lines.push('');
  if (!stats) {
    lines.push(`✗ 无法判定：${findings.map((f) => f.code).join(', ')}`);
    for (const f of findings) lines.push(`  - ${f.code}: ${f.detail}`);
    return lines.join('\n');
  }
  lines.push(`题池：错过 ${stats.pool.wrong} / 只做对过 ${stats.pool.correctOnly} / 没做过 ${stats.pool.fresh}`);
  lines.push(`抽样：review 模式 ${stats.runs} 次 × ${stats.count} 题`);
  lines.push(`命中：错题 ${stats.wrongHits} / 做对过 ${stats.correctHits} / 没做过 ${stats.freshHits}`);
  lines.push(`错题占比：${(stats.wrongShare * 100).toFixed(1)}%（阈值 ${(stats.threshold * 100).toFixed(0)}%）`);
  lines.push('');
  if (ok) {
    lines.push('✓ review 优先取错题');
  } else {
    lines.push(`✗ 判定不通过：${findings.map((f) => f.code).join(', ')}`);
    for (const f of findings) lines.push(`  - ${f.code}: ${f.detail}`);
  }
  return lines.join('\n');
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename ?? '');
if (isMain) {
  const args = process.argv.slice(2);
  const runsIdx = args.indexOf('--runs');
  const runs = runsIdx >= 0 ? Number(args[runsIdx + 1]) : 200;
  const result = await audit({ runs: Number.isInteger(runs) && runs > 0 ? runs : 200 });
  if (args.includes('--json')) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    process.stdout.write(`${render(result)}\n`);
  }
  process.exitCode = result.ok ? 0 : 1;
}
