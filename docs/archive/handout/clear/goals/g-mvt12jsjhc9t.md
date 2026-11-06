# 目标 g-mvt12jsjhc9t(rev3 · open)
- **一句话**:以新插件包 dsh-zhiyun-core-handout 实现「讲义 ⇄ 笔记」联动：讲义正文以笔记库 md 为唯一真源、record.lecture 保留 AI 基线并供出题与知识点导航；版本 = 一对（基线，md），重新生成换版、旧版进归档、回退为 swap
- **主张**:以新插件包 dsh-zhiyun-core-handout 实现「讲义 ⇄ 笔记」联动：讲义正文以笔记库 md 为唯一真源、record.lecture 保留 AI 基线并供出题与知识点导航；版本 = 一对（基线，md），重新生成换版、旧版进归档、回退为 swap。
- **升格门槛**:L3
- **判据(全文)**(未逐条拆分):
  1) packages/dsh-zhiyun-core-handout/ 存在，含 src/codec.js（Markdown 编解码 + 基线覆盖）与 src/version.js（版本对、归档、swap）；2) tests/handout-codec.test.mjs 与 tests/handout-version.test.mjs 通过；3) 笔记库文件树能看到归档、索引不收录归档（有测试证明反链计数不随版本数增长）；4) 生成讲义后笔记库出现 <课程>/<节次>.md，内容与基线一致；5) 讲义检索两处读 md 而非 record.lecture；6) 学习页有版本面板（列版本、回退、隐藏我的更改）；7) 登记齐 profile bundles、scripts/build.mjs 的 CLIENT_PACKAGES、cordis.patch.yml 自我 insert，且相关既有测试全绿。
> 这份文件由系统按账本落盘(投影产物);权威是账本里的 `goal/set` 与 `criteria/revised`。
## 假设(3)
- `h-j1yf8u` [alive] 把 AI 基线编码成 Markdown 再解码，能逐块恢复章/知识点/块三层结构与块正文（含例题的题干/解答两段）。
  - 推翻条件:任一块的正文、块类型或例题的题干/解答在往返后不一致，或章节数量改变。
  - scope: {"conditions":{"仓库":"zhiyun-pro-js","profile":"zhiyun-bench","讲义版本":"architecture-v4"},"ranges":{},"note":"只覆盖 AI 基线自身产出的结构，不含用户手改出的新结构。"}
  - uses (framing declarations): []
  - 断言:1 条
- `h-pqax28` [proposed] 归档目录既出现在文件树里、又被排除出索引，反链计数不随历史版本数增长。
  - 推翻条件:新增一个历史版本后，索引里的笔记条数或反链条数随之增加。
  - scope: {"conditions":{"仓库":"zhiyun-pro-js","profile":"zhiyun-bench","讲义版本":"architecture-v4","笔记库":"zhiyun-vault-notes"},"ranges":{}}
  - uses (framing declarations): []
  - 断言:1 条
- `h-f5szot` [proposed] 用户改写讲义 md 之后，出题所依据的知识点标题与正文仍与改动前一致。
  - 推翻条件:改写 md 后 knowledgePoints() 对同一 record 返回的 title 或 text 发生变化。
  - scope: {"conditions":{"仓库":"zhiyun-pro-js","profile":"zhiyun-bench","讲义版本":"architecture-v4"},"ranges":{}}
  - uses (framing declarations): []
