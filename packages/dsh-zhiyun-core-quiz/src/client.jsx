// Share the knowledge-point projection without inlining another package's source.
export const name = 'zhiyun-quiz-client';
export const inject = [];
export function apply() {}
export { knowledgePoints, knowledgeChapters } from './knowledge-points.js';
export { QUESTION_STRATEGIES, QUESTION_TYPES, STRATEGY_PRESETS, allocateStrategies } from './strategies.js';
