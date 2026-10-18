# Ch 12 · Modern web accessibility

> **状态声明：本章是实现实践，不是新标准。**
>
> 原始 8 份来源是座位式显示终端的工效学标准，Ch 10 讲的是无障碍的**目标与条文**
> （timing、input flexibility、consistency、motion）。本章补的是**在现代 Web/Electron
> 里怎么做到**：语义 HTML、ARIA、焦点、键盘、动态内容、表单。
>
> 依据：WCAG 2.2（A/AA）与 WAI-ARIA Authoring Practices Guide。引用时标注「实践（Ch 12）」。

---

## 12.1 语义优先，ARIA 兜底

**第一条规则：能用原生元素就不要加 role。**

| 需求 | 正确 | 错误 |
|---|---|---|
| 按钮 | `<button>` | `<div role="button" tabindex="0">` |
| 链接 | `<a href>` | `<span onclick>` |
| 导航区 | `<nav aria-label="主要页面">` | `<div class="nav">` |
| 分组标题 | `<h2>` | `<div class="title">` |

原生元素的键盘行为、焦点、读屏语义是免费的；`role` 只补语义，**不补行为**。

---

## 12.2 ARIA 角色与状态（按用途）

| 属性 | 用途 | 什么时候必须 |
|---|---|---|
| `aria-label` | 给无可见文字的元素命名 | 纯图标按钮（本仓库导轨全是） |
| `aria-current="page"` | 标识当前所在页 | 导航项 |
| `aria-expanded` | 展开/收起状态 | 菜单、折叠面板、下拉 |
| `aria-selected` | 选中状态（tab/listbox） | 标签页、列表选择 |
| `aria-pressed` | 开关按钮的按下态 | 切换类按钮 |
| `aria-haspopup` | 会弹出菜单/对话框 | 触发器 |
| `aria-controls` | 关联被控制元素 | 触发器 → 面板 |
| `aria-hidden="true"` | 隐藏装饰性内容 | 纯装饰图标、重复文本 |
| `aria-live="polite"` | 异步更新播报 | 提示、结果、状态变化 |
| `aria-invalid` | 校验失败 | 表单错误 |
| `aria-describedby` | 关联说明/错误文本 | 表单帮助与错误 |

**禁止**：给可见文字再加同义 `aria-label`（会覆盖可见文本，且读屏重复）；用 `aria-hidden`
隐藏可交互元素（焦点会掉进黑洞）。

---

## 12.3 焦点管理

| 场景 | 要求 |
|---|---|
| 键盘焦点 | 必须**可见**：`:focus-visible` 有 ≥2px 描边、offset ≥2px |
| 打开对话框 | 焦点移入对话框**第一个可聚焦元素**（或标题）；`Esc` 关闭 |
| 关闭对话框 | 焦点**返回触发它的元素** |
| 焦点陷阱 | 模态内 Tab 循环，不得跑到背景；非模态**不得**设陷阱 |
| 页面切换 | 焦点移到新页面主标题（或 `main`），读屏才知道换了页 |
| skip link | 长导航前提供「跳到主内容」，聚焦时可见 |

**反模式**：`outline: none` 且无替代；`tabindex` 正数（打乱顺序）；用 `div` 当按钮
（Tab 到不了）。

---

## 12.4 键盘

- **Tab / Shift+Tab**：顺序 = 视觉顺序；不得有「键盘陷阱」（除模态）。
- **Enter / Space**：激活按钮；Space 对复选框/开关。
- **Esc**：关闭菜单/对话框/抽屉。
- **方向键**：菜单、标签页、列表内移动（roving tabindex）。
- **快捷键**：单键快捷键必须可关闭/可重映射（WCAG 2.1.4）；不要与系统/读屏快捷键冲突。
- **拖拽**：必须提供键盘替代（WCAG 2.5.7）。

---

## 12.5 动态内容与状态

| 场景 | 做法 |
|---|---|
| 异步结果 | `aria-live="polite"` 区域；不要整页重渲染 |
| 紧急错误 | `role="alert"` 或 `aria-live="assertive"`（少用） |
| 加载中 | `aria-busy="true"`；按钮禁用时说明原因 |
| 进度不确定 | 用 spinner + 文案；确定进度用 `role="progressbar"` + `aria-valuenow` |
| 自动刷新 | >5s 的自动更新必须可暂停（WCAG 2.2.2） |

**注意**：`aria-live` 区域必须在 DOM 里**先存在**，再更新内容；动态插入整个区域不会被播报。

---

## 12.6 表单

- 每个输入有**可见 `<label for>`**；placeholder 不能代替 label（聚焦即消失）。
- 错误：`aria-invalid="true"` + `aria-describedby` 指向错误文本；错误文本要具体
  （「邮箱缺少 @」而非「输入有误」）。
- 必填：`required` + 可见标记；不要只用红色（颜色不能是唯一通道，Ch 3）。
- 分组：`<fieldset><legend>`；相关字段不要靠视觉间距分组。
- 提交失败：焦点移到**第一个错误字段**，并播报错误数量。

---

## 12.7 本仓库现状（2026-10-17 扫描）

| 指标 | 数量 | 评价 |
|---|---|---|
| `aria-label` | 75 | 覆盖面好（导轨、图标按钮） |
| `aria-expanded` / `aria-selected` / `aria-current` / `aria-pressed` | 14 / 13 / 4 / 6 | 状态语义齐 |
| `:focus-visible` | 16 处 | 主要交互有描边 |
| `prefers-reduced-motion` | 3 处 | 覆盖动效，但需确认新动效也遵守 |

**已知缺口（待补）**

- 无 skip link；
- 页面切换后的焦点管理未确认（`client.jsx` 的导航）；
- 模态（账号对话框）关闭后焦点是否返回头像按钮，未验证；
- `aria-live` 使用少（反馈页/加载态）。

---

## 12.8 检查清单（PR 前）

- [ ] 纯图标按钮有 `aria-label`
- [ ] 当前页/展开/选中状态有对应 `aria-*`
- [ ] 键盘可完成主流程（Tab → Enter → Esc）
- [ ] `:focus-visible` 可见，且未被 `outline:none` 抹掉
- [ ] 模态有焦点陷阱 + 关闭后焦点归还
- [ ] 异步结果用 `aria-live`，且区域预先存在
- [ ] 表单有 label、错误有 `aria-describedby` + `aria-invalid`
- [ ] 状态不只靠颜色（有文字/形状/图标）
- [ ] 动效尊重 `prefers-reduced-motion`

---

## 12.9 来源与限制

**依据**：WCAG 2.2（1.4.1、2.1.1、2.1.4、2.2.2、2.4.3、2.4.7、2.5.7、3.3.1、3.3.2、4.1.2）；
WAI-ARIA Authoring Practices Guide。

**未覆盖**：屏幕阅读器逐款实测（NVDA/JAWS/VoiceOver）、移动端手势、语音控制、
认知障碍的专门设计。

**不可当作**：无障碍合规认证。真正的合规需要真机 + 读屏实测。
