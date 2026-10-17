# PR checklist · 工效学与可访问性

> 复制到 PR 描述里逐条勾选。规则依据见 `repo-profile.md` 与对应章节。
> 自动项可先跑 `node scripts/check-hf.mjs`。

## 可读性

- [ ] 正文 ≥13 px；长文 ≥14 px（ch11 / repo-profile §1）
- [ ] 元信息 ≥12 px；**没有 9/10 px 中文**
- [ ] 11 px 只用于非关键信息，且对比度 ≥4.5:1
- [ ] 行高：正文 ≥1.6（CJK）、标题 ≥1.3（ch11 §3）
- [ ] 长文行宽 ≤40 汉字 / 80 拉丁（ch11 §4）

## 对比度与颜色

- [ ] 正文 4.5:1；大字/图标 3:1（ch03 / repo-profile §2）
- [ ] **浅色与深色分别校验**
- [ ] 状态不只靠颜色（有文字/形状/图标）（ch03 规则 3）

## 目标与布局

- [ ] 交互目标 ≥24×24（AA）；触控 ≥9.5 mm（ch06）
- [ ] 命中区按点击区域算，不是可见图形（WCAG 2.5.8）

## 键盘与焦点

- [ ] 主流程可纯键盘完成（Tab → Enter → Esc）（ch12 §4）
- [ ] `:focus-visible` 可见，未被 `outline:none` 抹掉
- [ ] 模态：焦点移入 + 陷阱 + 关闭后归还（ch12 §3）
- [ ] 纯图标按钮有 `aria-label`（ch12 §2）

## 动态与表单

- [ ] 异步结果用 `aria-live`，区域预先存在（ch12 §5）
- [ ] 表单有 label；错误有 `aria-invalid` + `aria-describedby`（ch12 §6）
- [ ] 动效尊重 `prefers-reduced-motion`（ch10）

## 一致性

- [ ] 页面标题同一层级用同一字号（24 px）（repo-profile §1）
- [ ] 同类组件用同一 token（不混用 `--dsw-alias-*` 与 `--zy-*`）
