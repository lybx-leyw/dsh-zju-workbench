/**
 * dsh-radar-mycoursereviews —— **候选骨架，未实现**。
 *
 * ⚠ 本文件是占位，不含任何业务逻辑。评审通过后才可继续实现。
 * ⚠ 本包**未接入**任何 profile，**不可**在真实环境挂载。
 *
 * 职责（评审通过后实现）：在「反馈」页（dsh-zhiyun-page-feedback）内
 * 新增**课程评价子视图**——依托本仓课程页的课程数据源，提供多维评分的
 * 结构化的课程评价与检索。
 *
 * 上游 compsci-adl/mycoursereviews（MIT）**仅借鉴数据模型与交互**，
 * **不搬运其课程数据**（数据属阿德莱德大学，不在 MIT 授权范围）。
 */

export const name = 'dsh-radar-mycoursereviews';

/** 骨架版本标记：0.0.0 表示"未评审、未实现"。 */
export const RADAR_SKELETON = true;

export function apply(ctx) {
  // TODO: 实现前须先通过 README「评审要点」第 1 条的裁定（是否真需要课程维度评价）。
  //
  // TODO(1) 数据模型适配
  //   - 复用本仓课程页的课程数据源，**不新建课程目录**
  //   - 定义评分维度（给分 / 作业量 / 讲课质量 …）与标签体系
  //   - 参照上游 `src/` 的 schema 设计（Drizzle），但**不复制其课程数据**
  //
  // TODO(2) 面板接入
  //   - 作为 dsh-zhiyun-page-feedback 的**并列子视图**，不替换现有诉求板
  //   - 须解决"两个评价入口打架"的边界问题（见 README 评审要点 3）
  //
  // TODO(3) 持久化（**前置阻塞项**）
  //   - 评价是累积型数据，不能沿用"重启可能丢数据"的收件服务方案
  //   - 须先确定持久化方案，再实现（见 README 评审要点 5）
  //
  // TODO(4) 署名与隐私
  //   - 反馈页现用本机随机笔名；课程评价是否保持匿名须人工定调
  //   - 上游用 Keycloak 实名 SSO 的做法**不应直接照搬**（见 README 评审要点 4）
  void ctx;
}
