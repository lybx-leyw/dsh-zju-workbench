/**
 * PBL 场景的"简报"投影：离线产物（HTML 播放器、PPTX 占位页）只能展示这些字段。
 *
 * 源：ref/OpenMAIC/lib/export/pbl-briefing.ts:1-54
 *     ref/OpenMAIC/lib/pbl/legacy/read.ts:206-223（resolvePBLContent）
 *
 * 权威表示与教室一致：`projectV2` 可运行就用它；历史的 `projectConfig` 走升级
 * 路径（`upgradeLegacyPBLConfigToProjectV2`）。升级器属于 PBL 包（另一个包的
 * `src/`，规范 §1 判据 3 不允许 import），所以本包只处理 v2：legacy 场景在这里
 * 返回 null，调用方按"无简报"降级（占位页只画类型标签，播放器显示不可用）。
 * 运行态（threads / submissions / evaluations）、角色提示词与聊天记录从不进入简报。
 */

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

/** 源：read.ts:206-212 —— v2 可运行的判定（本包只认结构的"有标题 + 有里程碑"）。 */
export function isRunnablePBLProjectV2(value) {
  if (!isRecord(value)) return false;
  if (typeof value.title !== 'string' && typeof value.description !== 'string') return false;
  return Array.isArray(value.milestones) || isRecord(value.scenario);
}

/** 源：pbl-briefing.ts:17-52 */
export function pblBriefing(content) {
  if (!isRecord(content)) return null;
  const project = isRunnablePBLProjectV2(content.projectV2) ? content.projectV2 : undefined;
  if (!project) return null;
  const scenario = isRecord(project.scenario) ? project.scenario : undefined;
  return {
    title: project.title,
    description: project.description,
    learningObjective: project.learningObjective,
    scenario: scenario && {
      setting: scenario.setting,
      goal: scenario.goal,
      learnerRole: scenario.learnerRole,
      characters: (scenario.characters ?? [])
        .filter(isRecord)
        .map((character) => ({ name: character.name, persona: character.persona })),
    },
    milestones: (project.milestones ?? []).filter(isRecord).map((milestone) => ({
      title: milestone.title,
      description: milestone.description,
      order: milestone.order,
      microtasks: (milestone.microtasks ?? []).filter(isRecord).map((task) => ({
        title: task.title,
        description: task.description,
        learnerBrief: task.learnerBrief,
        order: task.order,
      })),
    })),
  };
}
