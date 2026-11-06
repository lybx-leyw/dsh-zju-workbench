/** Runtime defaults used by both the v4 bench and the desktop integration. */
export const V4_PROFILE = Object.freeze({ concurrency: 3, splitLine: 1200, visionBatchSize: 4 });
export const V4_ACCEL = Object.freeze({ mix: { maxTokens: 16384 }, merge: { maxTokens: 16384 } });
