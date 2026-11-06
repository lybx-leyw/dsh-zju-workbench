# DeepTutor 通用出题指引

来源：[HKUDS/DeepTutor](https://github.com/HKUDS/DeepTutor)，固定提交 `a31d82624c27d75f4e771d4fcb78dce16470b383`，版本 1.6.15，Apache-2.0。

`src/deeptutor-guidance.js` 将上游 `deeptutor/agents/question/prompts/zh/pipeline.yaml` 中 explore 的素材优先、历史存在时才诊断，tool_summarizer 的来源/定义/数值保真，plan 的蓝图范围和具体主题差异，quiz_step 的四选一唯一答案、选项长度风格及清晰解释等通用规则，改写为本系统的可选指引。

上游根 `SKILL.md` 是调用 CLI 的使用说明，不直接包含这些教学约束；本适配使用它指向的真实出题能力提示词。没有移入学科示例、工具执行协议、CLI 命令或上游输出 schema。保留本系统的 items/choices/basis、题型、考点准备、审查、挂账、去重和并发流程，不调用 Python 或 DeepTutor。

这是经过改写和格式桥接的可选实验指引，不是上游原版行为复刻或性能保证。上游完整原文、许可证与第三方声明在 `../dsh-zhiyun-host-deeptutor/vendor/deeptutor/`，本次不修改 vendor。
