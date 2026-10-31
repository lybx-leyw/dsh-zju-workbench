/**
 * 生成运行的限额配置（源文件:lib/server/generation/run/config.ts:1-61）+
 * agent runtime 里被 route 用到的三个上限（源:lib/server/agent-runtime/config.ts:1-58）。
 *
 * 读取时机不变：**每次调用都重新读环境变量**（上游注释：测试或运维重启立刻可见）。
 * `positiveIntegerFromEnv` 的「非法值抛错」也保留 —— 上游是有意让它炸（配置错了要
 * 立刻知道），这里照搬。
 */

function numberFromEnv(value, fallback) {
  return value ? Number(value) : fallback;
}

function positiveIntegerFromEnv(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer, got ${JSON.stringify(raw)}`);
  }
  return value;
}

/** 上游 `agentRuntimeConfig` 中被 route 用到的字段。 */
export function agentRuntimeConfig() {
  return {
    scanIntervalMs: numberFromEnv(process.env.OPENMAIC_AGENT_RUNTIME_SCAN_INTERVAL_MS, 1000),
    heartbeatIntervalMs: numberFromEnv(process.env.OPENMAIC_AGENT_RUNTIME_HEARTBEAT_MS, 2000),
    leaseTtlMs: numberFromEnv(process.env.OPENMAIC_AGENT_RUNTIME_LEASE_TTL_MS, 10_000),
    maxAttempts: numberFromEnv(process.env.OPENMAIC_AGENT_RUNTIME_MAX_ATTEMPTS, 5),
    maxUploadBytes: numberFromEnv(process.env.OPENMAIC_AGENT_MAX_UPLOAD_BYTES, 50 * 1024 * 1024),
    maxDocumentBytes: numberFromEnv(process.env.MATERIALS_MAX_DOCUMENT_BYTES, 50 * 1024 * 1024),
    maxMaterialsPerOwner: numberFromEnv(process.env.MATERIALS_MAX_COUNT_PER_OWNER, 100),
    maxMaterialBytesPerOwner: numberFromEnv(
      process.env.MATERIALS_MAX_TOTAL_BYTES_PER_OWNER,
      2 * 1024 * 1024 * 1024,
    ),
  };
}

/** 上游 `generationRunConfig()`（源:config.ts:48-61）。 */
export function generationRunConfig() {
  const runtime = agentRuntimeConfig();
  return {
    scanIntervalMs: runtime.scanIntervalMs,
    heartbeatIntervalMs: runtime.heartbeatIntervalMs,
    leaseTtlMs: runtime.leaseTtlMs,
    maxConcurrent: positiveIntegerFromEnv('OPENMAIC_GENERATION_RUN_MAX_CONCURRENT', 4),
    maxTakeovers: runtime.maxAttempts,
    maxActiveRunsPerOwner: positiveIntegerFromEnv('OPENMAIC_MAX_ACTIVE_RUNS_PER_OWNER', 2),
    maxWaitingRunsPerOwner: positiveIntegerFromEnv('OPENMAIC_MAX_WAITING_RUNS_PER_OWNER', 10),
    finishedRetentionMs:
      positiveIntegerFromEnv('OPENMAIC_GENERATION_RUN_RETENTION_HOURS', 24) * 60 * 60 * 1000,
    compactionIntervalMs: 60 * 60 * 1000,
  };
}

/**
 * 上游 `MATERIAL_MEDIA_UPLOAD_LIMIT` / `MATERIAL_DOCUMENT_UPLOAD_LIMIT`
 * （源:lib/server/materials/upload-limits.ts:9-12）。
 */
export function materialUploadLimits() {
  const runtime = agentRuntimeConfig();
  return {
    media: runtime.maxUploadBytes,
    document: Math.min(runtime.maxDocumentBytes, runtime.maxUploadBytes),
  };
}
