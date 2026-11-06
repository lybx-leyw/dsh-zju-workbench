# r4 的文献依据与实现推论

阅读库检索日期：2026-10-28。全文与阅读笔记保存在本地忽略目录 `.refers/`，
这里仅记录公开书目信息与本项目独立实现的设计推论，不再分发论文全文。
以下不是对本项目效果的论文背书，没有引入第三方实现或提示词。

| 方向与来源 | 文献给出的设计依据 | r4 的实现推论与边界 |
| --- | --- | --- |
| Fives & DiDonato-Barnes (2013), [Classroom Test Construction: The Power of a Table of Specifications](https://files.eric.ed.gov/fulltext/EJ1005136.pdf) | 连接学习目标、内容范围、认知要求与题量 | 先建本批蓝图并报告缺口；默认轮转不是教学权重，也不是效度证明 |
| [Exam blueprinting as a tool to overcome principal validity threats: A scoping review](https://www.sciencedirect.com/science/article/pii/S1575181324000214) (2024) | 蓝图帮助应对内容失衡等效度威胁，研究存在异质性 | 不把题数达标写成知识范围完整；报告仅限本批 |
| Cai & Rott (2024), [On understanding mathematical problem-posing processes](https://doi.org/10.1007/s11858-023-01536-w) | 定向、联结、生成、反思的问题提出过程 | 记录原文、改编操作和改变的任务，并自解与反思；本项目八类操作不是统一七种改编法 |
| [Textbooks as a Resource for Teaching Mathematics Through Problem Posing: Catalyzing Instructional Change](https://doi.org/10.1007/s11858-025-01694-z) (2025) | 教材改编持续连接课时学习目标 | 变体保留目标与前提，改认知任务须重审题模；不从例题数值制造记忆目标 |
| Gierl, Zhou & Alves (2008), [Developing a Taxonomy of Item Model Types to Promote Assessment Engineering](https://ejournals.bc.edu/index.php/jtla/article/view/1629) | 显式题模变量，区分表层与深层变化 | 变量域、不变量、实例身份及题模身份分开；角色标签不等于测量性质已确定 |
| Gierl & Lai (2013), [Using Automated Processes to Generate Test Items](https://ncme.org/wp-content/uploads/2025/10/Module-34-Automated-Item-Generation-Gierl-Lai.pdf) | 认知设计、结构化题模、程序生成的分层 | 先提交可审查题模再实例化；网站2025上传路径不是论文年份 |
| Sommer & Arendasy (2025), [Automatic- and Transformer-Based Automatic Item Generation: A Critical Review](https://doi.org/10.3390/jintelligence13080102) | 质量控制、校准与效度成本不能省略 | 家族计数与实例数分开；设计难度仅是假设，同模不保证同难度 |
| Zhang & Tan (2023), [Validating an Automatic Item Generation System Based on a Cognitive Diagnostic Model](https://doi.org/10.2333/jbhmk.50.131) | 一次方程式案例区分题模属性 M 和题实例属性 Q，并使用响应数据验证 | M/Q 分层，Q 逐题审核；本项目尚无响应数据，不宣称完成认知诊断 |
| Mislevy, Almond & Lukas (2004), [A Brief Introduction to Evidence-Centered Design, CSE Report 632](https://files.eric.ed.gov/fulltext/ED483399.pdf) | 连接能力主张、可观察证据与任务条件 | 技能与来源绑定、逐条证据规则、题面自足性和实际必需性检查；不是现成自动诊断器 |
| [DiVERT: Distractor Generation with Variational Errors Represented as Text for Math Multiple-choice Questions](https://aclanthology.org/2024.emnlp-main.512/) (2024) | 以错误原因引导干扰项；作者也报告错误表示与选项可能不一致 | 每个错误选项绑定操作并再次核对，数值路径可执行计算；不推断学生必定因该误解选错 |
| [A Survey on Automated Distractor Evaluation in Multiple-Choice Tasks](https://aclanthology.org/2025.bea-1.5/) (2025) | 自动指标与真实考试干扰项表现不同，真实作答数据常缺失 | 模型审核结果不称为实测诊断效度，不用文本相似度替代学生反应 |

独立作答、调用预算、原子检查点和有界扩展是本项目为上述设计增加的工程措施，
不声称某篇论文已经验证该具体组合。2026年前沿预印本仅作为后续评测方向参考，
没有将其多代理流程、难度预测或 Q 矩阵编码结果直接当成本项目已验证能力。
