# 借鉴来源（本包不含任何上游实现代码）

本骨架 `src/` 下 `index.js` / `upstream.js` **只有契约、口径与 TODO**，
不包含下列任一项目的源代码。以下逐条记录「借了什么 / 没借什么」。

## 1. `GOOGUO2333/dsh-job-hunting` v1.2.2 — **MIT**

- 角色：**上游依赖**（`package.json.dependencies` 锁版 `1.2.2`），A 类「锁版挂载」对象。
- 借：工具签名、`resume.js` / `careers.js` 的**公开函数名与口径**（打分权重、分档阈值）。
- 未借：任何实现。`readZip` / `readCMap` / `scoreCareer` 的代码**一行都没进本仓**。
- 沙箱实测记录见 `README.md` §判据③（docx 解析、CMap 数组式/递增式、多字体）。
- 许可证全文：MIT，`Copyright` 见上游 `LICENSE`。

## 2. `Gsync/jobsync` v1.2.0 — **MIT**

- 角色：**口径来源**（不是依赖）。
- 借：`SCORES: match=<0-100> recommendation=<strong|good|partial|weak>` 首行契约；
  `stripThinking` 的「先剥思维链再解析」次序；评分带 80/65/50/35 的分界。
- 未借：该仓库是 Next.js + Prisma 整站，本包不复制其任何模块。
- 见 TODO-3 / TODO-C。

## 3. `resume-llm/resume-ai` — **MIT**

- 角色：**检测口径来源**。
- 借：「零宽字符 + 异常空白 + 非打印字符」三类隐藏内容的判据（`_detect_hidden_content`）。
- 未借：其实现；本包另加了「零宽不再重复计入非打印」的修正，并把检测扩到**简历侧**。
- 见 TODO-5。

## 4. `1bailan/dsh-plugin-boss-zhipin` — **MIT**

- 角色：**伦理红线措辞来源**（该仓库**未被采用**，其自动化投递能力与本仓只读定位冲突）。
- 借：其「安全与边界」一节的自设红线精神 —— 不绕验证码/风控/每日上限、不批量、不留常驻进程。
- 未借：任何代码或 skill 脚本。

---

> 若后续实现中引入了上述任一项目的实际代码，**必须**在本文件补上具体文件与行范围，
> 并在包顶 `NOTICE` 中保留原文版权声明（CONTRIBUTING 3.3）。
