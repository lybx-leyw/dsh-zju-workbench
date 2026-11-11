# 源码统计方法（我数错过的三次）

**背景**：验收需要准确的「上游有多少个导出 / 多少个来源 / 多少行」。我在这一轮里数错了三次，每次都影响了对子代理的判断。

---

## 三次真实错误

### 错误 1：把 `columns` 当成顶层来源

```powershell
Select-String -Path sources.ts -Pattern '^\s*\{ id:' | Measure-Object
# → 35
```

**结论**：35 个来源。**错。**

实际 `sources.ts` 的顶层是 9 个 source，每个 source 有 `columns: [...]` 数组，里面的 `{ id: "76425", ... }` 也被这个模式命中了。

**正确做法**：用**字段出现次数**交叉验证：

```powershell
([regex]::Matches($txt, 'adapter:')).Count   # 9
([regex]::Matches($txt, 'base:')).Count      # 9
([regex]::Matches($txt, 'columns:')).Count   # 9
```

三个都等于 9 → 顶层来源是 9。

**为什么这个方法是可靠的**：`adapter` / `base` / `columns` 是**每个顶层 source 必有的三个字段**，而 `columns` 内部的条目没有这三个字段。三者同时给出同一个数，说明数对了。

### 错误 2：用括号深度法数顶层条目

```powershell
$depth = 0; $top = 0
foreach ($ch in $txt.ToCharArray()) {
  if ($ch -eq '{') { if ($depth -eq 1) { $top++ }; $depth++ }
  elseif ($ch -eq '}') { $depth-- }
}
# → 26
```

**结论**：26 个。**错。**

原因：`columns: [` 之后的 `{` 会被算作 `depth` 变化，而数组与对象的层级不同，`depth === 1` 这个判据在「对象里套数组再套对象」的结构下失效。

**教训**：**不要用字符级的括号计数去解析结构化文本**。JS 对象字面量不是 JSON，`//` 注释、字符串里的括号、模板字符串都会骗过它。

### 错误 3：正则跨行匹配失败当成「不存在」

```powershell
[regex]::Matches($txt, 'id:\s*"([^"]+)"[^}]*?adapter:\s*"([^"]+)"')
# → 9 条，但第一版写的是单行匹配，只匹配到部分
```

第一次我用的是 `'adapter:\s*"(\w+)"'` 配合 `Select-String`（逐行匹配），因为 `adapter` 与 `id` 不在同一行，只数到了跨行排布的那些。

**教训**：`Select-String` 是**逐行**匹配。对多行结构必须用 `-Raw` 读全文 + `[regex]::Matches` 且显式加 `(?s)` 让 `.` 跨行。

---

## 可靠的方法（按可靠性排序）

### 1. 编译期事实：让 JS 自己数（最可靠）

```powershell
node -e "import('./module.js').then(m => console.log(Object.keys(m).length))"
```

对**导出数量**，这是唯一不会错的方法 —— 它是模块系统的真实结论。

### 2. 结构字段计数（用于 JSON / 规整的对象字面量）

```powershell
$txt = Get-Content $f -Raw
([regex]::Matches($txt, 'adapter:')).Count
([regex]::Matches($txt, 'base:')).Count
```

**要求**：所数字段是每个顶层条目必有的。多个必填字段同时给出同一个数 = 可信。

### 3. 逐行精确锚点（用于 `export` / `test(` 这类行首结构）

```powershell
Select-String -Path $f -Pattern '^export (async )?(function|const|class)' |
  ForEach-Object { $_.Line.Trim() -replace '\s*[=<{(].*$','' }
```

**适用**：结构确实在行首且不跨行。TypeScript 的 `export` 通常如此。

### 4. 交叉验证（任何数字都要做一次）

**规则**：任何要写进报告的统计数字，**至少用两种方法得到同一个值**才能采信。

我这一轮的教训是：单次 `grep` 的结果直接写进了任务描述，导致给子代理的信息是错的（说 notice 有「两套适配器」，实际三套；说约 712 行，实际 1052 行）。

---

## 行数的正确数法

```powershell
(Get-Content $f).Count
```

**注意**：
- 对**空文件**返回 0，对**最后无换行**的文件会少算或多算 —— 用于「量级判断」够用，用于「逐行对照」要小心
- `Get-ChildItem -Recurse | Measure-Object -Property Length -Sum` 给的是**字节数**，不是行数，两者不能混
- 跨文件合计行数时，`(Get-Content $f).Count` 在管道里对多文件会合并计数，要用 `ForEach-Object`

---

## 检查清单（写在报告里之前）

- [ ] 每个数字都用两种方法验证过
- [ ] 多行结构用 `-Raw` + `(?s)`，不用 `Select-String`
- [ ] 不用字符级括号计数解析对象字面量
- [ ] 导出数量以 `Object.keys(import(...))` 为准
- [ ] 「有 N 个 X」这种断言，先想清楚 X 的**边界**（顶层？含嵌套？）
