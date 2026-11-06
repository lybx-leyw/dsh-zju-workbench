/**
 * 本包的具名失败。
 *
 * 与 `dsh-zhiyun-source-classroom/src/errors.js` 同形（`code` + `message` + `details`），
 * 便于集成层统一处理：上游错误一律带 `code`，界面据此决定是「提示用户去登录」
 * 还是「稍后重试」还是「这段视频没有字幕，走 ASR」。
 *
 * `details` 只放**安全元数据**（错误码、URL 主机名、状态码），
 * 绝不放响应正文、Cookie 或完整 URL —— 那三样都可能带凭证或个人信息。
 */
export class BilibiliError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'BilibiliError';
    this.code = code;
    this.details = details;
  }

  toJSON() {
    return { code: this.code, message: this.message, details: this.details };
  }
}

/** 本包会抛的码。**每一个都对应一种不同处置**，调用方按码分支，不要按 message 分支。 */
export const ERROR_CODE = Object.freeze({
  /** 凭证不完整/缺失。**处置：提示用户去登录，不要重试。** */
  NO_CREDENTIAL: 'NO_CREDENTIAL',
  /** 凭证过期或无效（`code=-101`）。**处置：重新登录。** */
  CREDENTIAL_EXPIRED: 'CREDENTIAL_EXPIRED',
  /** 触发风控（HTTP 412 / 200 返回 HTML / `code=-352`）。**处置：稍后重试或换登录态。** */
  RISK_CONTROL: 'RISK_CONTROL',
  /** 视频不存在 / 已删除 / 仅会员可见（`-404` / `-403` / `-10403`）。**处置：不要重试。** */
  VIDEO_UNAVAILABLE: 'VIDEO_UNAVAILABLE',
  /** 返回结构不是预期的 JSON。**处置：上游改了接口，需要修代码。** */
  API_SHAPE: 'API_SHAPE',
  /** 该视频没有字幕轨。**不是错误，是确定结果** —— 处置是走 ASR 或告知用户。 */
  NO_SUBTITLE_TRACK: 'NO_SUBTITLE_TRACK',
  /** 网络层失败（DNS / 连接 / 超时）。**处置：重试。** */
  NETWORK: 'NETWORK',
  /** 输入不合法（aid/cid 不是正整数等）。 */
  INPUT: 'INPUT',
  /** 外部进程（ffmpeg）返回非零码。**处置：看 `message` 里那句话。** */
  PROCESS_FAILED: 'PROCESS_FAILED',
  /** 外部进程超时。**处置：加长超时或换更短的素材。** */
  PROCESS_TIMEOUT: 'PROCESS_TIMEOUT',
  /** 调用方主动取消。**处置：什么都不做** —— 取消是用户的意志，不是失败。 */
  CANCELLED: 'CANCELLED',
});

/** 风控类错误：`412`、`-352`、以及 HTTP 200 但返回 HTML 验证页。 */
export const isRiskControl = (status, code) => status === 412 || code === -352;

/** 凭证类错误：`-101` 未登录 / `-352` 已在风控里单列。 */
export const isCredentialIssue = (code) => code === -101;

/** 视频不可用：`-404` 不存在、`-403` 私密、`-10403` 会员、`-22007` 转码中。 */
export const isUnavailable = (code) => [-404, -403, -10403, -22007].includes(code);

/**
 * 把一个上游 `code` 翻成**带处置意图**的中文说明。
 *
 * 翻成人话的作用不是好看：`-352` 如果不带「触发风控」四个字，
 * 日志里就只剩「热榜读取失败 code=-352」，用户不知道该等一会儿还是该重新登录。
 */
export function explainCode(code, message = '') {
  const tail = message ? `（${message}）` : '';
  if (isCredentialIssue(code)) return `未登录或凭证已过期${tail}：请重新扫码登录后重试`;
  if (code === -352) return `触发风控${tail}：请稍后重试，或换用已登录的凭证`;
  if (code === -404) return `视频不存在${tail}`;
  if (code === -403) return `视频不可见（私密或已删除）${tail}`;
  if (code === -10403) return `该视频仅大会员可见${tail}`;
  if (code === -22007) return `视频仍在转码中${tail}：请稍后重试`;
  return `B 站接口返回 code=${code}${tail}`;
}
