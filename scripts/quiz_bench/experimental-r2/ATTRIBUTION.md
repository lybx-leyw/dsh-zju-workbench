# 第三方来源

参考项目：HKUDS/DeepTutor，仓库 `https://github.com/HKUDS/DeepTutor`，本地 vendor 快照提交 `a31d82624c27d75f4e771d4fcb78dce16470b383`。已阅读其 Apache License 2.0；完整许可证保存在仓库的 DeepTutor vendor 目录。

参考文件：`deeptutor/agents/question/prompts/zh/pipeline.yaml` 的 explore、tool_summarizer、plan 与 quiz_step。

实验借鉴其“先探索素材、再生成明确蓝图、按单题蓝图出题”的阶段边界，以及保留来源/数值/定义、历史避重、选项风格的通用要求。未复制上游 Python agent loop 或 FINISH/PLAN/TOOL 协议；新建来源档案、结构化匹配和审查契约按本系统 JSON schema 重写。通用指引复用本仓已注明来源的 `deeptutor-guidance.js`。本实验不运行 DeepTutor 服务，不修改 vendor。

现有 v5 调度器快照与其余程序工具来自本仓自身代码，不属于第三方移植。快照改动仅用于隔离研究，不替换产品入口。
